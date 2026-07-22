# PLAN-404-CLOSEOUT — Fechamento do guarda-chuva #404 (Bloco D)

> Documento de planejamento sintetizado a partir do dossiê adversarial de 6 frentes (worktree `404-analysis` em `origin/dev` fc94435f, com `src/modules/reports/` completo). Cada afirmação carrega verdito (CONFIRMED / REFUTED / UNCERTAIN) e âncora `arquivo:linha` / `#issue`. **UNCERTAIN = não vira W0 sem dado adicional da P.O.**
>
> Origem: workflow multi-agente `plano-404-closeout` (25 agentes: 6 investigadores + refutação adversarial por hipótese + síntese), usando os MCPs `acdg-skills`/`security` da `mcp-server` (Tailscale) para ancorar teoria em citação literal. 2026-07-15.

---

## 0. Verificação independente (checada à mão pós-workflow, não delegada)

Três afirmações load-bearing do dossiê foram reconferidas no código real antes de aceitar:

1. **Teste-landmine — CONFIRMADO (e é uma bomba na `dev` mergeada).** `tests/modules/financial/public-api/payment-position.drizzle-mysql.test.ts:50-53` (REP-4 / #243, **já em `dev`**) faz `delete(finCostCenters)` + `delete(finCategories)` **sem `where`** no `beforeEach` — mesma contaminação de seed corrigida no REP-3. Só não estourou por **acidente de ordenação**: no manifesto, `category-read` (`test-integration.ts:122`) e `cost-center-read` (`:123`) rodam **antes** de `payment-position` (`:137`), com o seed ainda intacto. É o item #0 do roadmap. (O dossiê citou o path como `adapters/persistence/` — o real é `public-api/`.)
2. **CI não roda integração — CONFIRMADO.** `.github/workflows/ci.yml:8-9` diz textualmente que integração fica atrás de `*_INTEGRATION=1` e **não** dispara no CI. O verdito `gate-integracao-fora-do-ci=REFUTED` refutou a _ação_ proposta (criar uma "suíte reports"), **não** o fato — `reports` é ACL delegador, sem SQL próprio; os testes de read-model vivem nos módulos-fonte.
3. **ADR-0049 existe e está `Proposed` — CONFIRMADO.** `handbook/architecture/adr/0049-core-api-bff-boundary.md` (`Status: Proposed`). Corrige o que se dizia antes ("#348 é ADR pendente"): o ADR já foi **escrito**, falta **ratificar**.

---

## 1. Sumário executivo

O #404 tem 8 de 10 sub-frentes fechadas; resta o **Bloco D** = `reports` (#114, 4/9 slices entregues) + `dashboard` (#112, não iniciado, virou BFF). A análise adversarial mostra que **nenhum dos 2 slices de reports pendentes (#441 Realizado×Planejado, #442 Relatório Geral) está pronto para W0**: ambos dependem de decisões de produto ainda abertas (a fonte do "Realizado" em #416; a forma do response de colunas dinâmicas em #442), e os 3 slices de recebíveis do #179 precisam de **re-especificação com a P.O.**, não de "desbloqueio" — o módulo `receivables` que o #179 pressupõe foi descartado pela P.O. (2026-07-01). O que **está** decidido e acionável: a fronteira core↔BFF (ADR-0049, três hipóteses CONFIRMED) fixa que o dashboard #112 é composição no BFF (#352), **não** módulo `statistics` no core; e existe **um bug latente de isolamento de teste** (`payment-position.drizzle-mysql.test.ts:50-53` apaga tabela semeada inteira) que **deve ser corrigido antes** de qualquer slice que toque `fin_categories`/`fin_cost_centers` — ou seja, antes do #441. Fechar o #404 sem regressão = (a) corrigir o teste-landmine, (b) elevar ADR-0049 a Accepted, (c) levar 4 travas de decisão à P.O., (d) só então especificar #441/#442 já dentro das réguas (intra-BC, anti-join em memória, `.strict()`, reader boot-scoped, pool consolidado).

---

## 2. As 9 slices de reports (#114) + dashboard (#112)

| Slice                           | Issue      | Estado             | Bloqueio                                                                                 | Caminho                                                                                                      |
| ------------------------------- | ---------- | ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| REP-1 Equipe ABC                | #238       | ✅ MERGED (dev)    | —                                                                                        | entregue; integração em manifesto `partners` (`test-integration.ts:90`)                                      |
| REP-2 Fornecedores sem Contrato | #240/#437  | ✅ MERGED          | —                                                                                        | precedente **canônico** de anti-join cross-BC em memória (`list-suppliers-without-active-contract.ts:37-46`) |
| REP-3 Análise de Planejamento   | #440       | ✅ MERGED          | —                                                                                        | fonte única `financial` (não é cross-BC); molde de reader boot-scoped                                        |
| REP-4 Posição Pagamentos        | #243       | ✅ MERGED          | —                                                                                        | entregue; **carrega o teste-landmine** (`payment-position.drizzle-mysql.test.ts:50-53`)                      |
| REP-5 Realizado×Planejado       | #441       | ⛔ OPEN, bloqueado | **#416** (fonte do Realizado) + vínculo plano↔lançamento inexistente no read-model       | ver Trava 1; UNCERTAIN — cross-BC bgp×fin, precisa decisão P.O. antes de W0                                  |
| REP-6 Relatório Geral           | #442       | ⛔ OPEN            | forma do response (`.strict()` vs `additionalProperties:true`) + reader paginado ausente | ver Trava 3; lista paginada bounded (CONFIRMED) + allowlist de `columns` (CONFIRMED)                         |
| REP-7 Posição Recebíveis        | #179 (1/3) | ⛔ adiado          | **sem fonte** — cash-basis não expressa competência/aging                                | ver Trava 2; re-especificar ou **descartar/fundir** com Análise                                              |
| REP-8 Análise de Recebimentos   | #179 (2/3) | ⛔ adiado          | fonte = Recebimento conciliado (dep. #171)                                               | ver Trava 2; computável cash-basis, mas só após #171 fixar "Recebimento"                                     |
| REP-9 Fluxo de Caixa            | #179 (3/3) | ⛔ adiado          | só coluna REALIZED é computável; EXPECTED-recebíveis herda o gap do #179                 | ver Trava 2; entregar só REALIZED, EXPECTED fica needs-decision                                              |
| Dashboard                       | #112       | ⛔ não iniciado    | virou BFF (#348/#349/#352/#353)                                                          | ver Trava 4; agregações atômicas no core + DTO no BFF                                                        |

Nota de contexto: os módulos hoje em `src/modules/` são `auth, budget-plans, contracts, financial, notifications, partners, programs, reports` — **não existe** `statistics`, `dashboard` nem `receivables`.

---

## 3. As 4 travas de decisão

### Trava 1 — Fonte do "Realizado" (#416 / #441)

**Hipótese vencedora:** nenhuma CONFIRMED. As duas hipóteses de mecanismo ficaram **UNCERTAIN** e uma **REFUTED**:

- `realizado-fonte-conciliado-readmodel` → **UNCERTAIN**. A direção (Realizado ≈ soma de `fin_reconciliation_items.reconciled_value_cents` de reconciliations Active, chaveado por refs do documento, 100% intra-`fin_`, boot-scoped) é largamente correta e **ADR-0014-compliant** (o JOIN `items→reconciliations→payables→documents` é intra-BC). Mas o **mecanismo** (JOIN síncrono sobre write-tables) contraria ADR-0022 (read-model = projeção sobre event-stream, "NUNCA derivada por query direta"); spec 030 linha 43 / FR-004 pedem read-model **evento-carregado**. E a fonte é oficialmente **decisão aberta**: #441 (CA4) amarra `totalRealized` à "fonte definida na #416", e #416 (aberta 2026-07-11) ainda **pergunta** a fonte.
- `arvore-cc-cat-subcat-e-o-bloqueio-real` → **UNCERTAIN**. O núcleo técnico está CONFIRMADO: `document.costCenterRef/categoryRef` resolvem para `fin_cost_centers`/`fin_categories` (catálogo próprio, `payment-position-projection.ts:79-80`), **não** para `bgp_*`; o documento não tem ref de subcategoria bgp; sem unificação fin↔bgp (#341 follow-up). Logo a árvore fiel ao legado (`openapi.yaml:3070-3113` CC→Cat→Subcat→mês) exige decisão de modelagem. Mas a moldura "a fonte já está definida, o bloqueio é só granularidade" é **falsa**: são **dois bloqueios abertos** (fonte #416 é o primário, granularidade é o secundário).
- `composicao-cross-bc-em-memoria-por-identidade` → **REFUTED**. O invólucro (compor em memória, nunca JOIN cross-BC, consistência eventual — Vernon p.464) é correto, mas o **join key `budgetPlanId` não existe no read-model**: `fin_payable_view` (`mysql.ts:551-591`) projeta só `categoryRef/costCenterRef/programRef`, **sem** `budget_plan_ref` (que existe só na tabela-fonte `fin_documents:88`). E o precedente citado estava errado: REP-3/#440 é **fonte única** (não cross-BC); o molde real de anti-join cross-BC é **REP-2/#437**.

**Recomendação:** tratar #441 como candidato líder mas **não** plano fechado. Antes de W0: (1) **resolver #416 com a P.O.** — confirmar Realizado = soma de conciliados e formalizar o vínculo plano↔lançamento; (2) implementar como **read-model evento-carregado** (ADR-0022) — estender `fin_payable_view` com `reconciledValueCents` + `budgetPlanRef`, OU nova projeção `fin_realized_view` alimentada por eventos de reconciliação, **não** JOIN síncrono; (3) **fatiar #441** em (a) nível-plano/raiz (entregável, exige plumbing de `budgetPlanRef` no read-model) e (b) árvore fiel ao legado (bloqueada por unificação de catálogos); (4) escopar só A PAGAR — A RECEBER depende de Conciliação "Recebimento" (Trava 2).

**Decisão que resta à P.O./humano:**

- Realizado vem da soma de lançamentos CONCILIADO? Qual o vínculo plano↔lançamento (budgetPlanRef nível-plano vs identidade CC/Cat via unificação #341)?
- Granularidade: totais raiz+plano já, ou árvore fiel CC→Cat→Subcat→mês (exige unificar catálogos, capturar subcategoria bgp no "Lançar Documento" #64, ou descopar)?
- Semântica de "Provisionado" (candidato: comprometido não-conciliado) — sem definição no modelo novo.
- Ano filtra por competência/vencimento ou por `reconciledAt`?

### Trava 2 — Receita via Conciliação (#171 / #179)

**Hipótese vencedora:** `posicao-recebiveis-precisa-redefinicao-po` → **CONFIRMED**. "Posição" de pagáveis = títulos em aberto por vencimento (`fin_payable_view.dueDate` + baldes de status, REP-4). Recebíveis não têm título em aberto: `fin_manual_entries` (`mysql.ts:790-819`) só registra recebimento **já realizado** e **não tem coluna `date`**. Sem "recebível esperado" (que a P.O. decidiu não criar), "Posição Recebíveis" ou colapsa em "Análise de Recebimentos" ou fica sem fonte. `PositionReport` legado (`openapi.yaml`) serve o mesmo schema para payables E receivables com `totalPendente/totalPago/totalAtrasado` — 2 dos 3 baldes não têm fonte cash-basis.

REFUTED/UNCERTAIN relacionadas:

- `receita-e-recebimento-conciliado-nao-agregado-receivables` → **UNCERTAIN**. `Receipt` já é `ManualEntryType` (`types.ts:15-21`), com CHECK (`mysql.ts:812-815`) e evento `ManualEntryRecorded` (`events.ts:14`); não existe `receivables` (grep vazio). Mas a hipótese superestima: pede reescrever o #179 **inteiro** para cash-basis (não cobre "Posição" de competência), e fixa a fonte em `manual_entries.type=Receipt` quando a decisão da P.O. amarra receita ao **#171** (mecanismo distinto: classificação do EXTRATO, #159; #171 ainda OPEN). "90% construído" é falso: reports tem **0%** de read-model de receipt.
- `reports-le-recebimentos-via-acl-reader-boot-scoped` → **UNCERTAIN**. O esqueleto ACL (reader boot-scoped na public-api + adapter que recebe `list`, nunca connection-string — Evans p.226) é sólido e ADR-safe. Mas "espelhando `openPaymentPositionReader` 1:1" é falso (os readers irmãos leem o **read-model** `fin_payable_view`, não OLTP cru em join de 3 tabelas); a data do recebimento **não é indexada** em nenhuma coluna-candidata (full-scan real, não hipotético); e a fonte "Recebimento" está **unsettled** (#171 OPEN, `movement='Credit'`+entry_type vs `manual_entries.type='Receipt'`).

**Recomendação:** **NÃO** reescrever o #179 em bloco. Rotular `needs-decision`/`requirements`, anexar esta análise, e fatiar: (a) "Análise de Recebimentos" (cash-basis) computável **após #171** fixar a definição de "Recebimento" — data via join intra-`fin_` a `fin_statement_transactions.date` (`mysql.ts:682`); (b) "Fluxo de Caixa" só a coluna REALIZED (EXPECTED-recebíveis herda o gap); (c) "Posição Recebíveis" permanece **sem fonte** → fundir com Análise ou descartar. Qualquer slice de receita **cria** o reader de receipts (não existe hoje) e segue ADR-0022 (read-model `fin_receipt_view` projetado de `ManualEntryRecorded`), não OLTP direto. Fechar #171 primeiro; #179 só depois.

**Decisão que resta à P.O.:**

- "Posição Recebíveis" = recebimentos realizados agrupados (⇒ duplicata de Análise, descartar) ou conceito prospectivo (⇒ fora do cash-basis, nova modelagem)?
- "Recebimento" canônico = `fin_manual_entries.type='Receipt'`, `fin_statement_transactions.movement='Credit'`+categorização (#171/#159), ou ambos?
- Fechar/reescopar #179; fechar #171 (2/2 filhos DONE) como pré-req satisfeito da categorização.

### Trava 3 — Colunas dinâmicas / Relatório Geral (#442)

**Hipóteses vencedoras (2 CONFIRMED):**

- `columns-input-cliente-allowlist-400` → **CONFIRMED**. O param `columns` é seleção de campos controlada pelo cliente (`openapi.yaml:1984-1988`); `GeneralReportColumn` é enum **fechado** de 14 valores (`openapi.yaml:2432`). Deve ser validado como allowlist estrita `z.array(z.enum(...))` na **entrada**, rejeitando desconhecido com **400** (CA3, nunca ignorar em silêncio — OWASP Input Validation, verbatim). Nenhum nome de coluna do request interpolado no SQL (lookup fixo enum→campo de projeção).
- `lista-paginada-bounded-sem-full-scan` → **CONFIRMED**. REP-6 é o **único** slice que LISTA linha-a-linha (não agrega). `fin_payable_view` só tem índices de coluna única (`mysql.ts:572-579`), nenhum composto filtro+ordenação → risco de `type=ALL`/filesort sob `status` de baixa cardinalidade (MySQL Refman §10.2.1.23, verificada). Exige reader novo boot-scoped, `pageSize` bounded (molde `max(100)`, `schemas.ts:216`; legacy default 5), e **EXPLAIN sem `type=ALL`** (CA5) — provavelmente índice composto novo, ex. `(status, due_date)`.

- `catalogo-enumerado-strict-nao-linha-aberta` → **SEM VERDITO ADVERSARIAL** (não consta no array de verdicts da frente). Direcionalmente alinhada às outras duas (enum fechado + `.strict()` do módulo), mas **não foi verificada** — tratar como recomendação, não fato.

**Recomendação:** desacoplar input de output: CA3 (400) satisfeito pelo `z.enum` de **entrada**, independente da decisão de forma da resposta (envelope `{items,page,pageSize,total}` `.strict()` vs `Record<string,unknown>`). O enum entregue deve ser **subconjunto curado de pagáveis**: FINANCIADOR/COLABORADOR/reportType=RECEIVABLE herdam #179; PIX/BANCARY são dado bancário sensível (CWE-200); CODE/TIPO/PIX vivem em `fin_documents` (fora da view, mesmo BC); NUMERO_CONTRATO/FORNECEDOR são cross-BC (anti-join, nunca JOIN — ADR-0014:130). Reader novo segue `openPaymentPositionReader`, **não** `PayableListView.findPaged` (que lê o write-model e é inacessível ao reports por ADR-0006). Levantar quais das 14 colunas o front v2 usa (YAGNI).

**Decisão que resta à P.O.:**

- Envelope tipado `.strict()` (recomendado, saldaria o débito #384) vs linha aberta `additionalProperties:true`?
- Subconjunto de colunas do front v2 (evitar portar 14 à toa).
- Confirmar escopo só PAYABLE agora.
- CSV/PDF server-side entram no slice ou o front monta do JSON?

### Trava 4 — Fronteira core↔BFF (#348 / dashboard #112)

**Hipóteses vencedoras (3 CONFIRMED):**

- `dto-composicao-mora-no-bff` → **CONFIRMED**. ADR-0049 (`handbook/architecture/adr/0049-core-api-bff-boundary.md`) fecha: core expõe agregações atômicas (SUM/GROUP-BY/TOP-N em centavos/enum EN), BFF monta o `DashboardStatisticsDto` (%, top-N, distribuição, layout). Invariante #2 (MUST NOT core retornar DTO de tela), #6 (composição cross-agregado via BFF/batch-by-id, sem JOIN cross-módulo). Portar o DTO 1:1 pro core = Alternativa A rejeitada. Newman p.588 (BFF single-purpose, verbatim).
- `statistics-fino-ou-por-modulo-nunca-join` → **CONFIRMED**. Agregações atômicas ficam no **módulo dono** (financial, reports, budget-plans, conciliação/#171); **NÃO criar módulo `statistics`** (nem fino). `reports` é **débito transicional congelado** (ADR-0032→0049), não precedente a clonar. #350 batch-by-id = REF→rótulo, **não** agregação.
- `ordem-adr-feito-agregacao-antes-do-dto-bff` → **CONFIRMED**. Ordem = ADR (feito) → agregação crua no core → DTO no BFF (#352). #352 bloqueado pela etapa de agregação-no-core, **não** pelo ADR. Retrabalho garantido = portar o DTO legado 1:1 (inclui `totalRevenue`, sem fonte até #171). OWASP Session Management (BFF pattern, verbatim).

**Correção factual load-bearing:** o ADR-0049 está com **Status: Proposed**, não Accepted — o próprio PR #354 diz "aguarda ratificação do tech lead" e o arquivo nunca foi promovido. Pela hierarquia do AGENTS.md (só ADR **aceito** vence tudo), há lacuna de governança.

**Recomendação:** (1) **elevar ADR-0049 Proposed→Accepted** (1 commit) antes de tratar seus MUST como inegociáveis; (2) reescopar o corpo do #112 (pede DTO no core = Alt. A) para **só agregações atômicas** (kpis/cost-centers/realized/last-payments/no-contract-suppliers em cents+enum, `.strict()`, pools boot-scoped), deixando a montagem do DTO no #352; (3) reusar readers existentes (REP-2 no-contract, financial public-api, `variation.ts` #237) — anti-join em memória, nunca JOIN `fin_*×ctr_*/bgp_*`; (4) `totalRevenue` fica **fora** do core até #171 (front consome placeholder honesto).

**Decisão que resta à P.O./TL:**

- Flip ADR-0049 para Accepted (governança).
- Confirmar M-1×M-2 (`variation.ts` #237) como régua oficial de comparação (#112 ainda lista como needs-decision).
- Sequenciar #320 (token escopado) antes de #353 (share externo).

---

## 4. Roadmap de tickets/specs

Ordem por dependência. Legenda de gate: **[DEC]** decisão P.O./TL antes de tudo · **[ADR]** ADR primeiro · **[W0→W3]** ticket de pipeline direto · **[SPEC]** `/speckit-specify` (feature nova/ambígua).

| #   | Item                                                                              | Gate          | Tamanho | Depende de                   | Nota                                                                                                                                           |
| --- | --------------------------------------------------------------------------------- | ------------- | ------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Corrigir `payment-position.drizzle-mysql.test.ts:50-53` (delete tabela→`inArray`) | [W0→W3]       | S       | —                            | **PRÉ-REQUISITO** de qualquer slice que toque `fin_categories`/`fin_cost_centers`; provar suíte `financial` verde no x99 com ordem embaralhada |
| 1   | Elevar ADR-0049 Proposed→Accepted                                                 | [ADR]         | XS      | —                            | fecha lacuna de governança; libera #112/#352 como normativos                                                                                   |
| 2   | Fechar #171 (Recebimento canônico)                                                | [DEC]         | S       | P.O.                         | 2/2 filhos DONE; define fonte de receita p/ #179 e dashboard                                                                                   |
| 3   | Resolver #416 (fonte do Realizado + vínculo plano↔lançamento)                     | [DEC]         | M       | P.O.                         | desbloqueia #441; sem isso #441 é especulativo                                                                                                 |
| 4   | Re-especificar #179 (rotular needs-decision)                                      | [DEC]→[SPEC]  | M       | #2                           | fatiar em Análise (viável), Fluxo REALIZED (viável), Posição (fundir/descartar)                                                                |
| 5   | Reescopar corpo do #112 (só agregações atômicas)                                  | [W0→W3]       | S       | #1                           | remover pedido de DTO no core                                                                                                                  |
| 6   | Agregações atômicas do dashboard (por módulo dono)                                | [W0→W3]       | M       | #1, #5                       | reusar `variation.ts`, readers financial/reports; `.strict()`; sem `totalRevenue`                                                              |
| 7   | #442 REP-6 Relatório Geral (só PAYABLE)                                           | [DEC]→[SPEC]  | L       | #0, decisão strict-vs-aberta | reader paginado bounded + índice composto + allowlist `columns`                                                                                |
| 8   | #441 REP-5 nível-plano/raiz                                                       | [SPEC]        | L       | #0, #3                       | read-model evento-carregado (budgetPlanRef); intra-fin; sem árvore                                                                             |
| 9   | #441 REP-5 árvore fiel legado                                                     | [DEC]         | XL      | #8, unificação #341          | **bloqueado** até unificar catálogos fin↔bgp ou capturar subcategoria no #64                                                                   |
| 10  | #179 Análise de Recebimentos + Fluxo REALIZED                                     | [SPEC]        | L       | #2, #4                       | cria reader de receipts (não existe); read-model `fin_receipt_view`                                                                            |
| 11  | Consolidação de pool na borda HTTP (CORE-DB-POOL-CONSOLIDATE-READPORTS)           | [ADR]→[W0→W3] | L       | —                            | follow-up do #407; **não** bloqueia slices; ver Riscos                                                                                         |

Itens 2/3/4 são **gates de decisão humana** — nada de W0 antes deles. Itens 9/10 dependem de trabalho em **outros módulos** (budget-plans/financial), não só reports.

---

## 5. Matriz de teste e regressão-zero

**Fundamento (Kent Beck p.125/p.139, verificados):** testes independentes de ordem; DB real só na fatia de integração. **Contexto crítico:** a CI **não roda** integração MySQL (`ci.yml:7-9`); as suítes rodam via `pnpm run test:integration:*` no **x99** (fonte de verdade). O gate `gate-integracao-fora-do-ci` foi **REFUTED**: `reports` não tem SQL próprio (adapters são delegadores ACL), então não há "suíte reports" a criar — os testes de read-model vivem nos **módulos-fonte** e já estão no manifesto (`test-integration.ts:63/90/135/137/139`).

| Slice                 | Camada 1 (borda `inject`, roda no `pnpm test`)                          | Camada 2 (use-case in-memory)                                                  | Camada 3 (integração MySQL gated, x99)                                                                     |
| --------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| #0 correção teste     | —                                                                       | —                                                                              | re-rodar `financial` inteira verde, **ordem embaralhada** (prova isolamento, não acidente)                 |
| #442 REP-6            | contrato `.strict()` + `columns` desconhecida→400 (CA3) + authz 200/403 | opcional (passthrough fino provável)                                           | 1 integração no manifesto `financial`: paginação + **EXPLAIN sem `type=ALL`** (CA5)                        |
| #441 nível-plano      | contrato `.strict()` + authz                                            | **obrigatória** (composição/anti-join bgp×fin em memória, função pura + fakes) | 2 integrações: `financial` (realizado) + `budget-plans` (expected/provisioned); `partners` **irrelevante** |
| #179 Análise/Fluxo    | contrato `.strict()` + authz                                            | anti-join se cruzar BCs                                                        | 1 integração no módulo-fonte (novo `fin_receipt_view`), data por período — validar índice                  |
| dashboard #112 (core) | contrato `.strict()` por endpoint atômico                               | anti-join em memória (fakes)                                                   | integração no módulo dono de cada agregação                                                                |

**Blindagem contra a classe de bug (`isolamento-inarray` — CONFIRMED):**

1. **Nenhum** teste novo dá `delete` em tabela semeada; limpar só refs próprios via `inArray`/`where` (precedente `payables-analysis.drizzle-mysql.test.ts:51-58`). Vítimas hoje se `payment-position` não for corrigido: `category-read:47` (seed 0012, `>=11`) **e** `cost-center-read:43` (seed 0013, `>=5`).
2. Correção do item #0 é **obrigatória antes** de #441 (que toca essas tabelas); **não** basta reordenar o manifesto — reordenar mantém a fragilidade (viola independência de ordem de Beck).
3. **Higiene anti-órfão:** todo reader novo em módulo-fonte → registrar seu `.drizzle-mysql.test.ts` no suite **existente** de `test-integration.ts` (precedente #316, `linha 99`) + rodar x99.
4. Realoca-se o anti-join cross-BC para a **camada 2** (memória, `pnpm test`), como `suppliers-without-active-contract.test.ts` — **nunca** como parte da integração MySQL (a matriz-3-camadas na sua forma literal ficou UNCERTAIN por alocar isso errado).
5. Job de CI de integração path-filtered (espelhando `integration-notifications.yml`) é **defesa-em-profundidade nice-to-have**, **não** substitui o gate x99.

---

## 6. Riscos e o que NÃO fazer

**Pool exhaustion (frente #407):**

- `boot-scoped-nao-limita-contagem` → **CONFIRMED**: boot-scoped limita churn por-requisição, **não** a contagem de pools/processo (+1 por slice). `composition.ts` do reports abre 5 pools; 3 na **mesma** `financialUrl` sem dedup. Todas as `*_DATABASE_URL` batem no mesmo `core_app@RDS` (`pool-registry.ts:4-7`); Incident-0001 estourou 56/60. A causa aguda (maxIdle inerte) **já foi corrigida**; o footprint dos +3 pools é folga, não incidente iminente.
- `registry-na-borda-http` e `dedup-url-vs-bulkhead-read-write` → **REFUTED**: o PoolRegistry (#407) está wired **só** no worker-runner (`run.ts:30`); `server.ts` não o referencia. "Só instanciar o registry" **subestima** — os readers da public-api recebem `{connectionString}`, não `Pool`; consolidar exige nova superfície de public-api em financial/partners/contracts. **NÃO** tratar isso como bloqueio de #441/#442 (eles travam por domínio/produto). Rotear para o follow-up já nomeado **CORE-DB-POOL-CONSOLIDATE-READPORTS** (ainda sem diretório `.pipeline`). `REPORTS_FINANCIAL_DATABASE_URL` (`server.ts:243`) já permite réplica de leitura dedicada por env, sem código.
- **Fazer:** definir orçamento Σ(connectionLimit) ≤ teto do `core_app` (MySQL Refman §8.2.21, verificada) como invariante antes de somar readers; escopar dedup só aos 3 readers do reports OU dar URL de leitura própria.

**Cross-BC join:** **NUNCA** JOIN SQL entre `ctr_*`/`bgp_*` × `fin_*` (ADR-0014:130, verbatim). Composição cross-BC = anti-join em memória (precedente REP-2/#437), consistência eventual (Vernon p.464). Cuidado com a armadilha: `document.costCenterRef/categoryRef` são catálogo `fin_*`, **não** `bgp_*` — assumir que são IDs bgp e casar por eles produz totais furados (pior que não entregar).

**`.strict()` (ADR-0027):** toda response Zod `.strict()`. Não abrir `Record<string,unknown>` no #442 sem decisão P.O. — reabriria o débito #384 (CWE-200) em vez de saldá-lo. Valores em centavos/enum EN no core; %/R$/label só no BFF.

**Especificar antes do ADR / decisão:** **NÃO** especificar #441 antes de #416; **NÃO** especificar #179 antes de #171; **NÃO** construir o DTO de dashboard no core (Alt. A do ADR-0049); **NÃO** portar `totalRevenue` sem fonte. Elevar ADR-0049 a Accepted antes de invocar seus MUST como imutáveis.

**O que ficou UNCERTAIN e precisa de mais dados antes de virar teste:** a fonte/mecanismo do Realizado (#441 — precisa da resposta do #416 e da definição de read-model evento-carregado); a fonte de "Recebimento" (#179/#171 — #171 OPEN); a granularidade da árvore do #441 (depende de unificação #341). Esses **não** viram W0 sem decisão humana.
