# Implementation Plan: Guarda de boot da configuração de persistência

**Branch**: `spike/0023-runtime-and-database-swap` (spec criada sem branch própria — ver Nota de branch) | **Date**: 2026-07-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/037-persistence-driver-boot-guard/spec.md`

> **Nota de branch**: a spec nasceu fora de branch de feature (o hook `speckit.git.feature` é `optional` e não foi executado, para não perturbar trabalho não-commitado na branch corrente). O ticket de pipeline deve abrir sua própria branch antes do W0.

## Summary

Substituir o ternário `env['X_DRIVER'] === 'mysql' ? mysql : memory`, hoje copiado em 7 pontos de `src/server.ts`, por **uma** função compartilhada que lê o ambiente e devolve `Result<config, readonly string[]>` — exatamente o formato de `readEmailLinkBaseUrls`. Em produção, driver ausente/inválido ou URL faltante vira **erro acumulado** e o boot encerra com **exit 78**; fora de produção, cai em `memory` com aviso nomeando o módulo. A função é pura (recebe `env` por parâmetro), então o W0 é teste de unidade sem subir servidor.

**A mudança de comportamento é concentrada no `server.ts`.** Nenhum módulo, agregado, schema ou rota é tocado.

## Technical Context

**Language/Version**: TypeScript 6 / Node.js 24 LTS (ESM, `NodeNext`, `--experimental-strip-types`)

**Primary Dependencies**: nenhuma nova. Usa `Result<T,E>` de `#src/shared/primitives/result.ts` e `process.env`/`process.exit` do runtime.

**Storage**: N/A — a feature **decide** qual storage usar, não fala com nenhum.

**Testing**: `node:test` + `node:assert/strict`. Unidade pura sobre a função (env injetado como objeto literal), no molde de `tests/shared/http/email-link-base-urls.test.ts` (8 casos, zero I/O).

**Target Platform**: contêiner Linux (ECS em produção, Compose em QA/dev).

**Project Type**: modular monolith — mudança no **composition root** (`src/server.ts`) + um módulo compartilhado novo.

**Performance Goals**: N/A — executa uma vez no boot, antes de abrir porta. Custo desprezível (leitura de ~20 variáveis de ambiente).

**Constraints**: a validação MUST rodar antes de qualquer pool ser aberto e antes de `app.listen`. MUST NOT quebrar `pnpm test` (que sobe módulos em `memory` sem env nenhuma) nem o fluxo local.

**Scale/Scope**: 7 módulos · 8 leituras de `*_DRIVER` · 6 fallbacks `driver: 'memory'` · 4 fontes em cascata no módulo somente-leitura. ~1 arquivo novo + `server.ts` + 1 suíte de teste.

## Constitution Check

_GATE: avaliado antes da Phase 0 e reavaliado após a Phase 1._

| Princípio                              | Status  | Observação                                                                                                                                                                         |
| -------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I — TDD fail-first W0→W3**           | ✅ PASS | A função é pura e injetável ⇒ W0 RED trivial (importa símbolo inexistente). Ticket de pipeline obrigatório: **não** é bug de 1-3 linhas.                                           |
| **II — Regressão zero**                | ✅ PASS | A feature **é** a aplicação do princípio ao boot: troca degradação silenciosa por falha alta. Gate W3 completo obrigatório.                                                        |
| **III — pnpm único**                   | ✅ PASS | Nenhuma dependência nova; nenhum comando `npm`.                                                                                                                                    |
| **IV — Modular Monolith / isolamento** | ✅ PASS | O `server.ts` é o composition root — o **único** lugar que legitimamente conhece todos os módulos. Nenhum import cruzado `domain/`/`application/` é criado. Nenhuma tabela tocada. |
| **V — Domínio puro**                   | ✅ PASS | Nada em `domain/`. A função nova é `shared` e já nasce no formato canônico: sem classe, sem `throw`, `Result<T,E>`, erro como string.                                              |
| **VI — MySQL + Drizzle**               | ✅ PASS | Zero mudança de schema, zero migration (ver seção Migrations).                                                                                                                     |
| **VII — HTTP-first**                   | ✅ PASS | Nenhuma rota, schema Zod ou contrato de borda alterado. Só o bootstrap que monta a borda.                                                                                          |
| **VIII — TS strict + ESM + idioma**    | ✅ PASS | `import type`, extensão `.ts`, subpath `#src/*`. Código EN; mensagens ao humano em PT (dicionário do próprio módulo, como o molde).                                                |
| **IX — Citação canônica**              | ✅ PASS | Duas decisões-chave ancoradas — ver Phase 0 / `research.md`.                                                                                                                       |

