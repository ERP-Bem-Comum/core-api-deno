# DENO-CUTOVER-DEPS — W3 (gate de qualidade)

## Resultado: 🟢 GREEN — todos os gates verdes, regressão zero

## Mundo Node (CA5)

| Gate | Resultado |
| --- | --- |
| `pnpm run typecheck` | ✅ rc=0 |
| `pnpm run format:check` | ✅ "All matched files use Prettier code style!" (deno.json/deno.lock OK) |
| `pnpm run lint` | ✅ rc=0 |
| `pnpm test` | ✅ **4326 · 4307 pass · 0 fail** · 19 skip |

`deno.json`/`deno.lock` são invisíveis ao Node — regressão zero, como esperado.

## Mundo Deno (CA2 + CA3 + CA4)

| Prova | Resultado |
| --- | --- |
| Resolução (`DENO_NO_PACKAGE_JSON=1 deno check src/server.ts`) | ✅ 169→0 "not a dependency" |
| Funcional isolado (`tests/shared/http/`) | ✅ 8 passed — Fastify+zod+openapi 3.1.1 |
| Suíte ampla normal (`deno test tests/modules/ tests/shared/`) | ✅ **1084 passed (3938 steps) · 0 failed** |
| `deno.lock` | ✅ 136 pacotes npm + jose (jsr) |
| `deno audit` | ✅ 2 vulns (`@fastify/static`) **triadas** — pré-existentes, paridade-ou-melhor vs `pnpm audit` (3) |

## CAs — fechamento

- **CA1** ✅ 19 specifiers externos mapeados (bare + trailing-slash).
- **CA2** ✅ resolução 169→0.
- **CA3** ✅ deno test 1084/0.
- **CA4** ✅ deno.lock gerado; audit triado (high pré-existente, não silencioso).
- **CA5** ✅ Node verde (4307/0).

## Entrega

- `deno.json#imports` — 19 deps externas (`jsr:@panva/jose`; `npm:` no resto; zod em npm).
- `deno.lock` — árvore re-resolvida (fonte de verdade Deno), auditada.

## Follow-ups registrados (fora do escopo — anti-padrão #15)

1. **`@fastify/static` advisory** (high+moderate, transitivo via swagger-ui, dev-only) — afeta o Node
   HOJE (paridade com `pnpm audit`). → issue-report.
2. **`import.meta.url` (6× TS2339) sob `deno check`** — Etapa 4 (deno check substitui tsc).
3. **hook `block-npm.sh` colide com specifier `npm:`** — Etapa 4 (ensinar o hook a distinguir CLI vs specifier).

## Próxima etapa do épico

**Etapa 3 (Enforce)** — `DENO-WS-HYBRID` reescopado: 46 imports `#src/modules/X/public-api` → `@core/X`.
