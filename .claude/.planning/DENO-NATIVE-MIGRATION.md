# Roadmap — migração para APIs Deno-native (deno-like)

> Decisão do dono (2026-07-24, informada): **migração de tecnologia de verdade** — passar tudo que
> der de `node:*` para `Deno.*`/`@std`/Web, mantendo só o que **quebraria o código**. Aceita o
> cruzamento para **Deno-exclusivo** (os gates Node morrem; gate passa a `deno check` + `deno test`).
> Fase do épico [`DENO-ONLY-CUTOVER`](./DENO-ONLY-CUTOVER.md). Cada fatia = ticket W0→W3 sob Deno.

## Fica `node:` (migrar QUEBRARIA — decisão técnica, não estética)

- **`node:test` + `node:assert`** — o pilar "zero migração de teste" (12k asserções). `Deno.test` =
  reescrita gigante. `node:assert` roda nativo sob `deno test`. **Fica.**
- **`node:zlib`** — `DecompressionStream` não faz recovery de stream truncado (parser PDF). **Fica.**
- **`node:async_hooks`** (`AsyncLocalStorage`) — sem equivalente Web/`Deno.*`. **Fica.**
- **`node:crypto` `timingSafeEqual`** (sem equivalente Web) + `createHash` síncrono (`subtle.digest`
  é async → quebraria ~9 helpers sync). **Fica.**

## Migra para Deno-native (as fatias)

| # | Fatia | De → Para | Sites | Cruza Deno-exclusivo? |
| --- | --- | --- | --- | --- |
| 1 | `DENO-SUBPROCESS-COMMAND` | `node:child_process` (spawn/spawnSync/execFile) → `Deno.Command` | ~20 arq. | não (só tests/scripts) |
| 2 | `DENO-ENV-NATIVE` | `process.env['X']` → `Deno.env.get('X')` | ~46 src + 61 test | **SIM** (src/) |
| 3 | `DENO-PROCESS-LIFECYCLE` | `process.exit`→`Deno.exit`; `process.exitCode`→`Deno.exitCode`; signals→`Deno.addSignalListener`; `uncaught/unhandled`→`globalThis.addEventListener` | ~40 | SIM |
| 4 | `DENO-STD-FS` | `node:fs`/`fs/promises` → `Deno.readTextFile`/`writeTextFile`/`readTextFileSync` | ~5 src + testes | SIM |
| 5 | `DENO-STD-PATH` | `node:path` → `jsr:@std/path`; `node:url` fileURLToPath → `@std/path` fromFileUrl / `import.meta.dirname` | ~15 | SIM |
| 6 | `DENO-WEB-CRYPTO` | `randomUUID`→`crypto.randomUUID`; `randomBytes`→`crypto.getRandomValues`+`@std/encoding` | ~15 | SIM |
| 7 | `DENO-STD-ENCODING` | `node:buffer` Buffer/base64 → `Uint8Array` + `@std/encoding` | ~2 | SIM |
| 8 | `process.stdout/stderr.write` → `Deno.stdout/stderr.write` (ou manter `console`) | avaliar | SIM |

Ordem: fatia 1 é segura (não cruza src/). Da fatia 2 em diante, o `src/` vira Deno-exclusivo — a
partir daí o gate é **só Deno** (`pnpm test`/`tsc` deixam de valer, esperado).

## Gate após o cruzamento

`deno task check` (nativo, `Deno.*` tipado — confirmado com `types:[]`) + `deno task test`. Os gates
`pnpm`/`tsc` são abandonados no cruzamento (fatia 2). Remover o package-manager (Etapa 4 core) fecha
o ciclo.
