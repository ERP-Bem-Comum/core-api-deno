/**
 * AUTH-SYNC-PERMISSIONS-JOB (#462) — CA6 — o `seed:admin` delega e segue funcionando.
 *
 * A delegação removeu ~85 linhas do seed e moveu a fronteira transacional do passo 4. A lógica
 * delegada está coberta em `sync-permissions.drizzle-mysql.test.ts`; o que fica descoberto é o
 * WIRING — o `roleId` devolvido pela public-api chegando em `auth_user_role`. São poucas linhas, e
 * é exatamente onde um defeito passaria: o seed sairia 0, o usuário existiria, e o admin não teria
 * papel nenhum. Outro 403 mudo — o sintoma que este ticket existe para matar.
 *
 * Roda o script de verdade (`pnpm seed:admin`), não uma função extraída: o contrato do CA6 é o
 * comportamento observável do script.
 *
 * ⚠️ Mesmo requisito do teste irmão: `AUTH_SYNC_TEST_DATABASE_URL` explícita, banco DESCARTÁVEL.
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';

import { openAuthMysql } from '#src/modules/auth/adapters/persistence/drivers/mysql-driver.ts';
import type { AuthMysqlHandle } from '#src/modules/auth/adapters/persistence/drivers/mysql-driver.ts';
import * as schema from '#src/modules/auth/adapters/persistence/schemas/mysql.ts';
import * as PermissionCatalog from '#src/modules/auth/domain/authorization/permission-catalog.ts';
import { moduleDir } from '#src/shared/module-dir.ts';

const REPO_ROOT = resolve(moduleDir(import.meta.url), '..', '..', '..');
const SEED = resolve(REPO_ROOT, 'scripts', 'seed', 'admin-user.ts');
const CONN = Deno.env.get('AUTH_SYNC_TEST_DATABASE_URL') ?? '';

// E-mail próprio deste teste: coexiste com o que os testes irmãos deixarem no banco.
const EMAIL = 'seed-delegation-462@example.com';

const enabled = (): boolean => Deno.env.get('MYSQL_INTEGRATION') === '1' && CONN.length > 0;

const runSeed = async (): Promise<number> => {
  const { code } = await new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', SEED],
    cwd: REPO_ROOT,
    // env explícito e isolado (o spawn passava um objeto `env` completo, que substitui o ambiente).
    clearEnv: true,
    env: {
      PATH: Deno.env.get('PATH') ?? '',
      AUTH_DATABASE_URL: CONN,
      ADMIN_EMAIL: EMAIL,
      ADMIN_PASSWORD: 'Senha-Muito-Forte-462!',
      ADMIN_NAME: 'Admin Delegacao',
      ADMIN_CPF: '52998224725',
      ADMIN_PHONE: '11999998888',
    },
    stdout: 'null',
    stderr: 'null',
  }).output();
  return code;
};

if (enabled()) {
  let handle: AuthMysqlHandle | null = null;

  before(async () => {
    const r = await openAuthMysql({ connectionString: CONN, applyMigrations: true });
    if (!r.ok) throw new Error(`fixture: openAuthMysql falhou — ${r.error}`);
    handle = r.value;
  });

  after(async () => {
    if (handle !== null) {
      await handle.close();
      handle = null;
    }
  });

  describe('seed:admin delega a sincronização — AUTH-SYNC-PERMISSIONS-JOB (CA6)', () => {
    it('CA6: seed cria o admin E o liga a um papel com o catálogo inteiro', async () => {
      if (handle === null) throw new Error('fixture');

      assert.equal(await runSeed(), 0, 'o seed deve sair 0');

      const users = await handle.db
        .select({ id: schema.authUser.id })
        .from(schema.authUser)
        .where(eq(schema.authUser.email, EMAIL));
      const user = users[0];
      assert.ok(user !== undefined, 'usuário criado');

      // O wiring: o roleId veio da public-api e foi gravado no vínculo.
      const links = await handle.db
        .select({ roleId: schema.authUserRole.roleId })
        .from(schema.authUserRole)
        .where(eq(schema.authUserRole.userId, user.id));
      const link = links[0];
      assert.ok(link !== undefined, 'o admin tem papel — sem isto, 403 mudo com o seed dizendo ok');

      const perms = await handle.db
        .select({ permissionId: schema.authRolePermission.permissionId })
        .from(schema.authRolePermission)
        .where(eq(schema.authRolePermission.roleId, link.roleId));
      assert.equal(
        perms.length,
        PermissionCatalog.all.length,
        'o papel do admin carrega o catálogo inteiro',
      );
    });

    it('CA6: rodar o seed de novo continua idempotente (exit 0, sem duplicar)', async () => {
      if (handle === null) throw new Error('fixture');

      assert.equal(await runSeed(), 0);

      const users = await handle.db
        .select({ id: schema.authUser.id })
        .from(schema.authUser)
        .where(eq(schema.authUser.email, EMAIL));
      assert.equal(users.length, 1, 'não duplica usuário');

      const links = await handle.db
        .select({ roleId: schema.authUserRole.roleId })
        .from(schema.authUserRole)
        .where(eq(schema.authUserRole.userId, users[0]?.id ?? ''));
      assert.equal(links.length, 1, 'não duplica atribuição de papel');
    });
  });
}
