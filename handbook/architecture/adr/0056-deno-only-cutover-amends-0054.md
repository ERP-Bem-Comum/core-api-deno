[← Voltar para ADRs](./README.md)

# ADR-0056: Estratégia de migração — cutover Deno-only (amends ADR-0054)

- **Status:** Accepted
- **Date:** 2026-07-24
- **Deciders:** Arquiteto técnico + Gabriel Aderaldo
- **Amends:** [ADR-0054](./0054-deno-runtime-supersedes-node.md) — corrige a **estratégia de migração** (§"Estratégia de migração"). A **decisão** do 0054 (adotar Deno) permanece; muda **como** se chega lá.

---

## Contexto

O [ADR-0054](./0054-deno-runtime-supersedes-node.md) registrou a estratégia como *"strangler-fig,
Node autoritativo até a paridade, Node e Deno coexistem por módulo durante a transição"*. Ao
executar a primeira etapa (workspaces, ticket `DENO-WS-HYBRID`), o W0 provou empiricamente que
**manter o Node ativo é incompatível** com o objetivo real:

- Ativar o enforce do ADR-0006 no Node exige `package.json` por módulo (fronteira de pacote), o
  que **quebra os 338 imports `#src/*` internos** (`ERR_PACKAGE_IMPORT_NOT_DEFINED`), e o Node
  **veta o fix** (`ERR_INVALID_PACKAGE_TARGET` — subpath import não sai do pacote).
- O responsável esclareceu o alvo: **runtime único = Deno.** Node **e pnpm** saem **totalmente**.
  Só sobrevive **pacote npm sem boa alternativa no JSR**, consumido via `npm:` **pelo Deno**.

## Decisão

**A migração ao Deno é um cutover, não uma coexistência.** Node e pnpm são **removidos por
completo**; não há fase de Node-autoritativo-em-paralelo.

Bases (medidas no spike `spike/0023`):

- O código **já roda em Deno** (`node:test` nativo: 4335/0; 6 suítes de integração em paridade;
  binário bootando contra MySQL real). Então o cutover é **tooling/config**, não um port longo.
- Sem Node, os atritos que motivavam o strangler-fig **desaparecem**: o `@core/X` só precisa
  resolver **no Deno** (resolve — fatia 1), sem `package.json`/`pnpm-workspace`/Docker-frozen.

**Regra de dependências:** `jsr:` onde há dono/alternativa boa (`@zod/zod`, `@panva/jose`,
`@std/*`); **`npm:` para o resto** (Drizzle, mysql2/postgres.js, AWS SDK, nodemailer, hash-wasm),
consumido pelo Deno. Segurança vence "minimizar Node" onde brigam (ver hash WASM, S3, email).

## Consequências

### Positivas
- Sem manter dois runtimes em paralelo (menos risco simultâneo, menos tooling duplo).
- O enforce do ADR-0006 (workspaces) vira **trivial** — Deno-only, sem hibrido pnpm.
- `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` **saem**; `deno.json` + `deno.lock`
  assumem (config, `#src/*`, tasks, lock).

### Negativas / riscos
- **Cutover tem um ponto de virada** — o tooling (CI, Docker, gates) flipa de Node/pnpm para Deno
  num passo coordenado, não módulo-a-módulo. Mitigação: sequência em etapas verificadas (épico
  `DENO-ONLY-CUTOVER`), cada uma com `deno test` verde antes da próxima.
- **O gate de regressão muda:** o harness era Node×Deno; sem Node, o baseline vira **Deno vs
  último-Deno-bom** (a assinatura Deno registrada não pode regredir).
- Perde-se a reversibilidade fácil para Node (era o hedge do 0054). Aceito: o Node 26 + tsgo
  continua registrado como fallback **estratégico** se o cutover falhar, mas não como fase.

## Estratégia (substitui a §"Estratégia de migração" do ADR-0054)

Cutover em **4 etapas sequenciadas** (detalhe e ordem no épico
[`DENO-ONLY-CUTOVER`](../../../.claude/.planning/DENO-ONLY-CUTOVER.md)), cada uma um ticket W0→W3
**verificado sob Deno**:

1. **Tooling** — `deno.json` assume `#src/*`/`#scripts/*` + tasks; remove a dependência de
   `package.json#imports`; dispensa `--experimental-strip-types` (Deno roda `.ts` nativo).
2. **Dependências** — swaps JSR onde há alternativa boa; `npm:` para o resto; `deno.lock`.
3. **Enforce** — ativa os workspaces (`DENO-WS-HYBRID` reescopado: 46 imports → `@core/X`).
4. **Remoção** — Node/pnpm saem do CI/Docker (`deno test`, `deno cache`, imagem `denoland/deno`);
   `package.json`/`pnpm-lock`/`pnpm-workspace` deletados.

O **PostgreSQL** (ADR-0055) é uma **frente paralela**, independente do runtime.

## Referências

- [ADR-0054](./0054-deno-runtime-supersedes-node.md) (Deno) · [ADR-0006](./0006-modular-monolith-core-api.md) · [ADR-0011](./0011-supply-chain-hardening.md) (o hardening pnpm dá lugar aos gates nativos do Deno).
- Épico [`DENO-ONLY-CUTOVER`](../../../.claude/.planning/DENO-ONLY-CUTOVER.md) · `DENO-WS-HYBRID/002-tests/REPORT.md` (o W0 que motivou este amendment).
