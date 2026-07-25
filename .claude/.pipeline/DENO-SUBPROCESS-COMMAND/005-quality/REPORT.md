# DENO-SUBPROCESS-COMMAND — W2+W3 (consolidado)

## Resultado: 🟢 GREEN — `node:child_process` → `Deno.Command` COMPLETO

Fatia 1 da migração deno-native. Verificação **por classe** (incremental) ao longo da execução.

## Escopo entregue — 19 arquivos, 0 `node:child_process` restante

| Classe | Arquivos | Verificação |
| --- | --- | --- |
| runtime-spawn | 5 (pipeline×3 + sync-permissions×2) | deno check rc=0 · deno test 28/0 · deno lint limpo · prettier |
| tool-spawn (bash/docker) | 10 (7 infra + migrations + 2 drivers) | deno check rc=0 · deno test 64/0 (2 skip s/ docker) · deno lint 11 files · prettier |
| mixed-scripts | 2 (infra.ts + test-integration.ts) | deno check rc=0 · deno lint limpo · prettier · `--parallel` válido |
| npm-sim | 1 (only-allow-pnpm) | deno check rc=0 · deno test 1/0 (guard rejeita npm sob Deno) |
| harness | 1 (runtime-signature) | deno check rc=0 · prettier |

`etl/main.ts` **fora** (tinha só menção em comentário, sem spawn).

## Padrões aplicados

- runtime-spawn: `spawn(process.execPath, [flags-node, SCRIPT])` → `new Deno.Command(Deno.execPath(), { args: ['run','-A',SCRIPT] })`.
- tool-spawn: `spawnSync('bash'|'docker', args)` → `new Deno.Command('bash'|'docker', {...}).outputSync()` + `TextDecoder`.
- `node --test` → `deno test` nativo (`--parallel` para não-serial).
- Melhorias: removido o wrapper `execFileAsync`+try/catch (o `.output()` não lança em exit≠0); saiu o global `process` onde possível; `r.status`→`r.code`; `process.pid`→`Deno.pid`.

## Cruzamento Deno-exclusivo (aceito)

Estes arquivos usam `Deno.*` → **não rodam mais sob Node** (`pnpm test`/`tsc`/eslint quebram neles). Gate = `deno check`/`deno test`/`deno lint`.

## Follow-ups (não-regressão)

- **Flip do gate de lint** `eslint`→`deno lint`: o eslint não tipa `Deno.*` (→ `no-unsafe-*`); o deno lint sim, mas acusa **544** issues pré-existentes no repo (regras diferentes; ex.: `require-await`). Fatia própria.
- Fatias 2-8 (env, lifecycle, fs, path, crypto, encoding) — ver `DENO-NATIVE-MIGRATION.md`.
