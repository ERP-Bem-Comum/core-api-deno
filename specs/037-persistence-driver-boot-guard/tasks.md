---
description: 'Task list — Guarda de boot da configuração de persistência (#456)'
---

# Tasks: Guarda de boot da configuração de persistência

**Input**: Design documents from `/specs/037-persistence-driver-boot-guard/`

**Prerequisites**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md) · [data-model.md](./data-model.md) · [contracts/env-matrix.md](./contracts/env-matrix.md) · [quickstart.md](./quickstart.md)

**Tests**: **OBRIGATÓRIOS**. O Princípio I da constituição (TDD fail-first W0→W3) é NÃO-NEGOCIÁVEL — todo teste desta feature é escrito **RED antes** de tocar `src/`.

**Organization**: agrupadas por user story. Ver "Nota sobre independência" antes de planejar entregas separadas.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivo diferente, sem dependência pendente)
- **[Story]**: US1, US2, US3 conforme `spec.md`

## Nota sobre independência das stories

As três stories compartilham **um** arquivo de produção (`src/shared/persistence/module-driver-config.ts`). Elas são **independentemente testáveis** — cada uma tem seus casos e seu critério de verificação —, mas **não** são independentemente _deployáveis_: entregar a US1 sem a US3 deixaria a suíte de testes e o desenvolvimento local exigindo configuração que hoje não exigem (risco R2 do `research.md`).

**Consequência prática**: o MVP real é **US1 + US3**. A US2 é a única genuinamente adiável. Isto está refletido em "Implementation Strategy".

---

## Phase 1: Setup

**Purpose**: abrir o rastro do pipeline antes de qualquer código.

- [ ] T001 Verificar colisão de nome antes de criar o ticket: `ls .claude/.pipeline/ | grep -i driver` e conferir se algum `STATE.json` fechado já usa `SHARED-DRIVER-BOOT-GUARD`
- [ ] T002 Abrir o ticket com `pnpm run pipeline:state init SHARED-DRIVER-BOOT-GUARD --size M`
- [ ] T003 Escrever o escopo em `.claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/000-request.md` referenciando esta spec, a issue #456 e os incidentes #374/#444
- [ ] T004 Criar a branch de trabalho a partir da `dev` atualizada (a spec 037 nasceu sem branch própria — ver "Nota de branch" no `plan.md`)

---

## Phase 2: Foundational (bloqueia todas as stories)

**Purpose**: fixar o contrato de ambiente e a forma do dado antes de escrever asserção sobre eles.

**⚠️ CRÍTICO**: nenhuma story começa antes desta fase.

- [ ] T005 Conferir `contracts/env-matrix.md` linha a linha contra `src/server.ts` na `dev` atual — a matriz foi levantada em 2026-07-22 e o arquivo pode ter mudado; corrigir a matriz se divergir
- [ ] T006 Conferir a configuração real de QA e de produção contra a matriz e **registrar** quais variáveis faltam hoje em cada ambiente (risco R3 — é o que dirá se algum ambiente vai parar de subir)
- [ ] T007 Marcar `W0` como iniciada: `pnpm run pipeline:state wave-start SHARED-DRIVER-BOOT-GUARD W0 --agent tdd-strategist`

**Checkpoint**: contrato de ambiente confirmado, impacto de rollout conhecido.

---

## Phase 3: User Story 1 — Deploy incompleto é barrado (P1) 🎯 MVP

**Goal**: em produção, configuração de persistência ausente/inválida derruba o boot com código de configuração, em vez de servir dado volátil.

**Independent Test**: subir com `NODE_ENV=production` e a configuração de um módulo omitida; o processo termina com exit 78 e não abre porta (`quickstart.md`, CA1–CA3).

### Testes primeiro (W0 — devem falhar por inexistência do módulo)

- [ ] T008 [US1] Criar `tests/shared/persistence/module-driver-config.test.ts` importando `readModuleDriverConfigs` de `#src/shared/persistence/module-driver-config.ts` (import quebrado = RED correto)
- [ ] T009 [P] [US1] Caso 1 em `tests/shared/persistence/module-driver-config.test.ts`: produção + driver ausente → erro nomeando módulo **e** variável
- [ ] T010 [P] [US1] Caso 2: produção + `mysql` sem endereço → erro nomeando a variável de endereço
- [ ] T011 [P] [US1] Caso 3: produção + driver com typo (`mysqll`) → erro citando o valor recebido e os valores aceitos
- [ ] T012 [P] [US1] Caso 4: produção + configuração completa → `ok`, os 7 módulos em `mysql`, nenhum erro (prova de FR-009)
- [ ] T013 [P] [US1] Caso 9: variável presente mas vazia (`X_DRIVER=`) → tratada como ausente, não como valor inválido
- [ ] T014 [P] [US1] Caso 10: `NODE_ENV` ausente → regra permissiva, sem erro
- [ ] T015 [US1] Rodar `pnpm test` e **confirmar o RED**; registrar a saída em `.claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/002-tests/REPORT.md`

### Implementação (W1)

