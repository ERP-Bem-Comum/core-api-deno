# DENO-CUTOVER-DEPS — escopo

> Size **M**. Etapa **2 (Dependências)** do épico [`DENO-ONLY-CUTOVER`](../../.planning/DENO-ONLY-CUTOVER.md).
> Decisão: [ADR-0054](../../../handbook/architecture/adr/0054-deno-runtime-supersedes-node.md) + [ADR-0056](../../../handbook/architecture/adr/0056-deno-only-cutover-amends-0054.md). Autoridade técnica: playbook `deno-runtime-expert`.

## Problema

A Etapa 1 moveu `#src/`/`#scripts/` para o `deno.json`. Falta a **superfície externa**: hoje o
Deno resolve os bare specifiers de npm (`fastify`, `mysql2`, `drizzle-orm`, …) via `package.json` +
`node_modules`. Isolando (`DENO_NO_PACKAGE_JSON=1`), `deno check src/server.ts` quebra nesses bares.
Sem declará-los no `deno.json#imports`, a remoção do `package.json` (Etapa 4) mataria a resolução.

## Objetivo

Declarar **todas as ~15 deps externas** no `deno.json#imports` (`jsr:` onde há alternativa boa,
`npm:` no resto), sem tocar os imports do código (baixo churn — os specifiers do `src/` seguem
`'fastify'`, `'zod/v4'`, etc.; o import map faz a ponte). Gerar `deno.lock` (fonte de verdade).

## Decisões (fixadas)

- **Supply-chain:** o `deno.lock` **re-resolve** a árvore transitiva (versões mais novas que o
  `pnpm-lock.yaml` — medido: `strnum 2.3.0→2.4.1`, etc.). Aceito **re-resolução deliberada**, gateada
  por `deno audit` + suíte completa verde. Alinhado ao ADR-0056 §Remoção. **Não** é drift silencioso.
- **zod → `npm:zod@4.4.3`** (NÃO jsr): o `zod-openapi`/`fastify-zod-openapi` puxam npm:zod transitivo;
  mapear o `zod` do app para JSR criaria duas cópias e racharia o registry → quebra o OpenAPI
  (ADR-0027). Confirmado pela lição registrada do dual-package.
- **jose → `jsr:@panva/jose@^6.2.3`** (JSR): mesmo autor (panva), API idêntica, superfície de 2
  arquivos, JSR tem 6.2.4 (satisfaz `^6.2.3`).
- **`@std/*` deferido:** trocar `node:*` por `jsr:@std/*` é churn maior e o `node:` resolve nativo —
  fica para follow-up, fora desta etapa.
- **@aws-sdk:** mapeado `npm:` (resolve/typecheck). A resolução de credencial **IAM Role/IMDS** em
  runtime é **incógnita** validada no ambiente real (spike próprio), fora do escopo de resolução.

## Mapa de imports (bare + trailing-slash onde há subpath)

`npm:` — `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@fastify/{cors,helmet,rate-limit,swagger,swagger-ui}`,
`drizzle-orm` (+ `drizzle-orm/`), `fast-xml-parser`, `fastify`, `fastify-zod-openapi`, `hash-wasm`,
`mysql2` (+ `mysql2/`), `nodemailer`, `resend`, `unpdf`, `zod` (+ `zod/`), `zod-openapi`.
`jsr:` — `jose` → `@panva/jose`.

## Escopo

1. Adicionar os mapeamentos externos ao `deno.json#imports`.
2. Gerar `deno.lock` (resolução Deno).
3. `deno audit` limpo (ou achados triados) + suíte verde sob Deno.

## Fora de escopo

- Remover `package.json`/`pnpm-lock` → Etapa 4. Trocar `node:*`→`@std` → follow-up.
- Trocar os 46 imports `#src/modules/X/public-api` → `@core/X` → Etapa 3.
- Corrigir o hook `block-npm.sh` p/ tolerar specifier `npm:` → **achado**, Etapa 4.

## Critérios de aceite

- **CA1** — `deno.json#imports` declara as ~15 deps externas (bare + trailing-slash onde há subpath).
- **CA2** — `DENO_NO_PACKAGE_JSON=1 deno check src/server.ts` **passa** (era RED nos bares externos).
- **CA3** — `deno test` da suíte de unidade **verde** sob resolução via `deno.json` (0 regressão funcional).
- **CA4** — `deno.lock` gerado e commitado; `deno audit` sem high/critical não-triado.
- **CA5** — Regressão zero no mundo Node (`pnpm run typecheck`+`format:check`+`lint`+`test` verdes) — não tocamos `src/` nem `package.json`.

## Referências

- Épico `DENO-ONLY-CUTOVER` · ADR-0056 · lição dual-package do Zod · ADR-0027 (OpenAPI).
