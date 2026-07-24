/**
 * CORE-MIGRATE-BOOT-INVERT — Fase 5 Slice B — Wave W0 (RED)
 *
 * Inverte o boot: as compositions HTTP deixam de migrar (`applyMigrations: false`);
 * o schema passa a ser provisionado SOMENTE pelo job `migrate` (Slice A). Os scripts
 * E2E e o compose passam a rodar o migrate antes de subir o server.
 *
 * RED esperado: as 5 compositions ainda têm `true`; o compose ainda não tem
 * `http.depends_on.migrate`; os e2e ainda não invocam o migrate.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const COMPOSE_YAML = join(PROJECT_ROOT, 'compose.yaml');

const read = (rel: string): string => readFileSync(join(PROJECT_ROOT, rel), 'utf-8');

// ─── CA-B1 — compositions HTTP não migram mais ──────────────────────────────
describe('CORE-MIGRATE-BOOT-INVERT — CA-B1: boot não migra (applyMigrations:false)', () => {
  const COMPOSITIONS = [
    'src/modules/auth/adapters/http/composition.ts',
    'src/modules/contracts/adapters/http/composition.ts',
    'src/modules/financial/adapters/http/composition.ts',
    'src/modules/partners/adapters/http/composition.ts',
    'src/modules/programs/adapters/http/composition.ts',
  ];

  for (const rel of COMPOSITIONS) {
    it(`CA-B1: ${rel} usa applyMigrations: false`, () => {
      const src = read(rel);
      assert.match(src, /applyMigrations:\s*false/, `${rel} deveria usar applyMigrations: false`);
      assert.doesNotMatch(
        src,
        /applyMigrations:\s*true/,
        `${rel} não pode mais migrar no boot (applyMigrations: true)`,
      );
    });
  }
});

// ─── CA-B3 — scripts E2E rodam o migrate antes do server ────────────────────
describe('CORE-MIGRATE-BOOT-INVERT — CA-B3: e2e migram antes de subir o server', () => {
  const SCRIPTS = ['e2e/auth.sh', 'e2e/contracts.sh', 'e2e/collaborators.sh', 'e2e/bruno-all.sh'];

  for (const name of SCRIPTS) {
    it(`CA-B3: scripts/${name} executa o migrate antes de src/server.ts`, () => {
      const src = read(join('scripts', name));
      // Casa a INVOCAÇÃO real (`node ... --no-warnings <script>`), não o
      // `pkill -f 'node .*src/server.ts'` do cleanup (que menciona o server antes).
      const migrateAt = src.indexOf('--no-warnings src/jobs/migrate/run.ts');
      const serverAt = src.indexOf('--no-warnings src/server.ts');
      assert.ok(migrateAt !== -1, `${name} deveria invocar src/jobs/migrate/run.ts`);
      assert.ok(serverAt !== -1, `${name} deveria subir src/server.ts`);
      assert.ok(
        migrateAt < serverAt,
        `${name}: o migrate (${migrateAt}) deve vir antes do server (${serverAt})`,
      );
    });
  }
});

// ─── CA-B2 / CA-B4 — compose: http depende do migrate; default só-infra ─────
interface ComposeService {
  readonly depends_on?: Readonly<Record<string, { readonly condition?: string }>>;
  readonly profiles?: readonly string[];
}
interface ComposeConfig {
  readonly services?: Readonly<Record<string, ComposeService>>;
}

// Nenhum call-site deste arquivo passa timeout customizado — parâmetro removido.
const sh = (cmd: string): { code: number; stdout: string; stderr: string } => {
  const { code, stdout, stderr } = new Deno.Command('bash', {
    args: ['-c', cmd],
    cwd: PROJECT_ROOT,
    stdout: 'piped',
    stderr: 'piped',
  }).outputSync();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
};
const dockerCliAvailable = (): boolean => sh('docker compose version').code === 0;
const skip = dockerCliAvailable() ? false : 'Docker CLI (plugin compose) ausente no PATH';

const configAppProfile = (): ComposeConfig | null => {
  const r = sh(`docker compose -f "${COMPOSE_YAML}" --profile app config --format json`);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as ComposeConfig;
  } catch {
    return null;
  }
};

describe('CORE-MIGRATE-BOOT-INVERT — CA-B2/B4: compose depends_on migrate', { skip }, () => {
  it('CA-B2: http depende de migrate com condition service_completed_successfully', () => {
    const cfg = configAppProfile();
    const cond = cfg?.services?.['http']?.depends_on?.['migrate']?.condition;
    assert.equal(
      cond,
      'service_completed_successfully',
      `http.depends_on.migrate deveria ser service_completed_successfully, foi ${String(cond)}`,
    );
  });

  it('CA-B2b: migrate é ativado no profile app (para ser dependência do http)', () => {
    const cfg = configAppProfile();
    assert.ok(cfg?.services?.['migrate'], 'migrate deveria estar ativo com --profile app');
  });

  it('CA-B4: sem profile, migrate e http NÃO sobem (default só-infra)', () => {
    const r = sh(`docker compose -f "${COMPOSE_YAML}" config --services`);
    assert.equal(r.code, 0, `config --services falhou: ${r.stderr}`);
    const services = r.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    assert.ok(
      !services.includes('migrate'),
      `migrate não deveria subir no default: ${JSON.stringify(services)}`,
    );
    assert.ok(
      !services.includes('http'),
      `http não deveria subir no default: ${JSON.stringify(services)}`,
    );
  });
});
