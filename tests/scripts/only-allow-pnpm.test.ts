/**
 * CTR-PNPM-ONLY-ALLOW — W0 (RED)
 *
 * Cobre CA1, CA2, CA3 do ticket.
 *
 * Estado W0: RED — `scripts/only-allow-pnpm.ts` não existe → `node` sai com
 *   código 1 e stderr "Cannot find module", sem a mensagem PT-BR esperada.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const SCRIPT = fileURLToPath(new URL('../../scripts/ci/only-allow-pnpm.ts', import.meta.url));
const CWD = resolve(fileURLToPath(new URL('../../', import.meta.url)));

// Controla AMBOS os sinais que o guard inspeciona, sempre sobrescrevendo o que
// foi herdado do runner pnpm: `npm_config_user_agent` (pnpm 10/npm/yarn) e
// `npm_execpath` (fallback do pnpm 11, que deixa o UA vazio em lifecycle).
const runWith = (userAgent: string, execPath = ''): { code: number; stderr: string } => {
  // Deno.Command herda o ambiente e mescla `env` por cima (sobrescreve os dois sinais que o guard
  // inspeciona), dispensando o spread de process.env.
  const { code, stderr } = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', SCRIPT],
    cwd: CWD,
    env: { npm_config_user_agent: userAgent, npm_execpath: execPath },
    stdout: 'piped',
    stderr: 'piped',
  }).outputSync();
  return { code, stderr: new TextDecoder().decode(stderr) };
};

const NPM_EXECPATH = '/usr/lib/node_modules/npm/bin/npm-cli.js';
const PNPM_EXECPATH = '/home/dev/.cache/node/corepack/v1/pnpm/11.5.0/bin/pnpm.mjs';

describe('only-allow-pnpm guard', () => {
  it('CA1: aborta (exit ≠ 0) quando o user agent é npm', () => {
    const r = runWith('npm/10.0.0 node/v24.16.0 linux x64', NPM_EXECPATH);
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /ADR-0012/);
  });

  it('CA1: aborta (exit ≠ 0) quando o user agent é yarn', () => {
    const r = runWith('yarn/4.0.0 npm/? node/v24.16.0 linux x64', '/usr/lib/yarn/bin/yarn.js');
    assert.notEqual(r.code, 0);
  });

  it('CA1: aborta quando UA vazio e o execpath não é pnpm', () => {
    const r = runWith('', NPM_EXECPATH);
    assert.notEqual(r.code, 0);
  });

  it('CA1: aborta com UA "npm" mesmo que o execpath herdado seja pnpm', () => {
    // Regressão da migração pnpm 11: o execpath só vale quando o UA está vazio.
    const r = runWith('npm/10.0.0 node/v24.16.0 linux x64', PNPM_EXECPATH);
    assert.notEqual(r.code, 0);
  });

  it('CA2: permite (exit 0) quando o user agent é pnpm (v10)', () => {
    const r = runWith('pnpm/10.33.4 npm/? node/v24.16.0 linux x64', PNPM_EXECPATH);
    assert.equal(r.code, 0);
  });

  it('CA2: permite (exit 0) no pnpm 11 — UA vazio + execpath pnpm', () => {
    const r = runWith('', PNPM_EXECPATH);
    assert.equal(r.code, 0);
  });

  it('CA3: mensagem de erro está em PT-BR e cita ADR-0012', () => {
    const r = runWith('npm/10.0.0 node/v24.16.0 linux x64', NPM_EXECPATH);
    assert.match(r.stderr, /pnpm/);
    assert.match(r.stderr, /ADR-0012/);
  });
});
