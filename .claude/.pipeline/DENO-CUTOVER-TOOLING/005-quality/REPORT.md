# DENO-CUTOVER-TOOLING — W3 (gate de qualidade)

## Resultado: 🟢 GREEN — todos os gates verdes, regressão zero

## Mundo Node (CA4 — backstop de regressão zero)

| Gate | Comando | Resultado |
| --- | --- | --- |
| typecheck | `pnpm run typecheck` (`tsc --noEmit`) | ✅ rc=0 |
| format | `pnpm run format:check` (`prettier --check .`) | ✅ "All matched files use Prettier code style!" |
| lint | `pnpm run lint` (`eslint .`) | ✅ rc=0 |
| test | `pnpm test` (node --test) | ✅ **4326 tests · 4307 pass · 0 fail** · 19 skip (integração auto-skip) |
| probe/Node | `node --test … probe.test.ts` | ✅ 1 pass · 0 fail |

O `deno.json` não afeta o Node (ignorado pelo runtime) — como esperado, zero regressão.

## Mundo Deno (CA2 + CA3)

| Prova | Comando | Resultado |
| --- | --- | --- |
| Gate isolado (era RED) | `DENO_NO_PACKAGE_JSON=1 deno check <probe>` | ✅ rc=0 |
| Resolver (grafo) | `DENO_NO_PACKAGE_JSON=1 deno info <probe>` | ✅ `#src/…`→`src/…`, `#scripts/…`→`scripts/…` |
| Suíte de módulos (normal) | `deno test tests/modules/` | ✅ **1033 passed (3734 steps) · 0 failed** |

## Critérios de aceite — fechamento

- **CA1** ✅ trailing-slash apenas no mapeamento (`deno.json:7-8`).
- **CA2** ✅ gate isolado GREEN.
- **CA3** ✅ `deno test tests/modules/` verde + provas de resolver; import map é aditivo (mapeia idêntico ao glob antigo).
- **CA4** ✅ Node: typecheck + format + lint + test todos verdes (4307/0).
- **CA5** ✅ `src/` intocado.

## Entrega

- `deno.json` — chave `imports` (`#src/`, `#scripts/` trailing-slash). Autoridade de resolução
  interna sob Deno agora vive no `deno.json`, independente do `package.json` (que sai na Etapa 4).
- `tests/migration/deno-import-map.probe.test.ts` — canário durável (roda em Node e Deno).

## Próxima etapa do épico

**Etapa 2 (Dependências)** — swaps `jsr:`/`npm:` + `deno.lock`. Independente; ver `DENO-ONLY-CUTOVER.md`.