- [ ] T016 [US1] Criar `src/shared/persistence/module-driver-config.ts` com o tipo de configuração por módulo como **união discriminada** por `driver` (`data-model.md`) — estado `mysql` sem endereço deve ser irrepresentável
- [ ] T017 [US1] Implementar `readModuleDriverConfigs(env): Result<ModuleDriverConfigs, readonly string[]>` em `src/shared/persistence/module-driver-config.ts`, no molde de `src/shared/http/email-link-base-urls.ts` (acumula em `string[]`, retorna `err(errors)` só no fim)
- [ ] T018 [US1] Escrever as mensagens de erro em PT nomeando módulo + variável (FR-010, ancorado em Uncle Bob p. 107 — ver `research.md` D3); **nunca** ecoar o valor de um endereço de conexão (`data-model.md`, seção final)
- [ ] T019 [US1] Substituir em `src/server.ts` as 8 leituras de `*_DRIVER` por **uma** chamada a `readModuleDriverConfigs(process.env)`, encerrando com `process.exit(78)` no ramo de erro — mesma forma de `server.ts:126-129`
- [ ] T020 [US1] Posicionar a chamada **antes** de qualquer pool ser aberto e antes de `app.listen` em `src/server.ts` (research.md D2)
- [ ] T021 [US1] Rodar `pnpm test` e confirmar GREEN dos casos 1, 2, 3, 4, 9, 10

**Checkpoint**: o defeito que causou #374 e #444 não pode mais acontecer em produção.

---

## Phase 4: User Story 2 — Diagnóstico completo numa tentativa (P2)

**Goal**: todos os problemas de configuração saem no mesmo relatório, com o mesmo código de saída — incluindo os do módulo somente-leitura, que hoje interrompem sozinhos com exit 1.

**Independent Test**: subir com três módulos mal configurados e verificar que os três aparecem antes de o processo encerrar (`quickstart.md`, CA4).

### Testes primeiro (W0)

- [ ] T022 [P] [US2] Caso 5 em `tests/shared/persistence/module-driver-config.test.ts`: produção + 3 módulos quebrados → **3** erros no mesmo retorno
- [ ] T023 [P] [US2] Caso 6: módulo com dois problemas simultâneos → ambos presentes no retorno
- [ ] T024 [P] [US2] Caso 11: módulo somente-leitura com as 4 fontes resolvidas **por cascata** (overrides ausentes, módulos-fonte configurados) → `ok` (FR-012, research.md D4)
- [ ] T025 [P] [US2] Caso 12: módulo somente-leitura com 1 fonte que não resolve → erro **acumulado** junto aos demais, não isolado
- [ ] T026 [US2] Rodar `pnpm test` e confirmar o RED dos casos 5, 6, 11, 12

### Implementação (W1)

- [ ] T027 [US2] Resolver a cascata `override ?? endereço-do-módulo-fonte` **dentro** de `src/shared/persistence/module-driver-config.ts`, validando o endereço efetivo (FR-012)
- [ ] T028 [US2] Remover de `src/modules/reports/adapters/http/composition.ts:109-119` os quatro `throw new Error('reports-composition: driver mysql exige …')`, agora cobertos pela guarda — a validação sai do módulo e vai para o composition root
- [ ] T029 [US2] Ajustar `src/server.ts` para passar os quatro endereços já resolvidos ao módulo de relatórios, sem repetir a cascata no arquivo
- [ ] T030 [US2] Verificar que nenhum teste existente dependia da mensagem antiga: `grep -rn "reports-composition" tests/` e atualizar o que houver
- [ ] T031 [US2] Rodar `pnpm test` e confirmar GREEN dos casos 5, 6, 11, 12

**Checkpoint**: quem conserta ambiente descobre tudo de uma vez; falha de configuração deixa de se disfarçar de falha de aplicação (FR-013).

---

## Phase 5: User Story 3 — Desenvolvimento e testes sem fricção (P3)

**Goal**: fora de produção, tudo sobe como hoje — mas com aviso nomeando cada módulo degradado. E `memory` explícito vale em qualquer ambiente.

**Independent Test**: `node src/server.ts` sem variável nenhuma sobe funcional, com um aviso por módulo (`quickstart.md`, CA5–CA6).

### Testes primeiro (W0)

- [ ] T032 [P] [US3] Caso 7 em `tests/shared/persistence/module-driver-config.test.ts`: fora de produção + nada configurado → `ok` em `memory` + avisos nomeando cada módulo
- [ ] T033 [P] [US3] Caso 8: `memory` **explícito** em produção → `ok`, sem erro (FR-007)
- [ ] T034 [P] [US3] **Caso 13**: endereço de réplica de leitura ausente → **NÃO** é erro (ADR-0026) — o teste que protege a decisão registrada
- [ ] T035 [P] [US3] **Caso 14**: composição de programa indisponível → segue degradando, sem falhar o boot (ADR-0032)
- [ ] T036 [US3] Rodar `pnpm test` e confirmar o RED dos casos 7, 8, 13, 14

### Implementação (W1)

