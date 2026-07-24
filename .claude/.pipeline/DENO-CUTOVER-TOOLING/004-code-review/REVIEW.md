# DENO-CUTOVER-TOOLING — W2 (revisão read-only)

## Veredito: ✅ APPROVED (round 1) — 0 Blocker, 0 Major, 1 Minor (informativo)

Mudança de config mínima e cirúrgica: `deno.json#imports` (2 mapeamentos trailing-slash) + probe
durável. Auditoria read-only.

## Verificações

| # | Item | Resultado |
| --- | --- | --- |
| 1 | Sintaxe do mapeamento (trailing-slash, não glob) | ✅ `deno.json:7-8` — `"#src/": "./src/"`, `"#scripts/": "./scripts/"` |
| 2 | JSONC válido (comentários preservados pós-prettier) | ✅ diff limpo; **Deno lê como JSONC** (config loader), provado por `deno check`/`test` verdes |
| 3 | Resolução real no resolver | ✅ `deno info` (isolado) mapeia `#src/…`→`src/…` e `#scripts/…`→`scripts/…` |
| 4 | Alvos do probe são puros (sinal limpo) | ✅ `result.ts` (0 imports) + `reason.ts` (0 imports) |
| 5 | Disciplina de escopo | ✅ `git status src/` vazio; sem swap `jsr:`/`npm:` (Etapa 2); sem `@core/X` (Etapa 3); sem remoção de pnpm (Etapa 4) |
| 6 | Aderência ADR-0056 | ✅ "deno.json assume `#src/`/`#scripts/`" é literalmente a Etapa 1 |

## Nota falso-positivo (para não confundir no futuro)

`import('./deno.json', { with: { type: 'json' } })` **falha** com `SyntaxError: Expected
double-quoted property name` — porque o import de módulo JSON usa o parser **JSON estrito** (rejeita
comentários **por spec**). Isso **não** é defeito do `deno.json`: o Deno parseia o config como
**JSONC**. A validade real é atestada pelo Deno **usar** o import map (`deno info`/`deno check`).

## Minor (informativo, não-bloqueante)

- `package.json#imports` fica **redundante** (mas inofensivo) até a Etapa 4 — o Deno prefere o
  próprio import map; sem conflito (trailing-slash mapeia idêntico ao glob antigo). Remoção é da
  Etapa 4, fora deste ticket.

## Recomendação

Prosseguir para W3 (gate de qualidade + regressão zero no mundo Node).
