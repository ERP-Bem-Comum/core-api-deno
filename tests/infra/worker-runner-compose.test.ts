/**
 * CORE-WORKER-CONSOLIDATION-DEPLOY — Wave W0 (RED)
 *
 * Valida a CONSOLIDAÇÃO dos workers no compose (#407, Fatia 2): os 6 serviços standalone do
 * profile `workers` viram 3 serviços de GRUPO (`worker-outbox`, `worker-projections`,
 * `worker-email`), cada um rodando o worker-runner (`src/workers/runner/run.ts`) com
 * `WORKER_GROUP` + a união dos secrets do grupo. Sem subir container — só `docker compose
 * config` (resolve profiles/secrets/env/anchors).
 *
 * Skip-guard (FIN-TEST-INFRA-SKIP-GUARD): pulado sem o plugin `docker compose` no PATH —
 * NUNCA falha por ambiente.
 *
 * RED esperado: o compose ainda expõe os 6 serviços antigos; os 3 de grupo não existem.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const COMPOSE_YAML = join(PROJECT_ROOT, 'compose.yaml');

const RUNNER = 'src/workers/runner/run.ts';

// Serviços de grupo esperados após a consolidação → contrato de secrets + WORKER_GROUP.
const EXPECTED = {
  'worker-outbox': {
    group: 'outbox',
    secrets: ['contracts_database_url', 'partners_database_url'],
  },
  'worker-projections': {
    group: 'projections',
    secrets: ['contracts_database_url', 'partners_database_url', 'financial_database_url'],
  },
  'worker-email': {
    group: 'email',
    secrets: ['auth_database_url', 'partners_database_url', 'smtp_pass'],
  },
} as const;

// Nomes standalone da Fatia 0 que NÃO podem sobreviver à consolidação.
const LEGACY_WORKERS = [
  'outbox-contracts',
  'outbox-partners',
  'supplier-projection',
  'payable-projection',
  'contract-count-projection',
  'email-dispatch',
] as const;

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
  readonly profiles?: readonly string[];
  readonly depends_on?: Readonly<Record<string, { readonly condition?: string }>>;
  readonly secrets?: readonly (string | { readonly source?: string })[];
  readonly security_opt?: readonly string[];
  readonly command?: readonly string[] | string;
  readonly entrypoint?: readonly string[] | string;
  readonly environment?: Readonly<Record<string, string>> | readonly string[];
  readonly cap_drop?: readonly string[];
  readonly read_only?: boolean;
}
interface ComposeConfig {
  readonly services?: Readonly<Record<string, ComposeService>>;
  readonly secrets?: Readonly<Record<string, unknown>>;
}

// Os workers herdam `depends_on: http` (profile `app`) via x-worker-base. `docker compose config`
// valida depends_on contra o conjunto de serviços ativos → resolver só com `--profile workers`
// falha ("depends on undefined service http"). Ativa-se `app` junto e isolam-se os workers pela
// diferença (workers+app) − (app).
const WORKER_PROFILES = '--profile workers --profile app';
const APP_PROFILE = '--profile app';

const configWithWorkers = (): ComposeConfig | null => {
  const r = sh(`docker compose -f "${COMPOSE_YAML}" ${WORKER_PROFILES} config --format json`);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as ComposeConfig;
  } catch {
    return null;
  }
};

// Lista os serviços ativados por um dado conjunto de profiles (vazio = default).
const activeServices = (profileFlag: string): readonly string[] => {
  const r = sh(`docker compose -f "${COMPOSE_YAML}" ${profileFlag} config --services`);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
};

// `docker compose config --format json` emite campos AUSENTES como `null` (não undefined) —
// ex.: um serviço só com `entrypoint` traz `command: null`. Trata-se null junto de undefined.
const asArr = (v: readonly string[] | string | null | undefined): readonly string[] =>
  v === undefined || v === null ? [] : typeof v === 'string' ? [v] : v;

const secretNames = (svc: ComposeService | undefined): readonly string[] =>
  (svc?.secrets ?? []).map((s) => (typeof s === 'string' ? s : (s.source ?? '')));

const envValue = (svc: ComposeService | undefined, key: string): string | undefined => {
  const env = svc?.environment;
  if (env === undefined || env === null) return undefined;
  if (Array.isArray(env)) {
    const hit = (env as readonly string[]).find((e) => e.startsWith(`${key}=`));
    return hit === undefined ? undefined : hit.slice(key.length + 1);
  }
  return (env as Record<string, string>)[key];
};

describe('CORE-WORKER-CONSOLIDATION-DEPLOY — 6→3 workers no compose (W0)', { skip }, () => {
  it('CA-1: profile workers ativa exatamente os 3 serviços de grupo', () => {
    const workerOnly = activeServices(WORKER_PROFILES).filter(
      (s) => !activeServices(APP_PROFILE).includes(s),
    );
    assert.deepEqual(
      [...workerOnly].sort(),
      ['worker-email', 'worker-outbox', 'worker-projections'],
      `profile workers deveria expor só os 3 grupos, expôs ${JSON.stringify(workerOnly)}`,
    );
  });

  it('CA-1b: nenhum nome de worker standalone sobrevive', () => {
    const all = activeServices(WORKER_PROFILES);
    for (const legacy of LEGACY_WORKERS) {
      assert.ok(!all.includes(legacy), `serviço legado ${legacy} ainda existe no compose`);
    }
  });

  for (const [name, spec] of Object.entries(EXPECTED)) {
    describe(`serviço ${name} (grupo ${spec.group})`, () => {
      const svc = (): ComposeService | undefined => configWithWorkers()?.services?.[name];

      it('CA-2: executa o worker-runner (não server.ts nem run.ts por-worker)', () => {
        const full = [...asArr(svc()?.entrypoint), ...asArr(svc()?.command)].join(' ');
        assert.match(
          full,
          new RegExp(RUNNER.replace(/[/.]/g, '\\$&')),
          `deveria rodar o runner: "${full}"`,
        );
        assert.doesNotMatch(full, /src\/server\.ts/, `worker não pode rodar o server: "${full}"`);
        assert.doesNotMatch(
          full,
          /worker\/run\.ts|projection\/run\.ts|email-dispatch\/run\.ts/,
          `worker não pode rodar um run.ts standalone: "${full}"`,
        );
      });

      it('CA-3: WORKER_GROUP correto', () => {
        assert.equal(
          envValue(svc(), 'WORKER_GROUP'),
          spec.group,
          `WORKER_GROUP deveria ser ${spec.group}, foi ${String(envValue(svc(), 'WORKER_GROUP'))}`,
        );
      });

      it('CA-4: união de secrets do grupo (serviço + top-level)', () => {
        const cfg = configWithWorkers();
        const names = secretNames(cfg?.services?.[name]);
        for (const secret of spec.secrets) {
          assert.ok(
            names.includes(secret),
            `${name} deveria usar o secret ${secret}, tem ${JSON.stringify(names)}`,
          );
          assert.ok(cfg?.secrets?.[secret], `secret top-level ${secret} ausente em secrets:`);
        }
      });

      it('CA-5: hardening preservado (cap_drop ALL + read_only + no-new-privileges + depends_on healthy)', () => {
        const s = svc();
        assert.ok(
          (s?.cap_drop ?? []).includes('ALL'),
          `cap_drop ALL ausente: ${JSON.stringify(s?.cap_drop)}`,
        );
        assert.equal(s?.read_only, true, `read_only deveria ser true, foi ${String(s?.read_only)}`);
        assert.ok(
          (s?.security_opt ?? []).some((o) => o.includes('no-new-privileges:true')),
          `no-new-privileges ausente: ${JSON.stringify(s?.security_opt)}`,
        );
        assert.equal(
          s?.depends_on?.['mysql']?.condition,
          'service_healthy',
          `depends_on mysql deveria ser service_healthy, foi ${String(s?.depends_on?.['mysql']?.condition)}`,
        );
      });
    });
  }

  it('CA-6: sem --profile workers, nenhum grupo é ativado (opt-in)', () => {
    const base = activeServices('');
    for (const name of Object.keys(EXPECTED)) {
      assert.ok(!base.includes(name), `${name} não deveria estar ativo sem --profile workers`);
    }
  });
});
