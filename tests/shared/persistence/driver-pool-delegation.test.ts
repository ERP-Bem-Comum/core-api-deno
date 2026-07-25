/**
 * CORE-DB-POOL-CONFIG-INVARIANT — W0 (RED) — CA-7: os 7 drivers delegam ao builder compartilhado.
 *
 * Cada `build*PoolOptions` deve passar a retornar `Result<PoolOptions, PoolConfigError>` (delegando
 * a `src/shared/persistence/mysql-pool-config.ts`) em vez de `PoolOptions` cru — assim a invariante
 * `maxIdle < connectionLimit` mora em UM lugar e não pode ser reintroduzida por cópia (o vetor que
 * propagou o bug do Incident-0001 para 7 módulos).
 *
 * DEVE FALHAR: hoje os build*PoolOptions retornam `PoolOptions` direto (sem `.ok`), então tanto a
 * propagação de erro quanto a garantia de `maxIdle` inexistem.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildPoolOptions as buildContracts } from '#src/modules/contracts/adapters/persistence/drivers/mysql-driver.ts';
import { buildAuthPoolOptions } from '#src/modules/auth/adapters/persistence/drivers/mysql-driver.ts';
import { buildPoolOptions as buildFinancial } from '#src/modules/financial/adapters/persistence/drivers/mysql-driver.ts';
import { buildPartnersPoolOptions } from '#src/modules/partners/adapters/persistence/drivers/mysql-driver.ts';
import { buildProgramsPoolOptions } from '#src/modules/programs/adapters/persistence/drivers/mysql-driver.ts';
import { buildBudgetPlansPoolOptions } from '#src/modules/budget-plans/adapters/persistence/drivers/mysql-driver.ts';
import { buildNotificationsPoolOptions } from '#src/modules/notifications/adapters/persistence/drivers/mysql-driver.ts';

const CONN = 'mysql://core:pw@127.0.0.1:3306/core';

// deno-lint-ignore no-explicit-any
const DRIVERS: readonly (readonly [string, (o: any) => unknown])[] = [
  ['contracts', buildContracts],
  ['auth', buildAuthPoolOptions],
  ['financial', buildFinancial],
  ['partners', buildPartnersPoolOptions],
  ['programs', buildProgramsPoolOptions],
  ['budget-plans', buildBudgetPlansPoolOptions],
  ['notifications', buildNotificationsPoolOptions],
];

describe('CA-7: os 7 drivers delegam ao builder compartilhado (Result)', () => {
  for (const [name, build] of DRIVERS) {
    it(`CA-7: ${name} → config válida retorna ok com maxIdle < connectionLimit`, () => {
      const r = build({ connectionString: CONN, poolLimit: 10 }) as
        | { ok: true; value: { maxIdle?: number; connectionLimit?: number } }
        | { ok: false; error: string };
      assert.equal(r.ok, true);
      if (!r.ok) return;
      assert.ok(r.value.maxIdle! < r.value.connectionLimit!);
    });

    it(`CA-7: ${name} → config inválida (poolLimit 0) propaga err(pool-config-connection-limit-invalid)`, () => {
      const r = build({ connectionString: CONN, poolLimit: 0 }) as
        | { ok: true; value: unknown }
        | { ok: false; error: string };
      assert.equal(r.ok, false);
      if (r.ok) return;
      assert.equal(r.error, 'pool-config-connection-limit-invalid');
    });
  }
});
