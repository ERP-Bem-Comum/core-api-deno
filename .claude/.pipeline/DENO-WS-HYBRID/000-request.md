# DENO-WS-HYBRID — escopo (REESCOPADO após W0)

> Size **S** (era M). Decisão: **ADR-0054** + **ADR-0056** (cutover Deno-only).
> Etapa de **ativação do enforce** dentro do épico [`DENO-ONLY-CUTOVER`](../../.planning/DENO-ONLY-CUTOVER.md).
> ⚠️ O nome "HYBRID" é **legado** — o hibrido pnpm morreu no W0 (ver `002-tests/REPORT.md`).

## Pivô do W0

O W0 provou que o **hibrido pnpm** (fazer `@core/X` resolver no Node) é **inviável** — quebra os
338 `#src/*` internos e o Node veta o fix (`ERR_INVALID_PACKAGE_TARGET`). **Mas a premissa era
errada:** o alvo é **runtime único Deno**, Node e pnpm **saem totalmente** ([ADR-0056](../../../handbook/architecture/adr/0056-deno-only-cutover-amends-0054.md)).
Sem Node, o blocker **desaparece** — `@core/X` só precisa resolver **no Deno**, e resolve (a
fatia 1 provou: 132 testes cross-módulo verdes, `#src/*` intacto sob Deno).

## Objetivo (reescopado)

Ativar o enforce do ADR-0006 trocando os **46 imports cross-módulo**
`#src/modules/X/public-api/...` → `@core/X/...`, **verificado sob Deno**. Sem `package.json` por
módulo, sem `pnpm-workspace`, sem Docker/frozen-install — tudo isso é do mundo Node/pnpm que sai.

## Dependência de sequência

Esta etapa roda **depois** da etapa de tooling do cutover (o `deno.json` assume o `#src/*` e o
Node/pnpm saem). Trocar os imports **antes** disso quebraria os gates Node ainda ativos. Ver a
ordem no épico `DENO-ONLY-CUTOVER`.

## Escopo

1. Reescrever os **46 imports** cross-módulo `#src/modules/X/public-api/...` → `@core/X/...`.
2. (`deno.json` dos membros já existe — fatia 1, commit `72448d6e`.)

## Critérios de aceite (sob Deno)

- **CA1** — `import { X } from "@core/financial/http"` resolve sob Deno.
- **CA2** — `import "@core/financial/domain/..."` **falha** sob Deno (`Unknown export`) — enforce ativo.
- **CA3** — `deno test` da suíte inteira **verde**, assinatura idêntica ao baseline Deno (0 regressão).
- **CA4** — `grep` por `#src/modules/*/public-api` em import cross-módulo → **0** (os 46 migrados).
- **CA5** — 0 violações intra-módulo introduzidas (`#src/*` interno segue permitido).

## Fora de escopo

Tooling do cutover (deno.json assume #src/*, remover pnpm) e swaps JSR — são **outras etapas** do
épico. PostgreSQL (ADR-0055, frente paralela). Qualquer regra de domínio / schema / migration.

## Referências

- [ADR-0056](../../../handbook/architecture/adr/0056-deno-only-cutover-amends-0054.md) (cutover Deno-only, amends 0054) · [ADR-0006](../../../handbook/architecture/adr/0006-modular-monolith-core-api.md).
- Épico [`DENO-ONLY-CUTOVER`](../../.planning/DENO-ONLY-CUTOVER.md) · fatia 1: commit `72448d6e` · W0: `002-tests/REPORT.md`.
