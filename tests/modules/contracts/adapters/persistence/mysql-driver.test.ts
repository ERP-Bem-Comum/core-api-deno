/**
 * CTR-DB-DRIVER-MYSQL — W0 (RED) — driver level
 *
 * Cobre CA-1 (dep mysql2), CA-2 (exports), CA-5..CA-8 (runtime).
 *
 * Camadas:
 *   (1) Estrutural — package.json e shape do módulo do driver (sem Docker).
 *   (2) Funcional — abre pool real contra `core-api-mysql` healthy (opt-in via
 *       `MYSQL_INTEGRATION=1`, igual ao padrão estabelecido no ticket #3).
 *
 * Sustentação: ADR-0020, ADR-0013, decisões D1–D10 de `000-request.md`.
 */

import { describe, it, before } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  MysqlConnectOptions,
  MysqlDriverError,
  MysqlHandle,
} from '#src/modules/contracts/adapters/persistence/drivers/mysql-driver.ts';
import { openMysql } from '#src/modules/contracts/adapters/persistence/drivers/mysql-driver.ts';

// ─── Paths ────────────────────────────────────────────────────────────────
const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..', '..', '..', '..');
const PACKAGE_JSON = join(PROJECT_ROOT, 'package.json');

// Credenciais sincronizadas com os secrets fixos do `pnpm test:integration`
// (escritos pelo script no `package.json`). Não usar em produção.
const VALID_CONN = 'mysql://root:rootpw-migration-test-only@127.0.0.1:3306/core';
const BAD_AUTH_CONN = 'mysql://invalid:invalid@127.0.0.1:3306/inexistente';

const integrationEnabled = (): boolean => Deno.env.get('MYSQL_INTEGRATION') === '1';
const skipReason = (): string =>
  integrationEnabled() ? 'unexpected' : 'MYSQL_INTEGRATION≠1 (rode `pnpm test:integration`)';

// Reset hard do database `core` via docker exec — garante estado limpo
// (sem `__drizzle_migrations` orfã que o test do ticket #3 não popula).
// Necessário antes do CA-8 quando suites integration rodam em série.
const DUMMY_ROOT_PWD = 'rootpw-migration-test-only';
const CONTAINER = 'core-api-mysql';
const resetCoreDatabase = (): void => {
  new Deno.Command('bash', {
    args: [
      '-c',
      `docker exec ${CONTAINER} mysql --protocol=tcp -h 127.0.0.1 -uroot -p"${DUMMY_ROOT_PWD}" -e "DROP DATABASE IF EXISTS core; CREATE DATABASE core CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" mysql`,
    ],
    stdout: 'piped',
    stderr: 'piped',
  }).outputSync();
};

// ─── CA-1 — Dependência mysql2 ────────────────────────────────────────────
describe('CTR-DB-DRIVER-MYSQL — CA-1: dependência mysql2', () => {
  it('CA-1: package.json#dependencies.mysql2 é ^3.x', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')) as {
      dependencies?: Record<string, string>;
    };
    const v = pkg.dependencies?.['mysql2'];
    assert.ok(v, 'mysql2 não declarado em dependencies');
    assert.match(v, /^\^3\./, `mysql2 deve ser ^3.x (atual: ${v})`);
  });
});

// ─── CA-2 — Exports do mysql-driver.ts ────────────────────────────────────
describe('CTR-DB-DRIVER-MYSQL — CA-2: shape do mysql-driver.ts', () => {
  it('CA-2: openMysql é uma função async com a assinatura esperada', () => {
    assert.equal(typeof openMysql, 'function');
    // Smoke do shape: a função deve aceitar 1 argumento (options).
    assert.equal(openMysql.length, 1, 'openMysql deve receber 1 argumento (MysqlConnectOptions)');
  });

  // Os types MysqlConnectOptions, MysqlHandle, MysqlDriverError são validados
  // estaticamente — se não exportados, este arquivo nem compila (CA-2 falha
  // no W0 RED por erro de import).
  it('CA-2: tipos exportados (validação via import — basta o arquivo compilar)', () => {
    type _Opts = MysqlConnectOptions;
    type _Handle = MysqlHandle;
    type _Err = MysqlDriverError;
    assert.ok(true);
  });
});

// ─── CA-5..CA-8 — Runtime contra MySQL real (opt-in) ──────────────────────
describe('CTR-DB-DRIVER-MYSQL — CA-5..8: runtime contra MySQL real', () => {
  let envReady = false;
  let skipMsg = '';

  before(() => {
    if (!integrationEnabled()) {
      skipMsg = skipReason();
      return;
    }
    envReady = true;
  });

  it('CA-5: openMysql contra container healthy retorna ok(handle)', async (t) => {
    if (!envReady) {
      t.skip(skipMsg);
      return;
    }
    const r = await openMysql({ connectionString: VALID_CONN, applyMigrations: false });
    assert.ok(r.ok, `openMysql falhou: ${!r.ok ? r.error : ''}`);
    if (!r.ok) return;
    await r.value.close();
  });

  it('CA-6: openMysql contra credenciais inválidas retorna mysql-driver-connect-failed', async (t) => {
    if (!envReady) {
      t.skip(skipMsg);
      return;
    }
    const r = await openMysql({ connectionString: BAD_AUTH_CONN, applyMigrations: false });
    assert.equal(r.ok, false, 'esperado err');
    if (r.ok) return;
    assert.equal(r.error, 'mysql-driver-connect-failed');
  });

  it('CA-7: openMysql com string mal-formada retorna mysql-driver-connection-string-invalid', async (t) => {
    if (!envReady) {
      t.skip(skipMsg);
      return;
    }
    const r = await openMysql({
      connectionString: 'http://not-a-mysql-url',
      applyMigrations: false,
    });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.error, 'mysql-driver-connection-string-invalid');
  });

  it('CA-8: openMysql com applyMigrations: true é idempotente (duas chamadas seguidas)', async (t) => {
    if (!envReady) {
      t.skip(skipMsg);
      return;
    }
    // Reset DB pra garantir estado determinístico — outras suites integration
    // podem ter aplicado tabelas SEM popular `__drizzle_migrations` (ex.: o
    // migration test do ticket #3 aplica via `docker exec mysql`, fora do
    // controle do drizzle migrator). Sem reset, o migrator tenta CREATE TABLE
    // em tabela existente → ER 1050.
    resetCoreDatabase();

    // Primeira aplicação: garante schema presente (ou no-op se já presente).
    const r1 = await openMysql({ connectionString: VALID_CONN, applyMigrations: true });
    assert.ok(r1.ok, `1ª openMysql falhou: ${!r1.ok ? r1.error : ''}`);
    if (!r1.ok) return;
    await r1.value.close();

    // Segunda aplicação: deve passar sem erro (journal entende que migration
    // 0000 já foi aplicada).
    const r2 = await openMysql({ connectionString: VALID_CONN, applyMigrations: true });
    assert.ok(r2.ok, `2ª openMysql falhou: ${!r2.ok ? r2.error : ''}`);
    if (!r2.ok) return;
    await r2.value.close();
  });
});
