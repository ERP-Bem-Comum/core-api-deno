/**
 * AUTH-SYNC-PERMISSIONS-JOB (#462) — CA4 — contrato de saída do processo.
 *
 * O `config.test.ts` cobre a função pura; aqui, o que o orquestrador do deploy enxerga: o exit code
 * (sysexits.h, 78 = EX_CONFIG). Roda sem banco — a env falha ANTES de abrir handle, e é essa ORDEM
 * que o teste trava: um job que conectasse primeiro daria exit 1, não 78.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';

import { moduleDir } from '#src/shared/module-dir.ts';

const REPO_ROOT = resolve(moduleDir(import.meta.url), '..', '..', '..');
const RUN = resolve(REPO_ROOT, 'src', 'jobs', 'auth', 'sync-permissions', 'run.ts');
const EX_CONFIG = 78;

type RunOutcome = Readonly<{ code: number; stderr: string }>;

// `spawn` em vez de `execFile` promisificado: aqui o exit code != 0 é o resultado ESPERADO, não
// uma exceção a capturar. O evento `close` entrega o código direto.
//
// Env mínima e explícita: herdar `process.env` vazaria uma AUTH_DATABASE_URL da máquina do dev e
// o teste passaria a depender do ambiente.
const runJob = async (env: Readonly<Record<string, string>>): Promise<RunOutcome> => {
  const command = new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', RUN],
    cwd: REPO_ROOT,
    // clearEnv: Deno.Command HERDA o env por padrão (oposto do spawn sem `env`). Sem isto, uma
    // AUTH_DATABASE_URL da máquina do dev vazaria e o teste passaria a depender do ambiente.
    clearEnv: true,
    env: { PATH: Deno.env.get('PATH') ?? '', ...env },
    stdout: 'null',
    stderr: 'piped',
  });
  const { code, stderr } = await command.output();
  return { code, stderr: new TextDecoder().decode(stderr) };
};

describe('job sync-permissions — exit codes — AUTH-SYNC-PERMISSIONS-JOB W0 (CA4)', () => {
  it('CA4: sem AUTH_DATABASE_URL → exit 78 (EX_CONFIG) e stderr nomeia a env', async () => {
    const { code, stderr } = await runJob({});
    assert.equal(
      code,
      EX_CONFIG,
      `esperado ${EX_CONFIG} (EX_CONFIG), veio ${code}. stderr: ${stderr}`,
    );
    assert.match(
      stderr,
      /AUTH_DATABASE_URL|auth-database-url-missing/,
      'o operador precisa ler no stderr QUAL env falta',
    );
  });

  it('CA4: AUTH_DATABASE_URL só com espaços → exit 78 (não passa por válida)', async () => {
    const { code } = await runJob({ AUTH_DATABASE_URL: '   ' });
    assert.equal(code, EX_CONFIG);
  });
});
