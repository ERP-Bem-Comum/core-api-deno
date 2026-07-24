# DENO-CUTOVER-GATE — W0 (deno-runtime-expert playbook)

## Resultado: 🔴 RED — Deno ainda não é o gate de qualidade

1. **`deno check` sujo:** `deno check src/server.ts` → **6× `TS2339 Property ... does not exist on
   type 'ImportMeta'`** (o `@types/node` do node_modules estraga o `ImportMeta` do Deno).
2. **Tasks de gate ausentes:** `deno task` não tem `check` nem `lint` (só `serve`/`worker`/`test`).

## Causa e fix (reconnaissance)

- O `ImportMeta` cru vem do `@types/node` no grafo. Provado: probe puro (sem node_modules) passa;
  `deno check` com **`nodeModulesDir: "none"`** passa **mesmo com o `package.json` presente** (o Deno
  usa a cache npm própria via `deno.lock`, sem carregar o `@types/node`).
- `deno fmt` reformataria o repo (discorda do prettier) → manter **prettier via `npm:`**.
- prettier e eslint **rodam sob Deno** (`deno run -A npm:prettier@3.8.3 --version`→3.8.3; eslint lint rc=0).

## Especificação do W1

`deno.json`: `"nodeModulesDir": "none"` + tasks `check`/`lint`/`fmt-check`. Depois: `deno task check`
verde (0 ImportMeta), `deno task test` verde, `lint`/`fmt-check` rodando.