- [ ] T037 [US3] Implementar o ramo fora-de-produção em `src/shared/persistence/module-driver-config.ts`: `memory` + coleção de avisos (canal separado do de erros)
- [ ] T038 [US3] Emitir os avisos em `src/server.ts`, um por módulo degradado (FR-006)
- [ ] T039 [US3] Reconhecer `memory` como valor de primeira classe no campo de driver (`contracts/env-matrix.md`, seção "Valores aceitos") — hoje é só "qualquer coisa != mysql"
- [ ] T040 [US3] Confirmar que réplica de leitura e composição de programa **não** entraram na validação (FR-008); revisar `src/server.ts:152-163` e `:167-168,185-186` sem alterá-los
- [ ] T041 [US3] Rodar `pnpm test` completo e confirmar GREEN dos 14 casos, **sem regressão** na contagem total

**Checkpoint**: `pnpm test` e o fluxo local seguem sem exigir infraestrutura nova.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T042 Remover de `src/server.ts:246-254` o aviso pontual do módulo de orçamento (PR #488), agora absorvido pela regra compartilhada — risco R4 do `research.md`
- [ ] T043 [P] Registrar a issue do **armazenamento de imagens** (`server.ts:210`) via skill `issue-report`, citando esta spec como precedente e a decisão Q1 do `/speckit-clarify` (FR-011)
- [ ] T044 [P] Percorrer o `quickstart.md` inteiro à mão (CA1–CA8) e anexar as saídas ao REPORT do W1
- [ ] T045 [P] Documentar a matriz de variáveis no runbook de deploy, para que a conferência de T006 não dependa de alguém lembrar
- [ ] T046 Rodar o W2 (review read-only): `pnpm run pipeline:state wave-start SHARED-DRIVER-BOOT-GUARD W2 --agent code-reviewer` — atenção especial a se algum ADR foi atropelado
- [ ] T047 Gate W3 completo: `pnpm run typecheck && pnpm run format:check && pnpm run lint && pnpm test`, com contagem ≥ baseline + 14 (SC-005)
- [ ] T048 Fechar o ticket: `pnpm run pipeline:state close SHARED-DRIVER-BOOT-GUARD`
- [ ] T049 Abrir PR contra a `dev` referenciando #456, #374 e #444, com a tabela de contrato operacional do `plan.md` no corpo

---

## Dependencies

```text
Phase 1 (Setup)
   └─> Phase 2 (Foundational) ── bloqueia tudo
          ├─> Phase 3 (US1) ── MVP funcional
          │      └─> Phase 4 (US2) ── depende da função criada em T016/T017
          │      └─> Phase 5 (US3) ── depende da função criada em T016/T017
          └─────────> Phase 6 (Polish) ── depende de US1+US2+US3
```

**US2 e US3 são independentes entre si** — depois que a US1 cria a função, as duas podem ser tocadas em paralelo por pessoas diferentes, desde que coordenem o mesmo arquivo de teste.

**T042 depende da US3**: remover o aviso do #488 antes de o aviso genérico existir deixaria o módulo de orçamento sem sinal nenhum na janela entre os dois commits.

## Parallel Execution Examples

**Dentro da US1 (W0)** — seis casos de teste, arquivos-alvo independentes entre si:

```text
T009, T010, T011, T012, T013, T014 em paralelo
   └─> T015 (confirmar RED) ── barreira
```

**Entre stories (depois de T017)**:

```text
US2: T022 → T023 → T024 → T025    ┐
                                   ├─ paralelas
US3: T032 → T033 → T034 → T035    ┘
```

**No Polish**: T043, T044, T045 são independentes (issue nova, verificação manual, doc de runbook).

## Implementation Strategy

### MVP = US1 + US3, não só US1

O template sugere "US1 sozinha = MVP". **Aqui não vale**: entregar só a US1 endurece produção mas deixa o desenvolvimento local e a suíte de testes sem o ramo permissivo — quebra o fluxo diário de quem desenvolve (risco R2). A menor entrega segura é **US1 + US3**.

### Ordem recomendada

1. **US1 + US3 juntas** — fecha o defeito de produção sem quebrar dev. É o que resolve #374/#444.
2. **US2** — melhora o diagnóstico e alinha o módulo somente-leitura. Adiável sem risco.
3. **Polish** — a T043 (issue do storage de imagens) não deve ser esquecida: é a dívida que a decisão Q1 assumiu conscientemente.

### Antes de fazer deploy

A T006 é a tarefa que decide se este deploy é tranquilo ou traumático. Um ambiente que hoje depende do fallback silencioso **vai parar de subir** — o que é o objetivo, mas precisa ser descoberto na conferência da matriz, não no deploy.

## Format validation

- Total: **49 tarefas** (T001–T049), todas com checkbox, ID sequencial sem lacuna, e caminho de arquivo ou comando explícito.
- Story labels: **US1 14 · US2 10 · US3 10**; as 15 restantes são Setup (4), Foundational (3) e Polish (8), que por regra não levam label.
- `[P]`: **17** tarefas marcadas, todas em arquivos ou artefatos distintos.
