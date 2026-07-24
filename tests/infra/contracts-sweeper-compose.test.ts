/**
 * CTR-SWEEPER-CRON — Wave W0 (RED)
 *
 * Valida a CONFIG do serviço one-shot `contracts-sweeper` no compose (#50 / ADR-0041),
 * sem subir container — só `docker compose config` (resolve profiles/secrets/depends_on).
 *
 * Skip-guard (FIN-TEST-INFRA-SKIP-GUARD): pulado sem o plugin `docker compose` no PATH —
 * NUNCA falha por ambiente. Os critérios de exit-code (rodar o container) ficam na suíte
 * de bootstrap gated por `COMPOSE_INTEGRATION` (fora deste W0 de sintaxe).
 *
 * RED esperado: o serviço `contracts-sweeper` ainda NÃO existe no compose.yaml.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const COMPOSE_YAML = join(PROJECT_ROOT, 'compose.yaml');
const SERVICE = 'contracts-sweeper';
const SECRET = 'contracts_database_url';

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

// Config resolvida COM o profile jobs ativo (onde o serviço one-shot vive).
interface ComposeService {
  readonly restart?: string;
  readonly profiles?: readonly string[];
  readonly depends_on?: Readonly<Record<string, { readonly condition?: string }>>;
  readonly secrets?: readonly (string | { readonly source?: string })[];
  readonly security_opt?: readonly string[];
  readonly command?: readonly string[] | string;
  readonly entrypoint?: readonly string[] | string;
  readonly container_name?: string;
  readonly cap_drop?: readonly string[];
  readonly read_only?: boolean;
}
interface ComposeConfig {
  readonly services?: Readonly<Record<string, ComposeService>>;
  readonly secrets?: Readonly<Record<string, unknown>>;
}

const configWithJobs = (): ComposeConfig | null => {
  const r = sh(`docker compose -f "${COMPOSE_YAML}" --profile jobs config --format json`);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as ComposeConfig;
  } catch {
    return null;
  }
};

const sweeper = (): ComposeService | undefined => configWithJobs()?.services?.[SERVICE];

describe('CTR-SWEEPER-CRON — serviço contracts-sweeper no compose (W0)', { skip }, () => {
  it('CA1a: o serviço existe (com --profile jobs)', () => {
    assert.ok(sweeper(), `serviço ${SERVICE} ausente no compose (profile jobs)`);
  });

  it('CA1b: restart "no" (one-shot — ADR-0041)', () => {
    assert.equal(
      sweeper()?.restart,
      'no',
      `restart deveria ser "no", foi ${String(sweeper()?.restart)}`,
    );
  });

  it('CA1c: pertence ao profile jobs', () => {
    const profiles = sweeper()?.profiles ?? [];
    assert.ok(
      profiles.includes('jobs'),
      `profiles deveria incluir "jobs", foi ${JSON.stringify(profiles)}`,
    );
  });

  it('CA1d: depende de mysql healthy', () => {
    const cond = sweeper()?.depends_on?.['mysql']?.condition;
    assert.equal(
      cond,
      'service_healthy',
      `depends_on mysql deveria ser service_healthy, foi ${String(cond)}`,
    );
  });

  it('CA1e: usa o secret contracts_database_url (serviço + top-level)', () => {
    const cfg = configWithJobs();
    const names = (cfg?.services?.[SERVICE]?.secrets ?? []).map((s) =>
      typeof s === 'string' ? s : (s.source ?? ''),
    );
    assert.ok(
      names.includes(SECRET),
      `serviço deveria usar o secret ${SECRET}, foi ${JSON.stringify(names)}`,
    );
    assert.ok(cfg?.secrets?.[SECRET], `secret top-level ${SECRET} ausente em secrets:`);
  });

  it('CA1f: security_opt no-new-privileges', () => {
    const opts = sweeper()?.security_opt ?? [];
    assert.ok(
      opts.some((o) => o.includes('no-new-privileges:true')),
      `security_opt no-new-privileges ausente, foi ${JSON.stringify(opts)}`,
    );
  });

  it('CA1g: entrypoint+command executam o run.ts do sweeper (não o server.ts)', () => {
    const svc = sweeper();
    const asArr = (v: readonly string[] | string | undefined): readonly string[] =>
      v === undefined ? [] : typeof v === 'string' ? [v] : v;
    const full = [...asArr(svc?.entrypoint), ...asArr(svc?.command)].join(' ');
    assert.doesNotMatch(full, /src\/server\.ts/, `o sweeper não pode rodar o server: "${full}"`);
    assert.match(
      full,
      /src\/jobs\/contracts\/sweeper\/run\.ts/,
      `entrypoint+command deveria executar o run.ts do sweeper: "${full}"`,
    );
  });

  it('CA1h: SEM container_name fixo (M2 — evita conflito de nome → cron silencioso)', () => {
    assert.equal(
      sweeper()?.container_name,
      undefined,
      `container_name fixo reintroduz o bug M2: ${String(sweeper()?.container_name)}`,
    );
  });

  it('CA1i: hardening — cap_drop ALL + read_only', () => {
    const svc = sweeper();
    assert.ok(
      (svc?.cap_drop ?? []).includes('ALL'),
      `cap_drop deveria incluir ALL, foi ${JSON.stringify(svc?.cap_drop)}`,
    );
    assert.equal(svc?.read_only, true, `read_only deveria ser true, foi ${String(svc?.read_only)}`);
  });

  it('CA3: sem --profile jobs, o serviço NÃO é ativado (opt-in)', () => {
    const r = sh(`docker compose -f "${COMPOSE_YAML}" config --services`);
    assert.equal(r.code, 0, `config --services falhou: ${r.stderr}`);
    const services = r.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    assert.ok(
      !services.includes(SERVICE),
      `${SERVICE} não deveria estar ativo sem --profile jobs, foi ${JSON.stringify(services)}`,
    );
  });
});
