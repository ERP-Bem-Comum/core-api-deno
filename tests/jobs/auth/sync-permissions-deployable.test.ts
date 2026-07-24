/**
 * AUTH-SYNC-PERMISSIONS-JOB (#462) — CA5.
 *
 * O defeito do #462 não é lógica, é ENDEREÇO: o `seed:admin` sincroniza corretamente há meses, mas
 * mora em `scripts/`, que o Dockerfile não copia — e em Fargate não há `docker cp`. As 3 tentativas
 * anteriores consertaram a lógica e todas seguiram fora da imagem.
 *
 * Invariante travada: o entrypoint está na imagem — mora sob `src/` E o Dockerfile copia `src`.
 * Não afirmamos que `scripts/` fica de fora (isso é o defeito, não a regra): copiá-lo um dia é
 * legítimo e não deve quebrar este teste.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

import { moduleDir } from '#src/shared/module-dir.ts';

const REPO_ROOT = resolve(moduleDir(import.meta.url), '..', '..', '..');
const JOB_SCRIPT = 'job:auth:sync-permissions';
const RUN_PATH = 'src/jobs/auth/sync-permissions/run.ts';

const exists = async (relative: string): Promise<boolean> => {
  try {
    await access(resolve(REPO_ROOT, relative));
    return true;
  } catch {
    return false;
  }
};

describe('sync-permissions é deployável — AUTH-SYNC-PERMISSIONS-JOB W0 (CA5)', () => {
  it('CA5a: o entrypoint do job existe sob src/', async () => {
    assert.ok(
      await exists(RUN_PATH),
      `${RUN_PATH} deve existir — é o que o deploy executa (≠ scripts/seed/admin-user.ts)`,
    );
  });

  it('CA5b: package.json expõe o job e aponta para src/, não para scripts/', async () => {
    const raw = await readFile(resolve(REPO_ROOT, 'package.json'), 'utf8');
    const pkg: unknown = JSON.parse(raw);
    const scripts: unknown = (pkg as Record<string, unknown>)['scripts'];
    assert.ok(scripts !== null && typeof scripts === 'object', 'package.json#scripts');

    const cmd: unknown = (scripts as Record<string, unknown>)[JOB_SCRIPT];
    assert.equal(typeof cmd, 'string', `package.json deve declarar "${JOB_SCRIPT}"`);
    assert.ok(
      (cmd as string).includes(RUN_PATH),
      `"${JOB_SCRIPT}" deve executar ${RUN_PATH} — um entrypoint sob scripts/ não vai para a imagem`,
    );
  });

  it('CA5c: o Dockerfile copia src para a imagem — é o que torna o job executável no deploy', async () => {
    const dockerfile = await readFile(resolve(REPO_ROOT, 'Dockerfile'), 'utf8');
    assert.match(
      dockerfile,
      /^COPY\s+src\s+\.\/src\s*$/m,
      'sem `COPY src ./src` o job não chega na imagem — e o #462 volta',
    );
  });
});