**Resultado: PASS sem violações.** Seção "Complexity Tracking" fica vazia (removida).

### Ponto de atenção que o gate não pega

O `server.ts` já tem **duas** decisões registradas em ADR que **parecem** o mesmo fallback e não são: réplica de leitura opcional (ADR-0026) e composição de programa degradável (ADR-0032). Endurecer qualquer uma delas contradiz ADR aceito — é o risco de execução número 1 desta feature, e está travado como FR-008 e como caso de teste explícito no W0.

## Project Structure

### Documentation (this feature)

```text
specs/037-persistence-driver-boot-guard/
├── plan.md              # Este arquivo
├── research.md          # Phase 0 — decisões técnicas + citações canônicas
├── data-model.md        # Phase 1 — a forma da configuração de bootstrap
├── quickstart.md        # Phase 1 — como provar cada CA à mão
├── contracts/
│   └── env-matrix.md    # Phase 1 — matriz módulo × variável (o contrato real desta feature)
├── checklists/
│   └── requirements.md  # 16/16
└── tasks.md             # Phase 2 — gerado por /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── shared/
│   ├── persistence/
│   │   ├── module-driver-config.ts   # ← NOVO: a função única (FR-001)
│   │   ├── mysql-pool-config.ts      # (existente)
│   │   └── pool-registry.ts          # (existente)
│   ├── http/
│   │   └── email-link-base-urls.ts   # (existente — molde a imitar, NÃO alterar)
│   └── primitives/
│       └── result.ts                 # (existente — Result<T,E>)
└── server.ts                         # ← ALTERADO: 8 leituras de env → 1 chamada

tests/
└── shared/
    └── persistence/
        └── module-driver-config.test.ts  # ← NOVO: W0 RED
```

**Structure Decision**: a função vai para `src/shared/persistence/` — não para `src/shared/http/` junto do molde. O molde vive em `http/` porque valida URLs **de link HTTP**; o que esta feature valida é **persistência**, e a pasta já existe com dois vizinhos do mesmo assunto (`mysql-pool-config.ts`, `pool-registry.ts`). Imitar o molde é decisão de **forma**, não de endereço.

## Phase 0 — Research

Gerado em [research.md](./research.md). Cinco decisões, todas fechadas (zero `NEEDS CLARIFICATION` remanescente):

1. **Formato do retorno** — `Result<config, readonly string[]>`, idêntico ao molde.
2. **Onde falha** — o `server.ts` mantém a responsabilidade de encerrar; a função não chama `process.exit`. Mantém a função pura e testável.
3. **Uma chamada para os 7, não sete chamadas** — o acumulador exige visão do conjunto (FR-005).
4. **Endereço efetivo do módulo somente-leitura** — a cascata é resolvida **antes** da validação.
5. **Estratégia de teste** — unidade pura, sem subir servidor nem tocar rede/banco.

## Phase 1 — Design & Contracts

- **[data-model.md](./data-model.md)** — a forma da configuração de bootstrap (não é entidade de domínio; é dado de composição).
- **[contracts/env-matrix.md](./contracts/env-matrix.md)** — a matriz módulo × variável × obrigatoriedade. **É o contrato central desta feature**: o que quebra deploy não é assinatura de função, é nome de variável.
- **[quickstart.md](./quickstart.md)** — roteiro manual de verificação dos CAs.

### Reavaliação do Constitution Check pós-design

Sem mudança: **PASS**. O design não introduziu classe, `throw` em caminho de domínio, dependência nova, tabela, rota nem import cruzado. O único arquivo novo em `src/` é uma função pura em `shared/`.

