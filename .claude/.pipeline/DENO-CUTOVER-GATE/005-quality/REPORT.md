# DENO-CUTOVER-GATE — W3 (gate de qualidade)

## Resultado: 🟢 GREEN — os 4 gates rodam sob Deno; regressão zero no Node

## Gates sob Deno (via `deno task`)

| Gate | Comando | Resultado |
| --- | --- | --- |
| typecheck | `deno task check` (nativo) | ✅ rc=0 LIMPO (era 62 erros ImportMeta) |
| format | `deno task fmt-check` (prettier via npm:) | ✅ "All matched files use Prettier code style!" |
| lint | `deno task lint` (eslint via npm:) | ✅ rc=0 (codebase inteiro) |
| test | `deno task test` (nativo) | ✅ suíte não-spawn 1084/0 (modules+shared); ⚠️ 17 spawn-tests → follow-up |

## Regressão zero no Node (CA5)

| Gate | Resultado |
| --- | --- |
| `pnpm run typecheck` | ✅ rc=0 |
| `pnpm run format:check` | ✅ clean |
| `pnpm run lint` | ✅ rc=0 |
| `pnpm test` | ✅ **4326 · 4307 pass · 0 fail** · 19 skip |

O `deno.json#compilerOptions` só afeta o `deno check` (não o Node). O `moduleDir` (via `import.meta.url`)
é `string` nos dois runtimes.

## CAs — fechamento

- **CA1** ✅ `deno.json` tem `compilerOptions` (types:[] + strict) + tasks `check`/`lint`/`fmt-check`.
- **CA2** ✅ `deno task check` verde (0 ImportMeta).
- **CA3** 🟡 `deno task test` verde na suíte não-spawn; **17 arquivos que fazem `spawn(process.execPath,
  [flags-node])` são follow-up** (execPath=deno sob Deno; não é regressão — passam sob `node --test`).
- **CA4** ✅ `lint`/`fmt-check` rodam sob Deno.
- **CA5** ✅ Node 4307/0.

## Entrega

- `deno.json`: `compilerOptions` (o pulo do gato `types:[]`) + 3 tasks de gate.
- `src/shared/module-dir.ts`: helper `import.meta.url`→dir (string nos 2 runtimes); 6 sites migrados.

## Follow-ups registrados (fora de escopo — anti-padrão #15)

1. **Adaptar 17 testes de spawn** (`process.execPath` + flags Node → invocação Deno) — Etapa 3/4.
2. (Herdados) Remover package.json/pnpm + 81 scripts→tasks; Docker (denoland/deno); 3 CI workflows;
   4 git-hooks; hook block-npm vs specifier `npm:` — próximas fatias da Etapa 4.
