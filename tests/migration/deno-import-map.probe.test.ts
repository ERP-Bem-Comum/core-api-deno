import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';

import { ok, isOk } from '#src/shared/primitives/result.ts';
import { describeReason } from '#scripts/etl/quarantine/reason.ts';

// Canário do import map do cutover Deno (Etapa 1 / DENO-CUTOVER-TOOLING).
// Exercita os DOIS prefixos de subpath import — #src/ e #scripts/ — com alvos PUROS
// (sem bare specifier de npm), para que a resolução seja o único sinal.
// Sob `DENO_NO_PACKAGE_JSON=1 deno check` fica RED até o deno.json#imports declarar os
// prefixos (trailing-slash); com o package.json no path, resolve via compat de Node.
describe('deno import-map probe', () => {
  it('resolve #src/ e #scripts/', () => {
    assert.ok(isOk(ok(1)));
    assert.equal(typeof describeReason, 'function');
  });
});