## Complexity Tracking

_Sem violações de constituição — seção não aplicável._

## Migrations Drizzle (core-api)

- **Mudanças de schema**: [x] **nenhuma**
- **Prefixo de isolamento correto?** N/A — nenhuma tabela criada ou alterada
- **Outbox**: não — nenhum evento de domínio novo
- **Comando**: N/A — `pnpm run db:generate` **não** deve ser executado nesta feature
- **Restrições MySQL 8 (ADR-0020)**: N/A

## Contrato HTTP (Fase 2+)

**N/A quanto a rotas.** Nenhum endpoint, schema Zod ou status code é criado ou alterado.

O que muda é o **contrato operacional** do processo — que é contrato de verdade, com consumidor real (a plataforma de deploy):

| Situação                                            | Hoje                                                   | Depois                                                       |
| --------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Configuração de persistência incompleta em produção | sobe em `memory`, HTTP 200, dado descartado no restart | **exit 78**, não abre porta                                  |
| Fonte faltante no módulo somente-leitura            | `throw` genérico → **exit 1** ("aplicação quebrada")   | **exit 78** ("configuração errada"), acumulado com os demais |
| Configuração ausente fora de produção               | silêncio                                               | sobe em `memory` + aviso por módulo                          |
| Ambiente correto                                    | sobe                                                   | **idêntico** — sem regressão (FR-009)                        |

## Estimativa de Pipeline (W0 size)

- **Tamanho**: [x] **M** — refactor localizado com regra nova; 1 arquivo novo + composition root + 1 suíte.
- **Justificativa**: não é **S** porque muda comportamento observável de produção (exige suíte de CAs, não é config de 1-3 linhas). Não é **L** porque não cria bounded context, agregado, tabela, evento nem rota — a superfície é um arquivo `shared` e um `server.ts`. O risco não está no volume de código, e sim em **não** endurecer as duas degradações que têm ADR.
- **Ticket sugerido**: `SHARED-DRIVER-BOOT-GUARD` (verificar colisão com `STATE.json` fechado antes de criar).

### Plano de testes W0 (RED)

Suíte nova `tests/shared/persistence/module-driver-config.test.ts`, falhando por inexistência de `#src/shared/persistence/module-driver-config.ts`:

| #   | Caso                                                                             | CA / FR           |
| --- | -------------------------------------------------------------------------------- | ----------------- |
| 1   | produção + driver ausente → erro nomeando módulo e variável                      | US1-1, FR-002     |
| 2   | produção + `mysql` sem URL → erro nomeando a URL                                 | US1-2, FR-003     |
| 3   | produção + driver com typo (`mysqll`) → erro citando valor inválido              | US1-3, FR-002     |
| 4   | produção + tudo correto → `ok`, 7 módulos em `mysql`                             | US1-4, FR-009     |
| 5   | produção + 3 módulos quebrados → **3** erros no mesmo retorno                    | US2-1, FR-005     |
| 6   | produção + módulo com 2 problemas → ambos no retorno                             | US2-2             |
| 7   | fora de produção + nada configurado → `ok` em `memory` + avisos nomeando módulos | US3-1, FR-006     |
| 8   | `memory` explícito em produção → `ok`, sem erro                                  | US3-2, FR-007     |
| 9   | variável vazia (`X_DRIVER=`) → tratada como ausente                              | Edge Case         |
| 10  | `NODE_ENV` ausente → regra permissiva                                            | Edge Case         |
| 11  | módulo somente-leitura: 4 fontes resolvidas por cascata → `ok`                   | FR-012, Edge Case |
| 12  | módulo somente-leitura: 1 fonte não resolve → erro acumulado (não isolado)       | FR-012, US2-3     |
| 13  | **réplica de leitura ausente → NÃO é erro** (ADR-0026)                           | FR-008            |
| 14  | **composição de programa indisponível → segue degradando** (ADR-0032)            | FR-008            |

Casos **13 e 14 são os mais importantes da suíte**: são os que impedem a correção de atropelar decisão registrada em ADR.
