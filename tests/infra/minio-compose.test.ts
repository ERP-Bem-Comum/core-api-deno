/**
 * issue #51 — hardening Docker MinIO (W0 sintaxe, sem subir container)
 *
 * Valida os critérios de aceite da issue #51 contra a config canônica do
 * compose.yaml usando `docker compose config --format json` — NÃO sobe
 * containers. Modelo: contracts-sweeper-compose.test.ts.
 *
 * CA1: serviço minio usa MINIO_ROOT_PASSWORD_FILE e NÃO expõe MINIO_ROOT_PASSWORD
 *      em texto claro nas env vars.
 * CA2: secrets `minio_root_user` / `minio_root_password` declarados no bloco
 *      top-level e referenciados nos serviços minio e minio-bootstrap.
 * CA3: imagem `minio/mc` referenciada com @sha256: (digest pin — ADR-0011).
 * CA4: entrypoint do minio-bootstrap não contém a string literal da senha;
 *      lê credenciais via $(cat /run/secrets/...) em runtime.
 * CA5: serviço `app` (profile `app`) declara healthcheck explícito.
 *
 * Skip-guard (padrão FIN-TEST-INFRA-SKIP-GUARD): pulado sem o plugin
 * `docker compose` no PATH — NUNCA falha por ambiente.
 */

import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Paths ────────────────────────────────────────────────────────────────
const HERE = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = resolve(HERE, '..', '..');
const COMPOSE_YAML = join(PROJECT_ROOT, 'compose.yaml');

