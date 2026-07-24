# DENO-CUTOVER-GATE — escopo

> Size **M** (fatia 1 da Etapa 4). Etapa **4 (Remoção)** do épico [`DENO-ONLY-CUTOVER`](../../.planning/DENO-ONLY-CUTOVER.md).
> Branch paralela `epic/deno-postgres-migration`. Autoridade: playbook `deno-runtime-expert`.

## Contexto

A Etapa 4 (remover Node/pnpm) é XL. Esta fatia entrega o **linchpin**: provar que **os 4 gates de
qualidade rodam sob Deno** — sem ainda deletar o `package.json` (aditivo). A remoção da superfície
package-manager (81 scripts, Docker, CI, git-hooks) são **fatias seguintes**.

## Descoberta que destrava (reconnaissance)

- `deno check` erra `ImportMeta` (`import.meta.url`/`.dirname`) enquanto o `@types/node` está no grafo.
- **`nodeModulesDir: "none"` no `deno.json` desacopla** — o Deno passa a usar a cache npm própria
  (via `deno.lock`) e o `ImportMeta` fica limpo, **sem deletar o `package.json`**. Provado.
- `deno fmt` **discorda** do prettier (reformataria tudo) → **manter prettier via `npm:`**, sem churn.
- prettier e eslint **rodam sob Deno** via `deno run -A npm:...`.

## Objetivo

Adicionar ao `deno.json`: `"nodeModulesDir": "none"` + tasks dos 4 gates, provando que rodam verdes
sob Deno. `package.json` **permanece** (a `dev`/pnpm seguem funcionando em paralelo).

## Escopo

1. `"nodeModulesDir": "none"` no `deno.json`.
2. Tasks: `check` (`deno check`), `lint` (`deno run -A npm:eslint`), `fmt-check` (`deno run -A npm:prettier --check`), (o `test` já existe).
3. Provar os 4 gates verdes sob Deno.

## Fora de escopo (fatias seguintes da Etapa 4)

- Deletar `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml` + migrar os 81 scripts → deno task.
- Dockerfile (denoland/deno), 3 CI workflows, 4 git hooks.
- Adotar `deno fmt`/`deno lint` nativos (decisão de churn — hoje mantemos prettier/eslint).

## Critérios de aceite

- **CA1** — `deno.json` tem `"nodeModulesDir": "none"` + tasks `check`/`lint`/`fmt-check`.
- **CA2** — `deno task check` (deno check nativo) **verde** — 0 erro de ImportMeta.
- **CA3** — `deno task test` **verde** (suíte de unidade).
- **CA4** — `deno task fmt-check` e `deno task lint` rodam sob Deno (mesmas regras prettier/eslint).
- **CA5** — Regressão zero no mundo Node: `pnpm run typecheck`+`format:check`+`lint`+`test` verdes (nada em `src/` mudou; package.json intacto).

## Referências

- Épico `DENO-ONLY-CUTOVER` (Etapa 4) · ADR-0056 · reconnaissance nesta sessão.
