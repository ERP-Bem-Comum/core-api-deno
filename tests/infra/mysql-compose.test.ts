/**
 * CTR-DB-COMPOSE-MYSQL — Wave W0 (RED)
 *
 * Valida os 19 critérios de aceite do ticket `000-request.md` contra a config
 * canônica do compose+conf.d+initdb.d+secrets descrita no ADR-0020.
 *
 * Esta suite é descoberta automaticamente por `pnpm test` (pattern `tests/**`/*.test.ts`).
 * Skip-guard em DOIS níveis (FIN-TEST-INFRA-SKIP-GUARD + opt-in explícito):
 *   - Sintaxe (CA-1): pulada sem o plugin `docker compose` no PATH.
 *   - Bootstrap (CA-2..19): exige opt-in `COMPOSE_INTEGRATION=1` E daemon vivo. Sem o opt-in,
 *     `pnpm test` marca a suite `skipped` — NUNCA `failed`, mesmo com o daemon ligado e a porta
 *     3306 ocupada pelo stack de dev (a razão das falhas antes do gate por env var).
 * O bootstrap roda via `pnpm run test:integration:infra` (seta `COMPOSE_INTEGRATION=1`). Como o
 * `composeUp` aplica o override `compose.ci.yaml` (`ports: !reset null`) e todas as queries usam
 * `docker exec` (não a porta do host), a suite coexiste com o stack de dev sem conflito de porta.
 *
 * Convenção:
 *   - Testes de sintaxe (CA-1) podem rodar sem subir container.
 *   - Testes de bootstrap (CA-3..19) sobem o container UMA VEZ em `before()`,
 *     reusam o mesmo estado, e fazem cleanup completo em `after()`.
 *   - Senhas usadas: dummies fixas só para esta suite (não vão pra prod).
 */

import { describe, it, before, after } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Paths ────────────────────────────────────────────────────────────────
const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const COMPOSE_YAML = join(PROJECT_ROOT, 'compose.yaml');
const COMPOSE_CI_YAML = join(PROJECT_ROOT, 'compose.ci.yaml');
const SECRETS_DIR = join(PROJECT_ROOT, 'secrets');

// ─── Constants ────────────────────────────────────────────────────────────
const CONTAINER = 'core-api-mysql';

// Senhas dummies só para esta suite — sobrescritas em cada `before()`.
const DUMMY_ROOT_PWD = 'rootpw-test-only-do-not-use-elsewhere';
const DUMMY_APP_PWD = 'apppw-test-only-do-not-use-elsewhere';
const DUMMY_RO_PWD = 'ropw-test-only-do-not-use-elsewhere';