// ─── Helpers ──────────────────────────────────────────────────────────────
interface ExecOk {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

// Nenhum call-site deste arquivo passa timeout customizado — parâmetro removido
// (ver mysql-compose.test.ts para o caso com `timeoutMs` de fato usado).
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

// ─── Tipos da config Compose resolvida ────────────────────────────────────
interface ComposeSecret {
  readonly source?: string;
}

interface ComposeServiceHealthcheck {
  readonly test?: readonly string[] | string;
  readonly interval?: string | number;
  readonly timeout?: string | number;
  readonly retries?: number;
  readonly start_period?: string | number;
  readonly disable?: boolean;
}

interface ComposeService {
  readonly image?: string;
  readonly environment?: Readonly<Record<string, string | null | undefined>>;
  readonly secrets?: readonly (string | ComposeSecret)[];
  readonly entrypoint?: readonly string[] | string;
  readonly healthcheck?: ComposeServiceHealthcheck;
  readonly profiles?: readonly string[];
}

interface ComposeConfig {
  readonly services?: Readonly<Record<string, ComposeService>>;
  readonly secrets?: Readonly<Record<string, unknown>>;
}

// ─── Config helpers ───────────────────────────────────────────────────────

/**
 * Resolve o compose.yaml com o profile `app` ativo para que o serviço `http`
 * apareça na config. Retorna null se o comando falhar (Docker CLI ausente).
 *
 * Nota: o serviço foi renomeado de `app` → `http` na Fase 4 da reorganização
 * da raiz (compose.yaml). O profile permanece `app` para ativar o serviço.
 */
const configWithApp = (): ComposeConfig | null => {
  const r = sh(`docker compose -f "${COMPOSE_YAML}" --profile app config --format json`);
  if (r.code !== 0) return null;
  try {
    return JSON.parse(r.stdout) as ComposeConfig;
  } catch {
    return null;
  }
};

/**
 * Normaliza a lista de secrets de um serviço: aceita string simples ou objeto
 * `{ source: string }` (formato longo do Compose Spec).
 */
const secretNames = (secrets: readonly (string | ComposeSecret)[] | undefined): readonly string[] =>
  (secrets ?? []).map((s) => (typeof s === 'string' ? s : (s.source ?? '')));

// Parseia o entrypoint para string plana (junta array ou usa string direta)
const entrypointStr = (ep: readonly string[] | string | undefined): string => {
  if (ep === undefined) return '';
  if (typeof ep === 'string') return ep;
  return ep.join(' ');
};

// ─── CA-1: MINIO_ROOT_PASSWORD_FILE, sem MINIO_ROOT_PASSWORD em texto ────
describe('issue #51 — CA-1: serviço minio usa _FILE vars, sem senha em texto', { skip }, () => {
  it('CA-1a: MINIO_ROOT_USER_FILE está presente no environment do serviço minio', () => {
    const cfg = configWithApp();
    const env = cfg?.services?.['minio']?.environment ?? {};
    assert.ok(
      'MINIO_ROOT_USER_FILE' in env,
      `MINIO_ROOT_USER_FILE ausente no environment do serviço minio. Env: ${JSON.stringify(env)}`,
    );
  });

  it('CA-1b: MINIO_ROOT_PASSWORD_FILE está presente no environment do serviço minio', () => {
    const cfg = configWithApp();
    const env = cfg?.services?.['minio']?.environment ?? {};
    assert.ok(
      'MINIO_ROOT_PASSWORD_FILE' in env,
      `MINIO_ROOT_PASSWORD_FILE ausente no environment do serviço minio. Env: ${JSON.stringify(env)}`,
    );
  });

  it('CA-1c: MINIO_ROOT_PASSWORD NÃO aparece como chave no environment (senha em texto claro)', () => {
    const cfg = configWithApp();
    const env = cfg?.services?.['minio']?.environment ?? {};
    assert.ok(
      !('MINIO_ROOT_PASSWORD' in env),
      `MINIO_ROOT_PASSWORD exposta em texto claro no environment do minio! (vaza em docker inspect)`,
    );
  });

  it('CA-1d: MINIO_ROOT_USER NÃO aparece como chave no environment (user em texto claro)', () => {
    const cfg = configWithApp();
    const env = cfg?.services?.['minio']?.environment ?? {};
    assert.ok(
      !('MINIO_ROOT_USER' in env),
      `MINIO_ROOT_USER exposta em texto claro no environment do minio! Use MINIO_ROOT_USER_FILE.`,
    );
  });
});

// ─── CA-2: secrets top-level + referenciados nos serviços ─────────────────
describe(
  'issue #51 — CA-2: secrets minio_root_user/password no top-level e nos serviços',
  { skip },
  () => {
    it('CA-2a: secret minio_root_user declarado no bloco top-level', () => {
      const cfg = configWithApp();
      assert.ok(
        cfg?.secrets?.['minio_root_user'],
        `secret minio_root_user ausente no bloco top-level do compose`,
      );
    });

    it('CA-2b: secret minio_root_password declarado no bloco top-level', () => {
      const cfg = configWithApp();
      assert.ok(
        cfg?.secrets?.['minio_root_password'],
        `secret minio_root_password ausente no bloco top-level do compose`,
      );
    });

    it('CA-2c: serviço minio referencia minio_root_user e minio_root_password', () => {
      const cfg = configWithApp();
      const names = secretNames(cfg?.services?.['minio']?.secrets);
      assert.ok(
        names.includes('minio_root_user'),
        `serviço minio não referencia minio_root_user. Secrets: ${JSON.stringify(names)}`,
      );
      assert.ok(
        names.includes('minio_root_password'),
        `serviço minio não referencia minio_root_password. Secrets: ${JSON.stringify(names)}`,
      );
    });

    it('CA-2d: serviço minio-bootstrap referencia minio_root_user e minio_root_password', () => {
      const cfg = configWithApp();
      const names = secretNames(cfg?.services?.['minio-bootstrap']?.secrets);
      assert.ok(
        names.includes('minio_root_user'),
        `minio-bootstrap não referencia minio_root_user. Secrets: ${JSON.stringify(names)}`,
      );
      assert.ok(
        names.includes('minio_root_password'),
        `minio-bootstrap não referencia minio_root_password. Secrets: ${JSON.stringify(names)}`,
      );
    });
  },
);

// ─── CA-3: minio/mc pinado por digest ─────────────────────────────────────
describe('issue #51 — CA-3: minio/mc pinado por digest sha256 (ADR-0011)', { skip }, () => {
  it('CA-3: imagem do minio-bootstrap contém @sha256:', () => {
    const cfg = configWithApp();
    const image = cfg?.services?.['minio-bootstrap']?.image ?? '';
    assert.match(
      image,
      /@sha256:[0-9a-f]{64}/,
      `imagem do minio-bootstrap não está pinada por digest. Imagem atual: "${image}". Use @sha256:<digest>.`,
    );
  });
});

// ─── CA-4: entrypoint do bootstrap não interpola senha em texto ───────────
describe(
  'issue #51 — CA-4: entrypoint do minio-bootstrap não expõe senha literal',
  { skip },
  () => {
    it('CA-4a: entrypoint usa $(cat /run/secrets/minio_root_user) para o usuário', () => {
      const cfg = configWithApp();
      const ep = entrypointStr(cfg?.services?.['minio-bootstrap']?.entrypoint);
      assert.match(
        ep,
        /cat \/run\/secrets\/minio_root_user/,
        `entrypoint deveria ler o user via 'cat /run/secrets/minio_root_user'. Entrypoint atual: "${ep}"`,
      );
    });

    it('CA-4b: entrypoint usa $(cat /run/secrets/minio_root_password) para a senha', () => {
      const cfg = configWithApp();
      const ep = entrypointStr(cfg?.services?.['minio-bootstrap']?.entrypoint);
      assert.match(
        ep,
        /cat \/run\/secrets\/minio_root_password/,
        `entrypoint deveria ler a senha via 'cat /run/secrets/minio_root_password'. Entrypoint atual: "${ep}"`,
      );
    });

    it('CA-4c: entrypoint NÃO contém "dev-access-key" ou "dev-secret-key" literal', () => {
      const cfg = configWithApp();
      const ep = entrypointStr(cfg?.services?.['minio-bootstrap']?.entrypoint);
      assert.doesNotMatch(
        ep,
        /dev-access-key|dev-secret-key/,
        `entrypoint do bootstrap contém credencial literal: "${ep}"`,
      );
    });
  },
);

// ─── CA-5: serviço `http` (ex-`app`) tem healthcheck ────────────────────
// Serviço renomeado de `app` → `http` na Fase 4 (compose.yaml). Profile `app`
// continua ativando o serviço (`profiles: [app]` no compose). O CA-5 verifica
// o serviço pelo novo nome `http`.
describe('issue #51 — CA-5: serviço http tem healthcheck declarado', { skip }, () => {
  it('CA-5a: serviço http existe com o profile app ativo', () => {
    const cfg = configWithApp();
    assert.ok(cfg?.services?.['http'], `serviço http ausente na config com --profile app`);
  });

  it('CA-5b: serviço http tem healthcheck com test declarado', () => {
    const cfg = configWithApp();
    const hc = cfg?.services?.['http']?.healthcheck;
    assert.ok(
      hc && !hc.disable,
      `serviço http não tem healthcheck habilitado. healthcheck: ${JSON.stringify(hc)}`,
    );
    const test = hc?.test;
    const testStr = test === undefined ? '' : typeof test === 'string' ? test : test.join(' ');
    assert.ok(testStr.length > 0, `healthcheck.test do serviço http está vazio`);
  });

  it('CA-5c: healthcheck do http aponta para a porta 3000 (/health)', () => {
    const cfg = configWithApp();
    const hc = cfg?.services?.['http']?.healthcheck;
    const test = hc?.test;
    const testStr = test === undefined ? '' : typeof test === 'string' ? test : test.join(' ');
    assert.match(
      testStr,
      /3000.*health|health.*3000/,
      `healthcheck do serviço http deveria verificar /health na porta 3000. test: "${testStr}"`,
    );
  });
});
