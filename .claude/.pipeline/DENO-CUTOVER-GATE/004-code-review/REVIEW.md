# DENO-CUTOVER-GATE — W2 (revisão read-only)

## Veredito: ✅ APPROVED (round 1) — 0 Blocker, 0 Major, 1 Minor (follow-up já registrado)

## Verificações

| # | Item | Resultado |
| --- | --- | --- |
| 1 | `compilerOptions` espelha o strict do tsconfig + `types:[]` | ✅ 8 flags idênticos ao tsconfig |
| 2 | Helper `module-dir.ts` correto (usa `import.meta.url` → `string` nos 2 runtimes) | ✅ sem narrowing (evita eslint no-unnecessary-condition) |
| 3 | Todos os `resolve(import.meta.dirname, …)` migrados | ✅ 0 restantes |
| 4 | Tasks `check`/`lint`/`fmt-check` | ✅ os 3 verdes via `deno task` |
| 5 | `deno.lock`: adições legítimas | ✅ nodemailer/resend + deps (o check amplo resolveu; eslint/prettier rodam standalone, fora do grafo) |
| 6 | Regressão zero Node | ✅ `tsc` + `pnpm test` **4307/0**, `pnpm lint` rc=0 |
| 7 | Escopo | ✅ só `deno.json` + helper + 5 sites (nada de produção não-relacionado) |

## Minor (follow-up já registrado)

- **17 testes fazem `spawn(process.execPath, [flags-node])`** — falham sob `deno test` (execPath=deno,
  flags do Node inválidas). Classe "adaptar spawn Node→Deno", follow-up da adaptação do harness
  (Etapa 3/4). Não é regressão deste ticket (passam sob `node --test`). Documentado no W1/W3 e no épico.

## Recomendação

Prosseguir para W3.
