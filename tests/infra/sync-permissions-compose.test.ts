/**
 * #462 — config do serviço one-shot `sync-permissions` no compose.
 *
 * O compose.yaml gera os taskdefs de produção, então a ORDEM declarada aqui é a ordem real do
 * deploy. O que o teste trava: `migrate` (schema) → `sync-permissions` (RBAC) → `http`. Sem o elo
 * final, o http subiria com catálogo defasado e responderia 403 mudo — o defeito da issue.
 *
 * Sem subir container: só `docker compose config`, que resolve profiles/secrets/depends_on.
 *
 * Skip-guard (FIN-TEST-INFRA-SKIP-GUARD): pulado sem o plugin `docker compose` no PATH — NUNCA
 * falha por ambiente.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const COMPOSE_YAML = join(PROJECT_ROOT, 'compose.yaml');
const SERVICE = 'sync-permissions';
const SECRET = 'auth_database_url';

interface ExecOk {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Nenhum call-site deste arquivo passa timeout customizado — parâmetro removido.
const sh = (cmd: string): ExecOk => {
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

interface ComposeService {
  readonly restart?: string;
  readonly profiles?: readonly string[];
  readonly depends_on?: Readonly<Record<string, { readonly condition?: string }>>;
  readonly secrets?: readonly (string | { readonly source?: string })[];
  readonly read_only?: boolean;
  readonly command?: readonly string[] | string;
  readonly entrypoint?: readonly string[] | string;
}
interface ComposeConfig {
  readonly services?: Readonly<Record<string, ComposeService>>;
  readonly secrets?: Readonly<Record<string, unknown>>;
}

const configFor = (profile: string): ComposeConfig | null => {
  const r = sh(`docker compose -f "${COMPOSE_YAML}" --profile ${profile} config --format json`);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as ComposeConfig;
  } catch {
    return null;
  }
};

const svc = (): ComposeService | undefined => configFor('jobs')?.services?.[SERVICE];

describe('#462 — serviço sync-permissions no compose', { skip }, () => {
  it('o serviço existe (com --profile jobs)', () => {
    assert.ok(svc(), `serviço ${SERVICE} ausente no compose`);
  });

  it('one-shot: restart "no" + read_only', () => {
    assert.equal(svc()?.restart, 'no', 'job não pode ficar em restart loop');
    assert.equal(svc()?.read_only, true, 'hardening do x-job-base perdido');
  });

  // O elo que fecha o #462: sem isto o job existe mas não roda no deploy.
  it('roda DEPOIS do migrate — o schema tem que existir (não migra por conta própria)', () => {
    assert.equal(
      svc()?.depends_on?.['migrate']?.condition,
      'service_completed_successfully',
      'sincronizar não migra: sem o schema, o job deve rodar depois, não criar tabela',
    );
  });

  it('mantém mysql healthy — o depends_on explícito sobrescreve o do x-job-base', () => {
    assert.equal(
      svc()?.depends_on?.['mysql']?.condition,
      'service_healthy',
      'o merge `<<:` não funde depends_on — mysql precisa ser redeclarado',
    );
  });

  it('o http só sobe DEPOIS do sync — catálogo defasado é 403 mudo', () => {
    const http = configFor('app')?.services?.['http'];
    assert.ok(http, 'serviço http ausente no profile app');
    assert.equal(
      http?.depends_on?.[SERVICE]?.condition,
      'service_completed_successfully',
      'sem este elo o http atende com catálogo defasado — o defeito do #462',
    );
  });

  it('é ativado nos mesmos profiles do http (senão o http trava esperando)', () => {
    const profiles = svc()?.profiles ?? [];
    for (const p of ['app', 'workers', 'jobs']) {
      assert.ok(profiles.includes(p), `profile "${p}" ausente: ${JSON.stringify(profiles)}`);
    }
  });

  it('reusa o secret auth_database_url (serviço + top-level) — sem secret novo', () => {
    const cfg = configFor('jobs');
    const names = (cfg?.services?.[SERVICE]?.secrets ?? []).map((s) =>
      typeof s === 'string' ? s : (s.source ?? ''),
    );
    assert.ok(names.includes(SECRET), `secret ${SECRET} ausente: ${JSON.stringify(names)}`);
    assert.ok(cfg?.secrets?.[SECRET], `secret top-level ${SECRET} ausente`);
  });

  it('executa o run.ts do job, não o server.ts', () => {
    const asArr = (v: readonly string[] | string | null | undefined): readonly string[] =>
      v === null || v === undefined ? [] : typeof v === 'string' ? [v] : v;
    const full = [...asArr(svc()?.entrypoint), ...asArr(svc()?.command)].join(' ');
    assert.doesNotMatch(full, /src\/server\.ts/, `o job não pode subir o server: "${full}"`);
    assert.match(
      full,
      /src\/jobs\/auth\/sync-permissions\/run\.ts/,
      `entrypoint errado: "${full}"`,
    );
  });
});
