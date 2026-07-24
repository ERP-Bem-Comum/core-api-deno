/**
 * CTR-DB-MIGRATION-MYSQL — W0 (RED)
 *
 * Valida em duas camadas:
 *   (1) Estrutural — `drizzle.mysql.config.ts`, `package.json#scripts.db:generate:mysql`,
 *       arquivo `migrations/mysql/0000_*.sql` contém as estruturas esperadas (substring grep).
 *   (2) Funcional E2E — sobe MySQL via compose, aplica a migration via `docker exec`,
 *       valida estrutura observada em `INFORMATION_SCHEMA` e tenta violar CHECKs F-L1/F-L2.
 *
 * A camada (2) absorve a Suggestion #1 do W2 do ticket #2 (CTR-DB-SCHEMA-MYSQL-CTR-PREFIX) —
 * prova que os CHECKs funcionam em runtime, não só que estão declarados.
 *
 * Sustentação: ADR-0020 §"Convenção", DB audit findings F-H2/F-M2/F-L1/F-L2,
 * MySQL 8.4 Refman §INFORMATION_SCHEMA CHECK_CONSTRAINTS Table.
 */

import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Paths ────────────────────────────────────────────────────────────────
const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..', '..', '..');
const DRIZZLE_MYSQL_CONFIG = join(PROJECT_ROOT, 'db/drizzle/contracts.ts');
const PACKAGE_JSON = join(PROJECT_ROOT, 'package.json');
const MIGRATIONS_DIR = join(
  PROJECT_ROOT,
  'src/modules/contracts/adapters/persistence/migrations/mysql',
);

