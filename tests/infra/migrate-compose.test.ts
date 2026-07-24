/**
 * CORE-MIGRATE-JOB — Slice A — Wave W0 (RED)
 *
 * Valida a CONFIG do serviço one-shot `migrate` no compose (CA6/CA7), o secret
 * dedicado (CA8). Sem subir container — só `docker compose config` (resolve
 * profiles/secrets/depends_on). O guard de não-inversão do boot (ex-CA9) saiu daqui:
 * o Slice B (CORE-MIGRATE-BOOT-INVERT) inverte esse invariante.
 *
 * Skip-guard (FIN-TEST-INFRA-SKIP-GUARD): pulado sem o plugin `docker compose` no
 * PATH — NUNCA falha por ambiente.
 *
 * RED esperado: o serviço `migrate` e o secret `migrate_database_url` ainda não
 * existem no compose.yaml.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const COMPOSE_YAML = join(PROJECT_ROOT, 'compose.yaml');
const SERVICE = 'migrate';
const SECRET = 'migrate_database_url';

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

const migrate = (): ComposeService | undefined => configWithJobs()?.services?.[SERVICE];

describe('CORE-MIGRATE-JOB — serviço migrate no compose (W0)', { skip }, () => {
  it('CA6a: o serviço existe (com --profile jobs)', () => {
    assert.ok(migrate(), `serviço ${SERVICE} ausente no compose (profile jobs)`);
  });

  it('CA6b: restart "no" (one-shot)', () => {
    assert.equal(
      migrate()?.restart,
      'no',
      `restart deveria ser "no", foi ${String(migrate()?.restart)}`,
    );
  });

  it('CA6c: pertence ao profile jobs', () => {
    const profiles = migrate()?.profiles ?? [];
    assert.ok(
      profiles.includes('jobs'),
      `profiles deveria incluir "jobs", foi ${JSON.stringify(profiles)}`,
    );
  });

  it('CA6d: depende de mysql healthy', () => {
    const cond = migrate()?.depends_on?.['mysql']?.condition;
    assert.equal(
      cond,
      'service_healthy',
      `depends_on mysql deveria ser service_healthy, foi ${String(cond)}`,
    );
  });

  it('CA6e: usa o secret migrate_database_url (serviço + top-level)', () => {
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

  it('CA6f: hardening — no-new-privileges + cap_drop ALL + read_only', () => {
    const svc = migrate();
    assert.ok(
      (svc?.security_opt ?? []).some((o) => o.includes('no-new-privileges:true')),
      `security_opt no-new-privileges ausente, foi ${JSON.stringify(svc?.security_opt)}`,
    );
    assert.ok(
      (svc?.cap_drop ?? []).includes('ALL'),
      `cap_drop deveria incluir ALL, foi ${JSON.stringify(svc?.cap_drop)}`,
    );
    assert.equal(svc?.read_only, true, `read_only deveria ser true, foi ${String(svc?.read_only)}`);
  });

  it('CA6g: entrypoint+command executam o run.ts do migrate (não o server.ts)', () => {
    const svc = migrate();
    // `command` resolvido por `config --format json` vem como `null` quando não
    // declarado (não `undefined`) — `== null` cobre ambos sem exigir `command: []`
    // artificial no compose.
    const asArr = (v: readonly string[] | string | null | undefined): readonly string[] =>
      v === null || v === undefined ? [] : typeof v === 'string' ? [v] : v;
    const full = [...asArr(svc?.entrypoint), ...asArr(svc?.command)].join(' ');
    assert.doesNotMatch(full, /src\/server\.ts/, `o migrate não pode rodar o server: "${full}"`);
    assert.match(
      full,
      /src\/jobs\/migrate\/run\.ts/,
      `deveria executar o run.ts do migrate: "${full}"`,
    );
  });

  it('CA7: sem --profile jobs, o serviço NÃO é ativado (opt-in)', () => {
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

  it('CA8: scripts/setup/secrets.ts gera o secret migrate_database_url', () => {
    const src = readFileSync(join(PROJECT_ROOT, 'scripts', 'setup', 'secrets.ts'), 'utf-8');
    assert.match(
      src,
      /['"]migrate_database_url['"]/,
      'scripts/setup/secrets.ts deveria listar migrate_database_url em DATABASE_URL_SECRETS',
    );
  });
});
