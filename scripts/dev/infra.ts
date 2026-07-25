#!/usr/bin/env -S node --experimental-strip-types --no-warnings
// scripts/dev/infra.ts
//
// Wrapper de conveniência para a INFRA DEV PERSISTENTE local (OrbStack/Docker).
// Sobe/derruba o núcleo mysql+minio com os secrets REAIS e volumes persistentes,
// mantendo-o SEPARADO do ciclo EFÊMERO dos testes de integração
// (scripts/ci/test-integration.ts), que a cada run faz `docker compose down -v`
// (apaga volumes) e sobrescreve+deleta os `secrets/mysql_*_password.txt`.
//
// O gotcha que o `reset` cura: quando um `test:integration:*` deleta os 3 secrets
// de senha do MySQL mas deixa os `*_database_url.txt` (com a senha antiga embutida),
// um `secrets:setup` simples recriaria só os passwords com valores NOVOS — divergindo
// das URLs. `reset` faz `down -v` → `secrets:setup --force` (reescreve passwords E
// recompõe as URLs coerentes) → `up`, restaurando um estado 100% consistente.
//
// Aplica skill `nodejs-process-runner`: spawnSync(shell:false) + exit codes sysexits.h.

import { accessSync, constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

// ─── Exit codes (sysexits.h) ────────────────────────────────────────────────
const EX_OK = 0;
const EX_USAGE = 64;
const EX_CONFIG = 78;

// ─── Paths ──────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/dev/ → sobe 2 níveis até a raiz do projeto.
const PROJECT_ROOT = resolve(HERE, '..', '..');
const SECRETS_DIR = resolve(PROJECT_ROOT, 'secrets');
const SECRETS_SCRIPT = resolve(HERE, '..', 'setup', 'secrets.ts');

// Os 12 secrets consumidos pela infra dev (compose.yaml top-level `secrets:`).
const REQUIRED_SECRETS: readonly string[] = [
  'mysql_root_password',
  'mysql_app_password',
  'mysql_readonly_password',
  'minio_root_user',
  'minio_root_password',
  'smtp_pass',
  'contracts_database_url',
  'auth_database_url',
  'programs_database_url',
  'partners_database_url',
  'financial_database_url',
  'migrate_database_url',
];

const USAGE = `Uso: pnpm infra:<cmd>

  up [--mail]   Sobe o núcleo dev (mysql + minio) e aguarda healthy.
                --mail também sobe o Mailpit (SMTP fake :1025 / UI :8025).
  down          Derruba os containers PRESERVANDO os volumes (dados intactos).
  reset         Limpa tudo: down -v → secrets:setup --force → up. Use quando um
                'pnpm test:integration:*' tiver deletado/trocado os secrets.
  status        Mostra 'docker compose ps'.

A infra dev é PERSISTENTE e usa os secrets REAIS. Os testes de integração
(scripts/ci/test-integration.ts) gerenciam a PRÓPRIA infra efêmera com 'down -v'
+ secrets de teste — NÃO misture: rode 'infra:down' antes da suíte e 'infra:reset'
depois, para restaurar a coerência dos secrets.
`;

// ─── Helpers ────────────────────────────────────────────────────────────────
const runDocker = (args: readonly string[]): number => {
  stderr.write(`$ docker ${args.join(' ')}\n`);
  return new Deno.Command('docker', {
    args: [...args],
    stdout: 'inherit',
    stderr: 'inherit',
  }).outputSync().code;
};

const missingSecrets = (): readonly string[] =>
  REQUIRED_SECRETS.filter((name) => {
    try {
      accessSync(resolve(SECRETS_DIR, `${name}.txt`), constants.F_OK);
      return false;
    } catch {
      return true;
    }
  });

const runSecretsSetupForce = (): number => {
  stderr.write('$ secrets:setup --force\n');
  return new Deno.Command(Deno.execPath(), {
    args: ['run', '-A', SECRETS_SCRIPT, '--force'],
    stdout: 'inherit',
    stderr: 'inherit',
  }).outputSync().code;
};

const composeUp = (mail: boolean): number => {
  const profileArgs = mail ? ['--profile', 'mail'] : [];
  // Etapa 1: sobe tudo (inclui o job one-shot `minio-bootstrap`), sem esperar.
  const up = runDocker(['compose', ...profileArgs, 'up', '-d']);
  if (up !== 0) return up;
  // Etapa 2: aguarda SÓ os serviços long-running ficarem healthy. O bootstrap
  // (restart:no) é excluído do --wait de propósito: ao SAIR (exit 0) durante a
  // espera, o compose o reporta como falha e retornaria exit 1 — falso negativo.
  const waited = mail ? ['mysql', 'minio', 'mailpit'] : ['mysql', 'minio'];
  return runDocker(['compose', ...profileArgs, 'up', '-d', '--wait', ...waited]);
};

// ─── Comandos ───────────────────────────────────────────────────────────────
const cmdUp = (mail: boolean): number => {
  const missing = missingSecrets();
  if (missing.length > 0) {
    stderr.write(
      `Erro: secrets ausentes (${missing.join(', ')}).\n` +
        `Um 'pnpm test:integration:*' pode tê-los deletado. Rode: pnpm infra:reset\n`,
    );
    return EX_CONFIG;
  }
  return composeUp(mail);
};

const cmdDown = (): number => runDocker(['compose', 'down']);

const cmdReset = (mail: boolean): number => {
  const down = runDocker(['compose', 'down', '-v']);
  if (down !== 0) return down;
  const secrets = runSecretsSetupForce();
  if (secrets !== 0) return secrets;
  return composeUp(mail);
};

const cmdStatus = (): number => runDocker(['compose', 'ps']);

// ─── Main ───────────────────────────────────────────────────────────────────
const main = (): number => {
  const raw = argv.slice(2);
  const cmd = raw[0];
  const mail = raw.includes('--mail');

  if (cmd === '--help' || cmd === '-h') {
    stdout.write(USAGE);
    return EX_OK;
  }
  if (cmd === undefined) {
    stderr.write(USAGE);
    return EX_USAGE;
  }

  switch (cmd) {
    case 'up':
      return cmdUp(mail);
    case 'down':
      return cmdDown();
    case 'reset':
      return cmdReset(mail);
    case 'status':
      return cmdStatus();
    default:
      stderr.write(`Comando desconhecido: ${cmd}\n\n${USAGE}`);
      return EX_USAGE;
  }
};

exit(main());