// ─── Helpers ──────────────────────────────────────────────────────────────
interface ExecOk {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Nota (migração Deno.Command): `outputSync()` é bloqueante — nenhum timer roda
// enquanto ele espera o processo terminar, então `opts.timeoutMs` fica só na assinatura
// (compat com os call-sites) sem enforcement real (o Node `spawnSync` matava o processo
// ao estourar `timeout`; não há equivalente síncrono no `Deno.Command`).
const sh = (cmd: string, _opts: { readonly timeoutMs?: number } = {}): ExecOk => {
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

const dockerAvailable = (): boolean => sh('docker compose version').code === 0;

const findMigrationFile = (): string | null => {
  if (!existsSync(MIGRATIONS_DIR)) return null;
  const files = readdirSync(MIGRATIONS_DIR).filter(
    (f) => f.startsWith('0000_') && f.endsWith('.sql'),
  );
  if (files.length === 0) return null;
  return join(MIGRATIONS_DIR, files[0]!);
};

const readMigrationSql = (): string => {
  const file = findMigrationFile();
  if (file === null) return '';
  return readFileSync(file, 'utf-8');
};

// Senha de root usada pelo container do compose. Os secrets reais (em
// `secrets/*.txt`) são geridos pelo script `secrets:setup` ou pelo target
// `pnpm test:integration`. Esta suite NÃO sobe/destrói o compose — apenas
// fala com um container já em execução.
const DUMMY_ROOT_PWD = 'rootpw-migration-test-only';
const CONTAINER = 'core-api-mysql';
const TEST_DB = 'core';

// `--protocol=tcp` é obrigatório porque o mysql CLI default tenta socket Unix
// em /var/run/mysqld/mysqld.sock, path inexistente no container oficial mysql:8.4
// (server escuta em /var/run/mysqld/mysqlx.sock e via TCP em 3306). Forçar TCP
// garante conexão consistente independente de imagem/versão.
const MYSQL_CLI_FLAGS = `--protocol=tcp -h 127.0.0.1 -uroot -p"${DUMMY_ROOT_PWD}"`;

const dockerExecRoot = (sql: string, db = TEST_DB): ExecOk => {
  const escapedSql = sql.replace(/"/g, '\\"');
  return sh(`docker exec ${CONTAINER} mysql ${MYSQL_CLI_FLAGS} -N -B -e "${escapedSql}" ${db}`, {
    timeoutMs: 15_000,
  });
};

const applyMigration = (): ExecOk => {
  const file = findMigrationFile();
  if (file === null) return { code: -1, stdout: '', stderr: 'migration file not found' };
  // `--> statement-breakpoint` é um separador semântico do drizzle-kit
  // interpretado pelo `drizzle-orm/mysql2/migrator`, mas é SQL inválido para o
  // `mysql` CLI. O sentinel aparece em duas formas: como linha standalone E
  // como sufixo na mesma linha do `;` final do statement anterior. Removemos
  // todas as ocorrências com `sed -e 's/...//g'`. (Wiring runtime via
  // mysql2/migrator vem em CTR-DB-DRIVER-MYSQL #4 e dispensa esse filtro.)
  return sh(
    `sed -e 's|--> statement-breakpoint||g' "${file}" | docker exec -i ${CONTAINER} mysql ${MYSQL_CLI_FLAGS} ${TEST_DB}`,
    { timeoutMs: 30_000 },
  );
};

// ─── CA-1 e CA-2 — Config files (estrutural) ──────────────────────────────
// CTR-CLEANUP-SQLITE (#5): drizzle.mysql.config.ts → drizzle.config.ts;
// script `db:generate:mysql` → `db:generate` (sem sufixo, dialeto único).
describe('CTR-DB-MIGRATION-MYSQL — CA-1/2: config files', () => {
  it('CA-1: db/drizzle/contracts.ts existe e tem dialect:mysql + schema/out corretos', () => {
    assert.ok(existsSync(DRIZZLE_MYSQL_CONFIG), `arquivo ${DRIZZLE_MYSQL_CONFIG} não encontrado`);
    const content = readFileSync(DRIZZLE_MYSQL_CONFIG, 'utf-8');
    assert.match(content, /dialect:\s*['"]mysql['"]/, 'config sem dialect:mysql');
    assert.match(content, /schemas\/mysql\.ts/, 'schema não aponta para mysql.ts');
    assert.match(content, /migrations\/mysql/, 'out não aponta para migrations/mysql');
  });

  it('CA-2: package.json#scripts.db:generate invoca drizzle-kit generate', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')) as {
      scripts?: Record<string, string>;
    };
    const script = pkg.scripts?.['db:generate'];
    assert.ok(script, '"db:generate" não está em package.json#scripts');
    assert.match(script, /drizzle-kit\s+generate/, 'script não invoca drizzle-kit generate');
  });
});

// ─── CA-3 a CA-9 — SQL gerado (estrutural) ────────────────────────────────
describe('CTR-DB-MIGRATION-MYSQL — CA-3..9: SQL gerado contém estruturas esperadas', () => {
  it('CA-3: migrations/mysql/0000_*.sql existe', () => {
    const file = findMigrationFile();
    assert.ok(
      file !== null,
      `nenhum arquivo migrations/mysql/0000_*.sql encontrado. Rode 'pnpm db:generate:mysql' primeiro.`,
    );
  });

  it('CA-4: SQL cria 3 tabelas com prefix ctr_*', () => {
    const sql = readMigrationSql();
    assert.match(sql, /CREATE TABLE.*\bctr_contracts\b/i, 'CREATE TABLE ctr_contracts ausente');
    assert.match(sql, /CREATE TABLE.*\bctr_amendments\b/i, 'CREATE TABLE ctr_amendments ausente');
    assert.match(
      sql,
      /CREATE TABLE.*\bctr_contract_homologated_amendments\b/i,
      'CREATE TABLE ctr_contract_homologated_amendments ausente',
    );
  });

  it('CA-5: SQL cria os 3 índices declarados', () => {
    const sql = readMigrationSql();
    assert.match(sql, /\bctr_amendments_contract_id_idx\b/, 'índice contract_id ausente (F-H2)');
    assert.match(sql, /\bctr_contracts_status_idx\b/, 'índice status ausente (F-M2)');
    assert.match(sql, /\bctr_contracts_signed_at_idx\b/, 'índice signed_at ausente (F-M2)');
  });

  it('CA-6: SQL cria os 7 CHECKs (5 herdados com prefix + F-L1 + F-L2)', () => {
    const sql = readMigrationSql();
    const expectedChecks = [
      'ctr_contracts_original_period_kind_chk',
      'ctr_contracts_current_period_kind_chk',
      'ctr_contracts_status_chk',
      'ctr_amendments_kind_chk',
      'ctr_amendments_status_chk',
      'ctr_contracts_ended_at_consistency_chk',
      'ctr_amendments_homologation_completeness_chk',
    ];
    for (const name of expectedChecks) {
      assert.match(sql, new RegExp(`\\b${name}\\b`), `CHECK ${name} ausente do SQL`);
    }
  });

  it('CA-7: SQL cria FK ctr_amendments.contract_id -> ctr_contracts(id)', () => {
    const sql = readMigrationSql();
    // Drizzle pode emitir FK como constraint inline ou ALTER TABLE separado.
    assert.match(sql, /FOREIGN KEY[\s\S]*?contract_id[\s\S]*?REFERENCES[\s\S]*?ctr_contracts/i);
  });

  it('CA-8: SQL cria UNIQUE em ctr_contracts.sequential_number', () => {
    const sql = readMigrationSql();
    // Pode aparecer como `UNIQUE KEY ... (sequential_number)` ou `CREATE UNIQUE INDEX`.
    assert.match(sql, /UNIQUE[\s\S]{0,80}sequential_number/i);
  });

  it('CA-9: SQL cria PK composta (contract_id, amendment_id) em ctr_contract_homologated_amendments', () => {
    const sql = readMigrationSql();
    assert.match(
      sql,
      /PRIMARY KEY\s*\(?\s*`?contract_id`?\s*,\s*`?amendment_id`?\s*\)?/i,
      'PK composta (contract_id, amendment_id) ausente',
    );
  });
});

// ─── CA-10 a CA-14 — Aplicação E2E real contra MySQL do compose ───────────
// Esta suite é PASSIVA quanto ao lifecycle do compose: não sobe nem derruba o
// container. Razão: o `mysql-compose.test.ts` (ticket #1) também testa o
// lifecycle do MySQL e dois `before/after` paralelos com `compose down -v`
// destroem o ambiente um do outro. Aqui apenas assumimos um MySQL externo via
// `core-api-mysql`; se ausente, todos os CAs funcionais fazem `t.skip()`.
// Quem orquestra: `pnpm test:integration` (sobe MySQL → roda suite → derruba).
describe('CTR-DB-MIGRATION-MYSQL — CA-10..14: aplicação E2E contra MySQL real', () => {
  let appliedOk = false;
  let envReady = false;
  let skipReason = '';

  before(() => {
    // Opt-in: CAs funcionais só rodam quando `MYSQL_INTEGRATION=1` está setado.
    // Razão: `pnpm test` default não orquestra Docker; o lifecycle é gerido pelo
    // target `pnpm test:integration`, que sobe o MySQL com `--wait` antes de
    // disparar o node:test. Sem opt-in, todos os CA-10..14 são `t.skip()`.
    if (Deno.env.get('MYSQL_INTEGRATION') !== '1') {
      skipReason = 'MYSQL_INTEGRATION≠1 (rode `pnpm test:integration`)';
      return;
    }
    if (!dockerAvailable()) {
      skipReason = 'docker indisponível';
      return;
    }
    const inspect = sh(`docker inspect ${CONTAINER} --format '{{.State.Health.Status}}'`);
    if (inspect.code !== 0 || inspect.stdout.trim() !== 'healthy') {
      skipReason = `container ${CONTAINER} não está healthy (rode 'pnpm test:integration')`;
      return;
    }
    envReady = true;
    // Drop/recreate DB para garantir estado limpo (init script já criou via env).
    // Sem backticks no nome do DB: `bash -c "..."` interpreta `` `core` ``
    // como command substitution (chamada ao comando "core"), produzindo
    // string vazia e syntax error silencioso. `core` não é reserved word —
    // dispensa backticks. (Bug descoberto em CTR-DB-DRIVER-MYSQL #4 quando
    // o database chegou ao before com tabelas pré-existentes vindas das
    // outras suítes de integração — `applyMigration` falhava com ER 1050.)
    const dropR = dockerExecRoot('DROP DATABASE IF EXISTS core', 'mysql');
    if (dropR.code !== 0) {
      process.stderr.write(`DROP DATABASE falhou: ${dropR.stderr}\n`);
    }
    const createR = dockerExecRoot(
      'CREATE DATABASE core CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci',
      'mysql',
    );
    if (createR.code !== 0) {
      process.stderr.write(`CREATE DATABASE falhou: ${createR.stderr}\n`);
    }
    const r = applyMigration();
    appliedOk = r.code === 0;
    if (!appliedOk) {
      process.stderr.write(`apply migration falhou: ${r.stderr}\n`);
    }
  });

  it('CA-10: aplicar migration contra MySQL retorna exit 0', (t) => {
    if (!envReady) {
      t.skip(skipReason);
      return;
    }
    assert.ok(appliedOk, 'aplicação da migration falhou (ver stderr acima)');
  });

  it('CA-11: information_schema.tables lista as 3 tabelas ctr_*', (t) => {
    if (!envReady) {
      t.skip(skipReason);
      return;
    }
    const r = dockerExecRoot(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'core' ORDER BY table_name",
      'mysql',
    );
    assert.equal(r.code, 0, `query falhou: ${r.stderr}`);
    const lines = r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const expected = ['ctr_amendments', 'ctr_contract_homologated_amendments', 'ctr_contracts'];
    for (const tableName of expected) {
      assert.ok(
        lines.includes(tableName),
        `tabela ${tableName} ausente em information_schema; obtido: ${lines.join(', ')}`,
      );
    }
  });

  it('CA-12: information_schema.check_constraints contém os 7 CHECKs', (t) => {
    if (!envReady) {
      t.skip(skipReason);
      return;
    }
    const r = dockerExecRoot(
      "SELECT constraint_name FROM information_schema.check_constraints WHERE constraint_schema = 'core' ORDER BY constraint_name",
      'mysql',
    );
    assert.equal(r.code, 0, `query falhou: ${r.stderr}`);
    const got = r.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const expected = [
      'ctr_amendments_homologation_completeness_chk',
      'ctr_amendments_kind_chk',
      'ctr_amendments_status_chk',
      'ctr_contracts_current_period_kind_chk',
      'ctr_contracts_ended_at_consistency_chk',
      'ctr_contracts_original_period_kind_chk',
      'ctr_contracts_status_chk',
    ];
    for (const c of expected) {
      assert.ok(got.includes(c), `CHECK ${c} ausente; obtido: ${got.join(', ')}`);
    }
  });

  it('CA-13: INSERT que viola F-L1 (status=Active com ended_at populado) é rejeitado', (t) => {
    if (!envReady) {
      t.skip(skipReason);
      return;
    }
    // Tentar Active com ended_at preenchido — deve violar bicondicional.
    const r = dockerExecRoot(
      `INSERT INTO ctr_contracts (
         id, sequential_number, title, objective, signed_at,
         original_value_cents, original_period_kind, original_period_start,
         current_value_cents, current_period_kind, current_period_start,
         status, ended_at
       ) VALUES (
         '00000000-0000-4000-8000-000000000001', 'TEST/2026', 't', 'o', NOW(3),
         1000, 'Fixed', NOW(3),
         1000, 'Fixed', NOW(3),
         'Active', NOW(3)
       )`,
    );
    assert.notEqual(r.code, 0, 'INSERT deveria ter sido rejeitado pelo CHECK F-L1');
    assert.match(r.stderr + r.stdout, /check\s+constraint|3819|violated/i);
  });

  it('CA-14: INSERT que viola F-L2 (status=Homologated sem completude) é rejeitado', (t) => {
    if (!envReady) {
      t.skip(skipReason);
      return;
    }
    // Setup: inserir um contrato válido para satisfazer FK
    const setup = dockerExecRoot(
      `INSERT INTO ctr_contracts (
         id, sequential_number, title, objective, signed_at,
         original_value_cents, original_period_kind, original_period_start,
         current_value_cents, current_period_kind, current_period_start,
         status, ended_at
       ) VALUES (
         '00000000-0000-4000-8000-000000000002', 'TEST/2026B', 't', 'o', NOW(3),
         1000, 'Fixed', NOW(3),
         1000, 'Fixed', NOW(3),
         'Active', NULL
       )`,
    );
    assert.equal(setup.code, 0, `setup contract falhou: ${setup.stderr}`);

    // Tentar Homologated sem homologated_at — deve violar F-L2.
    const r = dockerExecRoot(
      `INSERT INTO ctr_amendments (
         id, contract_id, amendment_number, description, created_at,
         kind, status
       ) VALUES (
         '00000000-0000-4000-8000-000000000003',
         '00000000-0000-4000-8000-000000000002',
         'AD 01-001/2026', 'd', NOW(3),
         'Misc', 'Homologated'
       )`,
    );
    assert.notEqual(r.code, 0, 'INSERT deveria ter sido rejeitado pelo CHECK F-L2');
    assert.match(r.stderr + r.stdout, /check\s+constraint|3819|violated/i);
  });
});