// ─── Helpers ──────────────────────────────────────────────────────────────
interface ExecOk {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Nota (migração Deno.Command): `outputSync()` é bloqueante — trava a isolate até o
// processo terminar, então nenhum timer/AbortSignal roda nesse meio-tempo. `opts.timeoutMs`
// fica na assinatura por compat com os call-sites existentes, mas deixa de ser um limite
// de fato imposto (o Node `spawnSync` matava o processo ao estourar `timeout`; aqui não há
// equivalente síncrono). `env` não precisa de merge manual com o ambiente atual: o
// `Deno.Command` herda o env do processo pai por padrão (só some se `clearEnv: true`).
const sh = (
  cmd: string,
  opts: { readonly timeoutMs?: number; readonly env?: Readonly<Record<string, string>> } = {},
): ExecOk => {
  const { code, stdout, stderr } = new Deno.Command('bash', {
    args: ['-c', cmd],
    cwd: PROJECT_ROOT,
    // `exactOptionalPropertyTypes`: omitir a chave (não setar `undefined`) quando não há env extra.
    ...(opts.env === undefined ? {} : { env: opts.env }),
    stdout: 'piped',
    stderr: 'piped',
  }).outputSync();
  return {
    code,
    stdout: new TextDecoder().decode(stdout),
    stderr: new TextDecoder().decode(stderr),
  };
};

// Dois níveis de disponibilidade do Docker:
//   - CLI: o plugin `docker compose` existe (parseia compose.yaml, não toca o daemon).
//   - daemon: além do CLI, o daemon responde a `docker info` — necessário para subir containers.
// `docker compose version` retorna 0 mesmo com o daemon parado; por isso o bootstrap
// precisa do gate adicional `docker info`.
const dockerCliAvailable = (): boolean => sh('docker compose version').code === 0;
const dockerDaemonAvailable = (): boolean =>
  dockerCliAvailable() && sh('docker info', { timeoutMs: 5_000 }).code === 0;

// Avaliados uma única vez no carregamento do módulo (evita ~30 spawns repetidos).
// Sintaxe (CA-1) só exige o CLI; bootstrap (CA-2..19) exige opt-in explícito + daemon vivo.
// O opt-in segue a convenção do repo (MYSQL_INTEGRATION/STORAGE_INTEGRATION/...): integração
// nunca roda em `pnpm test` puro — só nos scripts `test:integration:*` que setam a env var.
const composeIntegration = Deno.env.get('COMPOSE_INTEGRATION') === '1';
const skipSyntax = dockerCliAvailable() ? false : 'Docker CLI (plugin compose) ausente no PATH';
const skipBootstrap = !composeIntegration
  ? 'COMPOSE_INTEGRATION!=1 — rode `pnpm run test:integration:infra`'
  : dockerDaemonAvailable()
    ? false
    : 'Docker daemon offline (ou plugin compose ausente)';

const writeSecrets = (): void => {
  mkdirSync(SECRETS_DIR, { recursive: true });
  writeFileSync(join(SECRETS_DIR, 'mysql_root_password.txt'), DUMMY_ROOT_PWD);
  writeFileSync(join(SECRETS_DIR, 'mysql_app_password.txt'), DUMMY_APP_PWD);
  writeFileSync(join(SECRETS_DIR, 'mysql_readonly_password.txt'), DUMMY_RO_PWD);
  // 0644, não 0600 — o initdb script roda como o user `mysql` (uid 999) e lê
  // /run/secrets/mysql_readonly_password via `cat`. Espelha o modo de
  // `scripts/setup-secrets.ts`. Ver CTR-INFRA-READONLY-BI-AUTH.
  chmodSync(join(SECRETS_DIR, 'mysql_root_password.txt'), 0o644);
  chmodSync(join(SECRETS_DIR, 'mysql_app_password.txt'), 0o644);
  chmodSync(join(SECRETS_DIR, 'mysql_readonly_password.txt'), 0o644);
};

const removeSecrets = (): void => {
  for (const f of [
    'mysql_root_password.txt',
    'mysql_app_password.txt',
    'mysql_readonly_password.txt',
  ]) {
    const p = join(SECRETS_DIR, f);
    if (existsSync(p)) rmSync(p);
  }
};

// Override CI (`compose.ci.yaml`: `ports: !reset null`) remove o bind do host → sem conflito
// com a 3306 do stack de dev. Todas as queries usam `docker exec`, nunca a porta do host.
const composeUp = (): ExecOk =>
  sh('docker compose -f compose.yaml -f compose.ci.yaml up -d mysql', { timeoutMs: 120_000 });
const composeDown = (volumes = false): ExecOk =>
  sh(`docker compose down ${volumes ? '-v' : ''}`, { timeoutMs: 60_000 });

const waitHealthy = (deadlineMs = 90_000): boolean => {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    const r = sh(`docker inspect ${CONTAINER} --format '{{.State.Health.Status}}'`);
    if (r.code === 0 && r.stdout.trim() === 'healthy') return true;
    sh('sleep 2');
  }
  return false;
};

