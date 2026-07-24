# DENO-CUTOVER-DEPS — W2 (revisão read-only)

## Veredito: ✅ APPROVED (round 1) — 0 Blocker, 0 Major, 2 Minor (triados)

## Verificações

| # | Item | Resultado |
| --- | --- | --- |
| 1 | Completude do map (19 specifiers externos) | ✅ todos os 15 pacotes + `zod-openapi` + subpaths têm chave |
| 2 | Pares trailing-slash p/ subpaths | ✅ `drizzle-orm/`, `mysql2/`, `zod/` |
| 3 | zod em `npm:` (não jsr) — dual-package safe | ✅ `"zod": "npm:zod@4.4.3"` |
| 4 | jose em `jsr:` | ✅ `jsr:@panva/jose@^6.2.3` (→6.2.4) |
| 5 | Lock limpo + completo | ✅ 0 poluição; 136 pacotes com integrity |
| 6 | Resolução empírica | ✅ 169→0 "not a dependency" (W1) |
| 7 | Funcional | ✅ Fastify+zod+openapi verdes sob isolamento (W1) |
| 8 | Escopo | ✅ `src/` e `package.json` intocados |

## Minor (triados, não-bloqueantes)

1. **`@fastify/static` advisory (high+moderate)** — pré-existente nos dois mundos (paridade com
   `pnpm audit`, que acha até 1 a mais). Transitivo via `@fastify/swagger-ui@5.2.6`, dev-only.
   Fix é major upstream. → **issue-report** (afeta o Node hoje), fora do escopo (anti-padrão #15).
2. **`import.meta.url` (6× TS2339) sob `deno check`** — pré-existente ao Deno, pertence à Etapa 4
   (deno check substitui tsc). Runtime OK (`deno test --no-check`). Registrar na Etapa 4.

## Nota supply-chain (a decisão do ticket materializada)

O `deno.lock` re-resolveu a árvore (ex.: `mysql2 3.23.1`, `@aws-sdk 3.1093.0`, `find-my-way`
corrigido). O `deno audit` (2 vulns) ≤ `pnpm audit` (3) — o cutover **não piora** o posture.
Os overrides do pnpm (esbuild/fast-uri/brace-expansion) **não** foram carregados p/ o Deno — se
algum advisory reaparecer no futuro, o equivalente Deno é pin no import map / `deno.json`. Hoje,
`deno audit` não acusa nenhum deles (a re-resolução já pegou versões corrigidas). Monitorar na Etapa 4.

## Recomendação

Prosseguir para W3 (suíte Deno ampla + regressão zero no mundo Node).
