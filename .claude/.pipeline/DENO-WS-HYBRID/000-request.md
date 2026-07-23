# DENO-WS-HYBRID — escopo

> Size **M**. Decisão de origem: **ADR-0054** (Deno, Accepted). Fatia **2/2** dos workspaces;
> a fatia 1 (fundação) entrou no commit `72448d6e`. Ativa o enforce do **ADR-0006** no código.

## Problema

A fatia 1 declarou os workspaces Deno (7 `deno.json`, um por módulo, `exports` = public-api) e
**provou** que `import "@core/financial/domain/..."` falha com `Unknown export` — o enforce do
ADR-0006 funciona **sob Deno**. Mas ele **ainda não está ativo no código**: os módulos se importam
via `#src/modules/X/public-api/...` (46 imports cross-módulo), não via `@core/X`. E o fato que
trava a ativação:

> `@core/X` **não resolve no Node** (`ERR_MODULE_NOT_FOUND`). O Node não é um pnpm workspace hoje
> (`pnpm-workspace.yaml` só tem `allowBuilds`/`overrides`, sem `packages:`), e `#src/*` é um glob
> repo-root (`./src/*`) compartilhado pelos dois runtimes.

Trocar os 46 imports para `@core/X` **quebraria o Node** (que segue autoritativo na transição,
strangler-fig do ADR-0054) enquanto o Node não souber resolver `@core/X`.

## Precedente que decide o desenho

A fatia 1 (`72448d6e`) já provou que o `exports` do membro basta para o enforce **sob Deno**. O
mesmo mecanismo existe no Node via **`package.json#exports`**: um pacote com
`"exports": { "./read": "./public-api/read.ts" }` **também bloqueia** subpaths não-declarados no
Node. Ou seja, fazer cada módulo um pacote pnpm (name + exports) dá o enforce **nos dois runtimes**
de uma vez — não é hack Deno-only.

## Objetivo

`@core/X` resolve **em Node e Deno**, com o enforce do ADR-0006 ativo nos dois, sem regressão.

## Escopo

1. Cada um dos 7 módulos vira **membro pnpm**: `package.json` com `name: "@core/<mod>"` +
   `exports` **espelhando** o `deno.json` já criado (auth 6, contracts 6, partners 13, programs 6,
   financial 11, budget-plans 6, notifications 2).
2. `pnpm-workspace.yaml`: adicionar `packages: ["src/modules/*"]` (⚠️ preservar `allowBuilds` +
   `overrides` existentes — ver Risco nº 1).
3. `pnpm install` — cria os symlinks em `node_modules/@core/*`.
4. Reescrever os **46 imports** cross-módulo `#src/modules/X/public-api/...` → `@core/X/...`.
5. `Dockerfile`: garantir que o `COPY` inclui os `package.json` dos módulos e que o
   `pnpm install --frozen-lockfile` funciona com o workspace.

## Critérios de aceite

- **CA1** — **Dado** o workspace hibrido, **Quando** `import "@core/financial/http"` roda em Node
  E em Deno, **Então** resolve nos dois.
- **CA2** — **Dado** o mesmo, **Quando** `import "@core/financial/domain/payable/reconciled-status.ts"`
  roda em Node E em Deno, **Então** falha na resolução nos dois (`ERR_*`/`Unknown export`).
- **CA3** — **Dado** o harness de assinatura, **Quando** roda a lane Node, **Então** a assinatura é
  **idêntica** à baseline (unit `4335/0`; integração: contracts 95/0, auth 46/0, partners 50/1,
  programs 10/0, budget-plans 109/6, financial 117/2). **Zero regressão.**
- **CA4** — **Dado** o `Dockerfile`, **Quando** a imagem é buildada, **Então** o
  `pnpm install --frozen-lockfile` passa com o workspace (validar no **build real**, não só local).
- **CA5** — **Dado** o codebase, **Quando** se busca `#src/modules/*/public-api` em imports
  cross-módulo, **Então** o resultado é **0** (os 46 migrados).
- **CA6** — **Dado** o enforce ativo, **Quando** se procura import interno cross-módulo, **Então**
  segue **0 violações** (a fatia 1 já mediu 0; não introduzir nenhuma).

## ⚠️ Risco nº 1 — `pnpm-workspace.yaml` + Docker frozen-install

Adicionar `packages:` ao `pnpm-workspace.yaml` mexe no arquivo que hoje carrega os `overrides` de
segurança (esbuild/fast-uri) e `allowBuilds` (ADR-0011). Se o `Dockerfile` não copiar tudo que o
`frozen-lockfile` precisa (os `package.json` dos membros + o `pnpm-workspace.yaml`), o **build de
prod quebra** — regressão que **só aparece no CI/Docker**, não local. Validar o build da imagem é
CA obrigatório (CA4), no x99. Ver memória `pnpm-overrides-workspace-yaml-vs-docker-frozen`.

## Fora de escopo

Rodar Deno em produção (é a migração de runtime, outra fatia) · PostgreSQL (ADR-0055, outra frente)
· qualquer regra de domínio / schema / migration / contrato de borda · reescrever imports
intra-módulo (só os 46 **cross**-módulo).

## Referências

- [ADR-0054](../../../handbook/architecture/adr/0054-deno-runtime-supersedes-node.md) · [ADR-0006](../../../handbook/architecture/adr/0006-modular-monolith-core-api.md) (anti-padrão #13).
- Fatia 1: commit `72448d6e` (fundação dos workspaces) · harness `scripts/migration/runtime-signature.ts`.