// Roda mysql DENTRO do container — host pode não ter o cliente instalado.
// `docker exec` é mais robusto e funciona idêntico em CI.
const mysqlExec = (user: string, password: string, sql: string, database = 'core'): ExecOk => {
  const escapedSql = sql.replace(/"/g, '\\"');
  return sh(
    `docker exec ${CONTAINER} mysql -u ${user} -p"${password}" -N -B -e "${escapedSql}" ${database}`,
    { timeoutMs: 10_000 },
  );
};

// Conveniência: query como root no database mysql (acesso total).
const dockerExecMysql = (sql: string, database = 'mysql'): ExecOk =>
  mysqlExec('root', DUMMY_ROOT_PWD, sql, database);

// ─── CA-1 — Sintaxe Compose ───────────────────────────────────────────────
describe('CTR-DB-COMPOSE-MYSQL — CA-1: sintaxe compose', { skip: skipSyntax }, () => {
  it('CA-1a: docker compose -f compose.yaml config retorna exit 0', () => {
    const r = sh(`docker compose -f "${COMPOSE_YAML}" config --quiet`);
    assert.equal(r.code, 0, `compose.yaml inválido: ${r.stderr}`);
  });

  it('CA-1b: compose.ci.yaml existe e override é válido', () => {
    assert.ok(existsSync(COMPOSE_CI_YAML), `compose.ci.yaml não existe em ${COMPOSE_CI_YAML}`);
    const r = sh(`docker compose -f "${COMPOSE_YAML}" -f "${COMPOSE_CI_YAML}" config --quiet`);
    assert.equal(r.code, 0, `override CI inválido: ${r.stderr}`);
  });

  it('CA-1c: compose.ci.yaml remove o port mapping do serviço mysql', () => {
    assert.ok(existsSync(COMPOSE_CI_YAML), `compose.ci.yaml não existe`);
    const r = sh(
      `docker compose -f "${COMPOSE_YAML}" -f "${COMPOSE_CI_YAML}" config --format json`,
    );
    assert.equal(r.code, 0, `config falhou: ${r.stderr}`);
    const parsed = JSON.parse(r.stdout) as {
      services?: { mysql?: { ports?: readonly unknown[] } };
    };
    const ports = parsed.services?.mysql?.ports ?? [];
    assert.equal(ports.length, 0, `esperado ports vazio em CI, foi: ${JSON.stringify(ports)}`);
  });
});

// ─── CA-2 — Falha rápida sem secrets ──────────────────────────────────────
describe('CTR-DB-COMPOSE-MYSQL — CA-2: falha sem secrets', { skip: skipBootstrap }, () => {
  before(() => {
    composeDown(true);
    removeSecrets();
  });

  it('CA-2: docker compose up falha quando ./secrets/*.txt ausentes', () => {
    const r = composeUp();
    assert.notEqual(r.code, 0, `esperado falha quando secrets ausentes, exit foi ${r.code}`);
    assert.match(
      `${r.stderr} ${r.stdout}`,
      /no such file|not found|cannot find|secret|error/i,
      `mensagem deveria indicar erro de secret/arquivo, foi: ${r.stderr}`,
    );
  });
});

// ─── CA-3 a CA-19 — Bootstrap completo ────────────────────────────────────
describe('CTR-DB-COMPOSE-MYSQL — bootstrap completo (CA-3..CA-19)', { skip: skipBootstrap }, () => {
  let healthyAt: number | null = null;

  before(() => {
    composeDown(true);
    writeSecrets();
    const t0 = Date.now();
    const up = composeUp();
    if (up.code !== 0) return; // testes vão falhar com mensagem clara
    const ok = waitHealthy(90_000);
    if (ok) healthyAt = Date.now() - t0;
  });

  after(() => {
    composeDown(true);
    removeSecrets();
  });

  it('CA-3: container healthy em ≤90s', () => {
    assert.ok(healthyAt !== null, 'container nunca ficou healthy');
    assert.ok(healthyAt < 90_000, `healthy demorou ${healthyAt}ms (limite 90s)`);
  });

  it('CA-4: core_app conecta no database core', () => {
    const r = mysqlExec('core_app', DUMMY_APP_PWD, 'SELECT DATABASE();');
    assert.equal(r.code, 0, `mysql falhou: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'core');
  });

  it('CA-5: readonly_bi consegue SELECT', () => {
    const r = mysqlExec('readonly_bi', DUMMY_RO_PWD, 'SELECT 1;');
    assert.equal(r.code, 0, `SELECT falhou: ${r.stderr}`);
    assert.equal(r.stdout.trim(), '1');
  });

  it('CA-6: readonly_bi recebe privilege-denied (não auth-denied) ao CREATE TABLE', () => {
    // Anti-falso-positivo (CTR-INFRA-READONLY-BI-AUTH): se readonly_bi falhasse
    // no login, o CREATE TABLE retornaria "Access denied ... using password"
    // antes de checar privilégio — satisfazendo um /denied/ frouxo sem nunca
    // exercitar o GRANT. Exigimos ER_TABLEACCESS_DENIED_ERROR (1142) para provar
    // que a autenticação ocorreu e só o privilégio foi negado.
    const r = mysqlExec('readonly_bi', DUMMY_RO_PWD, 'CREATE TABLE t_should_fail (id INT);');
    assert.notEqual(r.code, 0, 'CREATE TABLE deveria ter falhado');
    assert.match(
      r.stderr,
      /CREATE command denied/i,
      `esperado privilege-denied (1142), foi: ${r.stderr}`,
    );
    assert.doesNotMatch(
      r.stderr,
      /Access denied for user/i,
      `readonly_bi falhou na autenticação, não no privilégio: ${r.stderr}`,
    );
  });

  it('CA-7: character_set_server = utf8mb4', () => {
    const r = mysqlExec('core_app', DUMMY_APP_PWD, "SHOW VARIABLES LIKE 'character_set_server';");
    assert.match(r.stdout, /utf8mb4/, `esperado utf8mb4, foi: ${r.stdout}`);
  });

  it('CA-8: collation_server = utf8mb4_unicode_ci', () => {
    const r = mysqlExec('core_app', DUMMY_APP_PWD, "SHOW VARIABLES LIKE 'collation_server';");
    assert.match(r.stdout, /utf8mb4_unicode_ci/, `esperado utf8mb4_unicode_ci, foi: ${r.stdout}`);
  });

  it('CA-9: sql_mode contém STRICT_ALL_TABLES, NO_ZERO_DATE, ERROR_FOR_DIVISION_BY_ZERO', () => {
    const r = mysqlExec('core_app', DUMMY_APP_PWD, 'SELECT @@global.sql_mode;');
    assert.equal(r.code, 0);
    const mode = r.stdout;
    assert.match(mode, /STRICT_ALL_TABLES/, `sql_mode sem STRICT_ALL_TABLES: ${mode}`);
    assert.match(mode, /NO_ZERO_DATE/, `sql_mode sem NO_ZERO_DATE: ${mode}`);
    assert.match(
      mode,
      /ERROR_FOR_DIVISION_BY_ZERO/,
      `sql_mode sem ERROR_FOR_DIVISION_BY_ZERO: ${mode}`,
    );
  });

  it('CA-10: time_zone = +00:00', () => {
    const r = mysqlExec('core_app', DUMMY_APP_PWD, 'SELECT @@global.time_zone;');
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '+00:00');
  });

  it('CA-11: innodb_file_per_table = ON', () => {
    const r = mysqlExec('core_app', DUMMY_APP_PWD, "SHOW VARIABLES LIKE 'innodb_file_per_table';");
    assert.match(r.stdout, /\bON\b/, `esperado ON, foi: ${r.stdout}`);
  });

  it('CA-12: binlog_format = ROW', () => {
    const r = mysqlExec('core_app', DUMMY_APP_PWD, "SHOW VARIABLES LIKE 'binlog_format';");
    assert.match(r.stdout, /\bROW\b/, `esperado ROW, foi: ${r.stdout}`);
  });

  it('CA-13: gtid_mode = ON', () => {
    const r = mysqlExec('core_app', DUMMY_APP_PWD, 'SELECT @@global.gtid_mode;');
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), 'ON');
  });

  it('CA-14: innodb_flush_log_at_trx_commit = 1 (ACID full)', () => {
    const r = mysqlExec(
      'core_app',
      DUMMY_APP_PWD,
      'SELECT @@global.innodb_flush_log_at_trx_commit;',
    );
    assert.equal(r.code, 0);
    assert.equal(r.stdout.trim(), '1', 'D7 revisado: ACID full em todos ambientes');
  });

  it('CA-15: time zone America/Sao_Paulo carregada', () => {
    // mysql.* só é acessível por root — usar dockerExecMysql.
    const r = dockerExecMysql(
      "SELECT COUNT(*) FROM mysql.time_zone_name WHERE Name = 'America/Sao_Paulo';",
    );
    const count = parseInt(r.stdout.trim(), 10);
    assert.ok(count >= 1, `time zone America/Sao_Paulo deveria existir, count=${count}`);
  });

  it('CA-16: /run/secrets/mysql_root_password tem modo restrito (sem world/group write)', () => {
    const r = sh(`docker exec ${CONTAINER} stat -c '%a' /run/secrets/mysql_root_password`);
    assert.equal(r.code, 0, `stat falhou: ${r.stderr}`);
    // Docker Compose standalone monta secrets como 0444 ou 0600 (depende da
    // versão e do storage driver). O crítico é: dígito 2 (group) ≤ 4, dígito 3
    // (world) ≤ 4 — ou seja, sem permissão de escrita para nada além do owner.
    const mode = r.stdout.trim();
    assert.match(
      mode,
      /^0?[0-7][0-4][0-4]$/,
      `modo deveria ser sem world/group-write, foi: ${mode}`,
    );
  });

  it('CA-17: secrets NÃO aparecem em docker inspect Config.Env', () => {
    const r = sh(`docker inspect ${CONTAINER} --format '{{json .Config.Env}}'`);
    assert.equal(r.code, 0);
    const env = JSON.parse(r.stdout) as readonly string[];
    const joined = env.join('\n');
    assert.doesNotMatch(joined, new RegExp(DUMMY_ROOT_PWD), 'root password leakou em env');
    assert.doesNotMatch(joined, new RegExp(DUMMY_APP_PWD), 'app password leakou em env');
    assert.doesNotMatch(joined, new RegExp(DUMMY_RO_PWD), 'readonly password leakou em env');
    // Mas as *_FILE devem existir
    assert.match(joined, /MYSQL_ROOT_PASSWORD_FILE/, 'esperado MYSQL_ROOT_PASSWORD_FILE no env');
    assert.match(joined, /MYSQL_PASSWORD_FILE/, 'esperado MYSQL_PASSWORD_FILE no env');
  });

  it('CA-18: volume persiste users após down (sem -v) + up', () => {
    composeDown(false);
    const up = composeUp();
    assert.equal(up.code, 0, `up falhou após down: ${up.stderr}`);
    assert.ok(waitHealthy(60_000), 'não ficou healthy no restart');
    const r = mysqlExec('core_app', DUMMY_APP_PWD, 'SELECT DATABASE();');
    assert.equal(r.code, 0, `core_app deveria persistir: ${r.stderr}`);
    assert.equal(r.stdout.trim(), 'core');
  });

  it('CA-19: down -v apaga o volume e força init scripts na próxima subida', () => {
    composeDown(true);
    // Sem volume, próximo up vai rodar init scripts e deve criar users novamente
    const up = composeUp();
    assert.equal(up.code, 0, `up pós down -v falhou: ${up.stderr}`);
    assert.ok(waitHealthy(90_000), 'não ficou healthy após down -v');
    const r = mysqlExec('core_app', DUMMY_APP_PWD, 'SELECT 1;');
    assert.equal(r.code, 0, 'init scripts deveriam ter rodado novamente');
    assert.equal(r.stdout.trim(), '1');
  });
});
