# DENO-WS-HYBRID — W0 (tdd-strategist)

## Resultado: 🔴 BLOCKER — a abordagem do ticket não é viável no Node

O W0 (fail-first) provou empiricamente que o **hibrido pnpm** proposto no `000-request.md`
(fazer cada módulo um pacote `@core/X` para resolver no Node) **quebra o codebase**.

### Prova 1 — `package.json` no módulo quebra `#src/*` interno

Com `src/modules/contracts/package.json` presente, um arquivo do módulo que usa `#src/`:

```
ERR_PACKAGE_IMPORT_NOT_DEFINED — Package import specifier
"#src/shared/adapters/clock-real.ts" is not defined in package
```

Um `package.json` cria uma **fronteira de pacote**; o Node resolve `#src/*` contra o
package.json **mais próximo** (o do módulo), que não tem o `imports` do root.

### Prova 2 — o fix (re-declarar `#src/*` no módulo) é PROIBIDO pelo Node

```
ERR_INVALID_PACKAGE_TARGET — Invalid "imports" target "../../*"
defined for '#src/*'
```

Subpath imports do Node **não podem apontar para fora do pacote** (`../` é vetado). Como o
`src/shared/` está **fora** do módulo, é impossível o `package.json` do módulo mapear `#src/*`
de volta ao root.

### Prova 3 — a escala real

`#src/` dentro dos módulos: **338 arquivos** (auth 30, contracts 19, **partners 178**,
programs 19, financial 67, budget-plans 22, notifications 3). O hibrido quebraria os 338,
não os 46 imports cross-módulo que o ticket sizou.

## Causa-raiz

O enforce do ADR-0006 **no Node** exige fronteiras de pacote (`package.json exports`), que
são **fundamentalmente incompatíveis** com o sistema `#src/*` (subpath imports do root
compartilhados por todo o `src/`). A fatia 1 provou que **no Deno** o enforce funciona (o
`deno.json` workspace resolve `#src/*` + `@core/X` sem conflito — 132 testes cross-módulo
verdes). O problema é **exclusivo do Node**.

## Recomendação (escalar — re-scope)

A ativação do enforce **não deve** vir via hibrido pnpm (impossível). Opções para o humano:

- **A (recomendada) — diferir para pós-Node.** Manter `#src/*` durante a transição
  strangler-fig (funciona nos dois runtimes). Quando o Node for aposentado, trocar os 46
  imports cross-módulo para `@core/X` **Deno-only** (o Deno resolve via `deno.json` sem
  quebrar `#src/*`). O enforce ativa no fim da migração de runtime, sem pnpm-hibrido.
- **B — eliminar `#src/*` por `@core/*`.** Criar `@core/shared` + os 7 pacotes e migrar os
  **338+** imports intra-módulo. Resolve nos dois runtimes, mas é migração de codebase
  inteira, não "46 imports".
- **C — status quo.** Manter só a fundação (fatia 1); o enforce fica ativo apenas ao rodar
  sob Deno, quando/se os imports migrarem.

A **fatia 1** (fundação `deno.json`) permanece correta e no lugar — nada a reverter.
