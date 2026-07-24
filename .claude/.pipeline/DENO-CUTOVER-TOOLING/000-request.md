# DENO-CUTOVER-TOOLING — escopo

> Size **S**. Etapa **1 (Tooling)** do épico [`DENO-ONLY-CUTOVER`](../../.planning/DENO-ONLY-CUTOVER.md).
> Decisão: [ADR-0054](../../../handbook/architecture/adr/0054-deno-runtime-supersedes-node.md) + [ADR-0056](../../../handbook/architecture/adr/0056-deno-only-cutover-amends-0054.md).
> Autoridade técnica: agente [`deno-runtime-expert`](../../agents/deno-runtime-expert.md).

## Problema

Hoje o `deno.json` **não** tem `imports`. A suíte Deno passa (4335/0) **só porque** o Deno lê o
`package.json#imports` via compat de Node. Ou seja: a resolução de `#src/*`/`#scripts/*` sob Deno
**depende do `package.json`** — que sai na Etapa 4. Sem mover essa autoridade para o `deno.json`
agora, a remoção do `package.json` quebraria toda a resolução interna.

Prova empírica (spike): `DENO_NO_PACKAGE_JSON=1 deno check <arquivo com #src/ e #scripts/>` **falha**
hoje (`Import "#src/..." not a dependency`). Esse é o gate RED do W0.

## Objetivo

Fazer o **`deno.json` assumir** `#src/` e `#scripts/` via `imports` map (semântica **trailing-slash**
do Deno, **não** o glob `#src/*` do Node — provado no spike que o `/*` é ignorado pelo resolver).
Resultado: a resolução interna sob Deno passa a ser **autossuficiente**, independente do `package.json`.

## Escopo

1. Adicionar ao `deno.json#imports`: `"#src/": "./src/"` e `"#scripts/": "./scripts/"`.
2. Confirmar que `.ts` roda nativo sob Deno **sem** `--experimental-strip-types` (as `tasks` do
   `deno.json` já não usam a flag — validar).
3. (As `tasks` least-privilege já existem no `deno.json` — apenas confirmar cobertura serve/worker/job/test.)

## Fora de escopo

- Remover `package.json`/`pnpm-lock`/`pnpm-workspace` → **Etapa 4 (Remoção)**.
- Swaps `jsr:`/`npm:` + `deno.lock` → **Etapa 2 (Dependências)**.
- Trocar os 46 imports cross-módulo `#src/modules/X/public-api` → `@core/X` → **Etapa 3** (`DENO-WS-HYBRID`).
- Qualquer mudança em `src/` (regra de domínio, schema, migration).

## Critérios de aceite

- **CA1** — `deno.json#imports` declara `#src/` e `#scripts/` em **trailing-slash** (0 ocorrências de glob `#src/*`).
- **CA2** — `DENO_NO_PACKAGE_JSON=1 deno check <probe #src/ + #scripts/>` **passa** (era RED antes do W1).
- **CA3** — `deno test` da suíte de unidade **verde**, assinatura ≥ baseline Deno (0 regressão).
- **CA4** — Regressão zero no mundo Node: `pnpm run typecheck` + `format:check` + `lint` + `test` **verdes** (o `deno.json` não afeta o Node).
- **CA5** — Nada em `src/` alterado (só `deno.json` + eventual probe em `tests/migration/`).

## Referências

- Épico [`DENO-ONLY-CUTOVER`](../../.planning/DENO-ONLY-CUTOVER.md) · ADR-0054/0056 · agente `deno-runtime-expert`.
- Prova do mecanismo: `handbook/reference/deno/README.md` + spike `spike/0023`.
