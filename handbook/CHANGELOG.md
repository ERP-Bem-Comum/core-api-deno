# 📜 Changelog do Handbook

Mudanças relevantes na documentação do projeto. Formato baseado em [Keep a Changelog](https://keepachangelog.com/).

---

## 2026-07-23 — 🦕🐘 ADR-0054 + ADR-0055 (Accepted): re-plataforma Deno + PostgreSQL

Decisão de re-plataforma do `core-api`, **medida antes de decidir** (spike `spike/0023`): sai do Node.js para o **Deno** ([ADR-0054](./architecture/adr/0054-deno-runtime-supersedes-node.md), supersedes [ADR-0002](./architecture/adr/0002-keep-nodejs-runtime.md) + [ADR-0009](./architecture/adr/0009-node-24-typescript-6-with-7-roadmap.md)) e do MySQL 8.4 para o **PostgreSQL** ([ADR-0055](./architecture/adr/0055-postgresql-supersedes-mysql.md), supersedes [ADR-0013](./architecture/adr/0013-mysql-database-engine.md) + [ADR-0020](./architecture/adr/0020-mysql-only-supersedes-dual-dialect.md)), **mantendo Drizzle**.

Evidência medida: `node:test` roda nativo no Deno (**4335/0**, zero migração de teste); modelo de permissões least-privilege (`deno.json`); binário único bootou o app contra MySQL real no x99. Schema Postgres sai **~95% idêntico** (mapeamentos portáveis do ADR-0018/0020); ganho concreto = **LISTEN/NOTIFY** (wake do outbox ~500ms→~6ms, medido). **Bun rejeitado por ora** (bun#5090 → 12k asserções para migrar); **Node 26 + tsgo** registrado como fallback. Estratégia: **strangler-fig por módulo**, Node autoritativo até a paridade, harness de assinatura diferencial (`scripts/migration/runtime-signature.ts`) travando cada passo. `src/` **não** tocado na decisão. Primeira fatia: **Deno workspaces** (1 membro por módulo, `exports` = public-api → enforça o [ADR-0006](./architecture/adr/0006-modular-monolith-core-api.md) no resolver).

---

## 2026-07-16 — 🔓 ADR-0052 (Accepted): modo `AUTH_RBAC_MODE=bypass` — desligar a autorização por permissão, mantendo a autenticação

Decisão do dono do sistema: introduzir o modo `bypass`, em que **todo usuário autenticado é
super-usuário** (a rota exige só *"está logado"*, não *"tem a permissão X"*). A autenticação
(`requireAuth`) permanece. Bypass **total** — inclui a auto-gestão de RBAC (atribuir/revogar papéis),
o que permite se auto-recuperar do #462. Guardas anti-silêncio (a condição da decisão): fail-secure
(só `AUTH_RBAC_MODE=bypass` exato liga; qualquer typo → `enforced`), banner gritante no boot, e default
`enforced`. **Ligável em produção**; o trade-off de escalação persistida (uma role admin concedida no
bypass sobrevive ao desligar) está documentado e aceito. Ver ADR-0052.

---

## 2026-07-15 — 🗂️ ADR-0051 (Accepted): owner da taxonomia — o Plano é dono do planejável, o Financeiro guarda o operacional

Novo [ADR-0051](./architecture/adr/0051-taxonomy-owner-budget-plan-scoped.md) (**Accepted**), que resolve o follow-up prometido ao fechar o **#341** (_"unificação canônica segue como follow-up"_ — nota que não sobreviveu ao ticket) e aberto como [#448](https://github.com/ERP-Bem-Comum/core-api/issues/448). Fixa a hierarquia canônica em **4 níveis: Plano Orçamentário → Centro de Custo → Categoria → Subcategoria**, ratificando a premissa da P.O. (_"tudo se vincula ao PLANO"_, do legado).

**Decisão:** o `budget-plans` é o **owner** da árvore do que é **planejável** (escopada por plano — `bgp_cost_centers.budget_plan_id` NOT NULL); o `financial` **lê a árvore do plano do documento** via `budget-plans/public-api` ([ADR-0006](./architecture/adr/0006-modular-monolith-core-api.md)) — Open Host Service no owner + ACL no consumidor (Vernon, _IDDD_, p. 142) — **sem espelhar nem copiar**. `fin_categories`/`fin_cost_centers` **não são fonte, nem projeção, nem deprecadas**: retêm o que **não é planejável** (classificação **operacional**). O fato decisivo, medido em QA: as categorias `ajuste` são **`Estorno`** e **`Ajuste de conciliação`** — que **nunca existirão num plano** (ninguém planeja um estorno), então uma projeção pura não teria onde colocá-las. Grounding: Evans, _DDD_, p. 199 — _"we need to make careful choices about which parts of the system will be allowed to diverge (…) **Total unification of the domain model for a large system will not be feasible or cost-effective**"_.

Encerra a _"divergência aceita por ora"_ que o [`07-categorization-taxonomy.md`](./domain_questions/financeiro/07-categorization-taxonomy.md) registrava: a divergência passa a ser **deliberada e delimitada** (planejável × operacional). Rejeitadas: (A) pura — `fin_categories` como projeção (não responde onde vive `Estorno`; e 0/91 documentos têm plano hoje, nada seria classificável); (B) — taxonomia global (contraria a premissa; `direction`/`launch_type` ficariam sem dono); e `program_ref` na referência global (é a (B) disfarçada — o legado copia a árvore **por plano**, e `plano ⊂ programa`).

**Define a regra do ETL do legado antes da migração** (era o risco urgente): as 34 categorias + **158 subcategorias** do legado (100% despesa, por programa, uma cópia por plano/ano) migram como **estrutura de planos** (`bgp_*`), **não** como seed de `fin_categories`. Destrava [#443](https://github.com/ERP-Bem-Comum/core-api/issues/443) (que **muda de natureza**), [#343](https://github.com/ERP-Bem-Comum/core-api/issues/343) e [#446](https://github.com/ERP-Bem-Comum/core-api/issues/446).

---

## 2026-07-08 — 🔀 ADR-0050 (Accepted): leitura de documento fiscal em cascata (nativo-first) — supersedes ADR-0034

Novo [ADR-0050](./architecture/adr/0050-document-reader-cascade-supersedes-0034.md) (**Accepted**), que **supersede** o [ADR-0034](./architecture/adr/0034-ocr-port-adapter.md) (OCR como Port/Adapter). Reorienta a leitura de documento fiscal de "OCR-engine-first" para uma **cascata nativo-first**: `XML estruturado → parser de texto nativo (in-house, node:zlib) → OCR self-hosted (microserviço externo, escaneado, adiado) → exceção manual`. Fundamentado em benchmark real do dono (parser nativo: **12/12 campos, ~10 ms CPU, 0 alucinação**; amostra 100% PDF nativo), varredura byte-level empírica (docs fiscais BR = xref clássico + FlateDecode, sem `/Encrypt`/`/ObjStm`) e pesquisa multi-fonte (LGPD bloqueia cloud OCR; `fast-xml-parser` já no lockfile; `mupdf` AGPL descartado). Muda o port de `OcrPort.extract(pdfUrl)` para **`DocumentReaderPort.read(bytes)`** — recebe bytes (anti-SSRF), nunca URL de input. Grounding DDD: ACL (Evans p.224) + Ports & Adapters (Vernon p.182). Pesquisa consolidada em `specs/034-fin-documento-reader/research.md`. Issues: [#62](https://github.com/ERP-Bem-Comum/core-api/issues/62), [#145](https://github.com/ERP-Bem-Comum/core-api/issues/145), [#290](https://github.com/ERP-Bem-Comum/core-api/issues/290).

---

## 2026-07-07 — 🔀 ADR-0049 (Proposed): fronteira de responsabilidade core-api ↔ BFF (Domain API + Experience API)

Novo [ADR-0049](./architecture/adr/0049-core-api-bff-boundary.md) (**Proposed**), **estado-alvo** do [ADR-0032](./architecture/adr/0032-transient-http-composition-read-until-bff.md) (composição transitória — a "rota gorda" é removida quando esta fronteira entra). Formaliza a inversão de responsabilidade decidida no refinement de 2026-07-07: **core-api = Domain API** (expõe dado cru já autorizado; dono de invariante, integração externa, agregação no banco e authz/multi-tenant) e **BFF = Experience API** (server-side TanStack Start, um por front) que compõe view-models por tela.

Régua normativa: *"o banco agrega → core-api; monta/formata o que já veio → BFF"*. Define o **contrato core↔BFF** (recursos por agregado em unidades canônicas + read-models [ADR-0022](./architecture/adr/0022-read-models-via-projection-over-event-stream.md) + endpoints **batch-by-id** contra N+1; contract-first Zod/OpenAPI [ADR-0027](./architecture/adr/0027-zod-openapi-contract-first-http-edge.md)), a **fronteira de authz/PII** (minimização e multi-tenant ficam no core por escopo, nunca delegados ao BFF — #53/#238), invariantes MUST/MUST NOT, e um **Apêndice A** que fundamenta *por que a agregação fica no banco* por citação literal do MySQL 8.4 Reference Manual (`10-optimization.part01.md` L697/L1089/L2154/L2164/L3537/L3560). Rollout faseado (só cards novos + apresentação pura); topologia híbrida (core sai da borda pública após o go-live). Rastreado em [#348](https://github.com/ERP-Bem-Comum/core-api/issues/348); fundação em [#349](https://github.com/ERP-Bem-Comum/core-api/issues/349) (camada BFF) e [#350](https://github.com/ERP-Bem-Comum/core-api/issues/350) (batch-by-id).

---

## 2026-06-23 — 🧭 ADR-0048 (Proposed): Anticorruption Layer legado↔core — gate das Camadas 0–2 (Dashboard/Reports/Budget Plans)

Novo [ADR-0048](./architecture/adr/0048-legacy-categorization-installments-mapping.md) (**Proposed**, aguardando ratificação do tech lead),
destilado do spike [#233](https://github.com/ERP-Bem-Comum/core-api/issues/233) — **gate da Camada 2** do épico [#169](https://github.com/ERP-Bem-Comum/core-api/issues/169).
Em **conformidade** com [ADR-0001](./architecture/adr/0001-strangler-fig-over-rewrite.md) (strangler fig, imutável), [ADR-0005](./architecture/adr/0005-thin-bff-gateway.md) (thin BFF) e ADR-0006/0014.

Três decisões, todas via **Anticorruption Layer** (Evans cap.14 — translation map), sem tocar a categorização 020 nem o modelo de payables:
**(D1)** reusar a **020**, não portar a hierarquia legada `CostCenter→Category→SubCategory`+`releaseType` (achatar 3 níveis → 2 dimensões + hierarquia opcional de `Category`);
**(D2)** mapear `installments→payables` — `Payable`(legado)→`Document`, `Installment`→`Payable`, e a fórmula-chave `SUM(Installment.value WHERE 'PAGO')` → `SUM(Payable.value WHERE 'Paid')`; **sem parcelamento temporal no core** (lacuna R-1 para migração de histórico);
**(D3)** dashboard **fatiado** (1 endpoint por widget). RBAC de Dashboard/Reports = **só autenticação** (ratificado pela P.O. em #233).
Destrava `DASH-F1`, `DASH-F5`, `REP-3`, `REP-4`. Relatório de pesquisa completo em [`.claude/.planning/SPIKE-233-CATEGORIZACAO-INSTALLMENTS.md`](../.claude/.planning/SPIKE-233-CATEGORIZACAO-INSTALLMENTS.md).

---

## 2026-06-18 — 📨 ADR-0047 (Accepted): e-mail transacional como evento de domínio no outbox do produtor

Novo [ADR-0047](./architecture/adr/0047-transactional-email-via-producer-domain-event.md) (**Accepted**), **estende** [ADR-0015](./architecture/adr/0015-mysql-outbox-pattern.md) (outbox/atomicidade) e
[ADR-0010](./architecture/adr/0010-email-port-adapter-pattern.md) (Email Port/Adapter).

Decisão (c) da issue [#134](https://github.com/ERP-Bem-Comum/core-api/issues/134) (follow-up de #117): o disparo de
e-mail transacional deixa de ser chamada cross-módulo best-effort e passa a ser **evento de domínio do módulo produtor**,
gravado no **seu** outbox na MESMA transação do save (atomicidade, ADR-0015) — `notifications` vira **consumidor**
(template → `EmailSender`), mesmo padrão de `fin_supplier_view` (ADR-0045) / `par_contract_count_view` (ADR-0046).
Consequências: `auth` ganha outbox de eventos (não tem hoje); o `notifications_email_outbox` (de `NOTIF-EMAIL-OUTBOX`)
vira redundante (aposentadoria planejada). Interino até a implementação: best-effort atual com fallback síncrono
(`NOTIF-INVITE-FALLBACK-SYNC`). Fatiamento proposto: `AUTH-DOMAIN-OUTBOX` + `NOTIF-EMAIL-EVENT-CONSUMER` +
`PARTNERS-INVITE-DOMAIN-EVENT`. Ratificado (**Accepted**) em 2026-06-18.

---

## 2026-06-17 — 🔗 ADR-0046 (Accepted): contrato de eventos `contracts → partners` (`contractorRef` p/ contagem nos grids, US6 #46)

Novo [ADR-0046](./architecture/adr/0046-contracts-contractor-ref-integration-events.md) (**Accepted**), **estende**
[ADR-0022](./architecture/adr/0022-read-models-via-projection-over-event-stream.md) (read-models via projeção idempotente) e
[ADR-0043](./architecture/adr/0043-partners-supplier-integration-events.md) (molde do contrato de integração cross-módulo, Opção A).

Desbloqueia a **US6** (#46) da feature 015: o `contracts` enriquece o wire-format v1 (**aditivo**, sem bump) com
`contractorRef` montado no adapter de outbox (Opção A — domínio intocado), e o `partners` projeta `par_contract_count_view`
via worker dedicado (molde da feature 014), idempotente por `eventId` (Vernon, _Implementing DDD_, p. 412). Fatiado em
**US6a** `CTR-CONTRACT-EVENT-CONTRACTOR-REF` (produtor `ctr_*`) + **US6b** `PAR-CONTRACT-COUNT-READMODEL` (consumidor
`par_*`, depende de 6a). Ratificado (Accepted) em 2026-06-17 — desbloqueia o W0 da US6a.

---

## 2026-06-16 — 🗂️ ADR-0045: read-model de fornecedor no `financial` (US2 da #47)

Novo [ADR-0045](./architecture/adr/0045-financial-supplier-read-model.md) (**Accepted**), **estende**
[ADR-0015](./architecture/adr/0015-mysql-outbox-pattern.md)/[ADR-0022](./architecture/adr/0022-read-models-via-projection-over-event-stream.md)/[ADR-0043](./architecture/adr/0043-partners-supplier-integration-events.md).
Feature [`014-financial-supplier-readmodel`](../specs/014-financial-supplier-readmodel/) (issue #47 US2).

- O `financial` mantém `fin_supplier_view` (read-model local) alimentado **só** por eventos do `partners`
  via `par_outbox` — o grid resolve nome+CNPJ sem chamada cross-módulo em runtime (LEFT JOIN intra-`financial`).
- **Consumer** em worker dedicado (composition root `src/workers/supplier-view-projection/`) sobre o worker
  de outbox genérico (`src/shared/outbox`); nenhum módulo importa o outro. Upsert idempotente com guard de
  `occurred_at` (at-least-once + fora de ordem). **Backfill** one-shot dos fornecedores legados.
- Decisão de manter outbox-MySQL (sem broker/Go) registrada em `.claude/.planning/ASYNC-MESSAGING-STRATEGY.md`.

## 2026-06-16 — 🔤 ADR-0044: CNPJ alfanumérico (Serpro/Receita 2026) no VO `Cnpj` do kernel

Novo [ADR-0044](./architecture/adr/0044-cnpj-alphanumeric-kernel.md) (**Accepted**), **estende** o
[ADR-0031](./architecture/adr/0031-partners-registry-module.md) §4. O VO `Cnpj` (`src/shared/kernel/cnpj.ts`),
fonte única cross-BC, passa a validar o **CNPJ alfanumérico**: 12 posições `[0-9A-Z]` + 2 DVs numéricos, mesmo
módulo 11 com `valor(c) = ASCII(c) − 48`. **Retrocompatível** (numérico valida idêntico) e **sem migration**
(persistência `varchar`, ADR-0020).

- Normalização passa a fazer `toUpperCase()` mantendo `A-Z`; valor brandado pode conter letras.
- Docstring do VO corrigido (removida referência stale a `financial/.../tax-id.ts`, inexistente).
- Ticket `CORE-CNPJ-ALPHANUMERIC` (W0→W3). Eventos que descrevem `document` como "14 dígitos" (ex.: ADR-0043) devem passar a dizer "14 caracteres alfanuméricos".

## 2026-06-16 — 📤 ADR-0043: contrato de eventos `partners → financial` (Supplier cadastrado/atualizado)

Novo [ADR-0043](./architecture/adr/0043-partners-supplier-integration-events.md) (**Accepted**), **estende**
[ADR-0015](./architecture/adr/0015-mysql-outbox-pattern.md) (outbox) e [ADR-0006](./architecture/adr/0006-modular-monolith-core-api.md)
(comunicação cross-módulo por eventos). Feature [`013-partners-supplier-outbox`](../specs/013-partners-supplier-outbox/) ·
issue [#92](https://github.com/ERP-Bem-Comum/core-api/issues/92) (pré-requisito da US2 da #47, read-model de fornecedor no `financial`).

- O `partners` passa a **publicar** `SupplierRegistered` e `SupplierEdited` no outbox `par_outbox` (ticket `PAR-SUPPLIER-EVENTS`).
  `SupplierDeactivated`/`SupplierReactivated` ficam **fora do contrato** (não mudam nome/CNPJ).
- **Payload autocontido** `{ supplierRef, name, document, occurredAt }`, montado **no adapter** a partir do snapshot do
  agregado (Opção A — domínio intocado), `JSON.stringify` em `varchar` (ADR-0020).
- **Atomicidade:** `save(supplier, events)` persiste o supplier **e** faz `appendOutboxInTx` na MESMA transação — rollback total
  se falhar. **At-least-once** + **idempotência** por `event_id` (upsert idempotente no consumidor).
- **Canônico:** Vernon, _Implementing DDD_, cap. "Domain Events" (evento de domínio interno vs evento de integração cross-fronteira).
- Consumer/read-model no `financial` (`fin_supplier_view`) é a **feature seguinte** (US2 da #47) — fora do escopo.

## 2026-06-16 — ⚙️ ADR-0041: workers especializados + jobs one-shot via cron externo

Novo [ADR-0041](./architecture/adr/0041-specialized-workers-and-oneshot-jobs.md) (**Accepted**), **estende** o
[ADR-0006](./architecture/adr/0006-modular-monolith-core-api.md). Fixa o padrão de **workers/jobs** do core-api:
um **entrypoint por responsabilidade** (HTTP · outbox-worker · jobs) no mesmo monorepo, e **jobs periódicos como
processos one-shot disparados por cron externo** — nunca `setInterval` long-running nem acoplado ao loop do outbox.

- `worker_threads`/`cluster` descartados para jobs I/O-bound; coordenação multi-instância futura via `GET_LOCK`/`UNIQUE` no MySQL (**sem Redis** — ADR-0030 deferido).
- Padrão canônico `src/jobs/<módulo>/<job>/run.ts` (one-shot, Clock port, `AsyncLocalStorage` p/ correlation-id).
- Ancorado em **Parnas** (responsabilidade isolada + falha rastreável), **Newman** (background fora do caminho crítico + idempotência) e doc do Node 24. Pesquisa: agente `nodejs-runtime-expert`.
- **Job piloto:** CTR-AUTO-EXPIRE (auto-expire de contratos, issue #39).

## 2026-06-16 — 🔒 Financeiro fatia 2: `version` (optimistic lock) exposto na borda `/api/v2/financial`

Feature `specs/010-fin-listagem-timeline/` (FR-009/ADR-0002 da feature). O token de optimistic lock (`version`) passa a
ser **devolvido em toda resposta de documento** (`POST`/`PATCH`/`approve`/`undo-approval`, `GET /:id`, e em cada item de
`GET /documents`), permitindo ao **frontend** participar do controle de concorrência.

- **Contrato de consumo (frontend):** [`specs/010-fin-listagem-timeline/frontend-optimistic-lock.md`](../specs/010-fin-listagem-timeline/frontend-optimistic-lock.md)
  — ler o `version` da resposta → reenviar no `PATCH`/`approve`/`undo-approval` → em `409 document-version-conflict`,
  re-buscar (`GET /:id`) e repetir. Mapa de status + exemplos de request/response.
- **Por quê (canônico):** Vernon, _Implementing DDD_ (`ddd--vernon-livro-vermelho.md:8869`) — a checagem compara a versão
  persistida com a "cópia do cliente"; logo a API deve entregar o `version` numa leitura. Análogo a `ETag`/`If-Match`.
- **Prova:** `version-roundtrip.http.test.ts` (CVR-001..008), `optimistic-lock.http.test.ts` (CT-018..021) e integração
  MySQL real (`UPDATE ... WHERE version=?` → `affectedRows=0` → conflito; Refman 8.4 §13.2.17).
- **Também nesta fatia:** trilha por-campo (Time Travel) `GET /:id/timeline`; listagem real `GET /documents` (filtros +
  paginação); remoção das permissões inertes `payable:read`/`payable:undo-approval` (menor privilégio).

## 2026-06-15 — 🎫 ADR-0040: achados de agente viram GitHub Issues testáveis

Novo [ADR-0040](./architecture/adr/0040-agent-findings-as-github-issues.md) (**Accepted**). Resolve a
desatualização crônica dos índices de `handbook/tickets/`: o backlog de achados passa a viver no **GitHub
Issues** (tracker primário), produzido pelo agente via a skill [`issue-report`](../.claude/skills/issue-report/SKILL.md)
com o template [`.github/ISSUE_TEMPLATE/agent-finding.md`](../.github/ISSUE_TEMPLATE/agent-finding.md) —
critérios de aceite testáveis (Dado/Quando/Então) + Definition of Done amarrada ao gate W3, dedup por `dedup-key`.

- Regra `AGENTS.md` §Anti-padrões **#15**: achado fora de escopo → issue, não scope-creep.
- Detecção sistemática de contrato (`oasdiff`), tracker git-backed (Beads) e broker em VPS ficam como **F-Plus** (adiados).
- Notificação no Discord pelo webhook nativo do GitHub. Validado: 8 issues criadas (#39–#46) dos tickets vigentes.

## 2026-06-10 — 🧹 CLI-RETIRE-EMBEDDED: CLI embutida removida (executa ADR-0037)

Execução da remoção faseada que o [ADR-0037](./architecture/adr/0037-http-first-retire-embedded-cli.md)
previu. A **CLI embutida** do core-api (`src/modules/{contracts,financial}/cli/`, scripts `cli:*`,
`tests/cli/` + `tests/modules/*/cli/`) foi **arrancada**. Domínio/application/persistência/HTTP intactos
(a CLI era adapter de entrada — ADR-0006).

- **Worker de outbox** (ADR-0015) extraído para entrypoint standalone `src/modules/contracts/worker/run.ts`
  (+ `worker/config.ts`, config por env `CONTRACTS_DATABASE_URL` + `OUTBOX_*`), **zero dependência de
  CLI**. Script `pnpm run worker:outbox`.
- **Docker**: `ENTRYPOINT` repontado da CLI para o **servidor HTTP** (`node src/server.ts`); `compose`
  serviço `app` sem o override de `command` (usa o entrypoint HTTP).
- **Import legado (ETL)**: comando CLI removido; use case `importContracts` permanece em application/
  para futura rota HTTP.
- Validação E2E segue por Bruno (ADR-0034) + `fastify.inject`. Skill `application-cli-builder` aposentada
  para o core-api. `.claude/rules/adapters.md` atualizado (driver por env, não mais por flag de CLI).

## 2026-06-09 — 🗂️ ADR-0039: estado terminal `Cancelled` do Contrato (5 estados)

Novo [ADR-0039](./architecture/adr/0039-contract-cancelled-state.md) (**Accepted**), **estende** o
[ADR-0023](./architecture/adr/0023-contract-lifecycle-pending-state.md) (não supersede). Motivado pelo
ticket CTR-HTTP-CANCEL-PENDING (ação "Excluir" do front): um contrato **Pendente** (rascunho não
vigorado) passa a ser **cancelável** via `DELETE /contracts/:id`; efetivados seguem imutáveis.

- 5º estado **`Cancelled`** (`Cancelado` na borda), terminal, alcançável só de `Pending`. Tipo refinado
  `CancelledContract` = `ContractRegistration` + `endedAt` (sem vigência efetiva). Transição
  `Contract.cancel` (parâmetro `PendingContract` garante a regra em compile time).
- Evento próprio **`ContractCancelled`** (não reusa `ContractEnded`) — timeline/auditoria corretos.
- `DELETE /contracts/:id`: Pending → 200; não-Pending → 409 `contract-not-pending`; inexistente → 404.
  Soft-delete (transição de estado) — exclusão física segue proibida.
- CHECKs do schema revisados (`status`, `ended_at`, `pending_consistency` incluem `Cancelled`).

## 2026-06-08 — 🧪 ADR-0038: Coleções Bruno obrigatoriamente executadas via CLI

Novo [ADR-0038](./architecture/adr/0038-bruno-cli-mandatory-and-bru-authoring.md) (**Accepted**). Motivado
pela spec 007: ao rodar o runner único pela 1ª vez, **24 de 26 falhas eram `.bru` que nunca tinham sido
executados via Bruno CLI** (ex.: `api-collections/contracts` sem runner — body desalinhado do schema real).

- **Todo `.bru` criado/alterado DEVE ser executado** via `bru run` contra o server real e passar (ou
  reprovar conscientemente como expected-fail isolado). Escrever sem rodar = cobertura ilusória, proibido.
- **Diretrizes de autoria normativas**: sem `#` no topo (parser); body alinhado ao schema Zod
  (`discriminatedUnion` exige discriminador); dados válidos (CPF/CNPJ módulo 11, UUID v4); login
  compartilhado; asserções tolerantes ao código real com invariante "nunca 500"; expected-fail isolado.
- Regra path-scoped: `.claude/rules/api-collections.md` (carrega ao tocar `api-collections/`).

## 2026-06-07 — 🌐 ADR-0037: HTTP-first; aposentadoria da CLI embutida

Novo [ADR-0037](./architecture/adr/0037-http-first-retire-embedded-cli.md) (**Accepted**) formaliza a
inversão de prioridade **CLI → HTTP** já consumada pelos ADRs 0025/0027/0028/0032/0033/0034:

- **HTTP/HTTPS é a UX primária** do core-api (`/api/v1`, Fastify + Zod/OpenAPI). **Supersede parcial** do
  **Princípio VII** da constituição ("CLI-first; HTTP é Fase 2+"), reescrito para **"HTTP-first"**
  (constituição bumpada **1.1.0 → 1.2.0**).
- **CLI embutida no core-api aposentada**: sem novos subcomandos `cli:*`; remoção faseada de
  `src/modules/*/cli/`. A skill `application-cli-builder` deixa de ser caminho para features do core-api;
  o agente `fastify-server-expert` deixa de ser "reservado".
- **Validação de regras de negócio** migra da CLI para **testes de integração REAIS via HTTP** — coleções
  **Bruno** (ADR-0034) + `fastify.inject`. Fidelidade de produção (autorização, contratos, versionamento).
- **CLI do domínio** migra para o pacote irmão **`cli/`** (binário `bc`, Bun) — aplicação à parte que
  integra IAs e consome a borda HTTP como cliente (já sinalizado no `AGENTS.md` raiz do mono_repo).
- **Citação canônica** (Princípio IX): Roy T. Fielding, *Architectural Styles…* (REST), p. 96.
- **Impacto nas specs em voo** (`005-gestao-usuarios`, `006-gestao-acessos`): o item "paridade CLI" sai das
  user stories; entrega passa a ser via HTTP + Bruno. Domínio/agregados/migrations **inalterados**.

---

## 2026-06-06 — 🔎 Épico `003-partners-aggregator-export` — agregador `/partners` + paridade de export CSV (`/api/v1`)

Épico [`specs/003-partners-aggregator-export/`](../specs/003-partners-aggregator-export/), originado dos
**ITENs 3 e 4** do retorno do front (gaps restantes de `partners` `/api/v1`, fora do escopo da spec `001`).
Entregue via pipeline `core-api-sdd` (2 tickets W0→W3 closed-green). **Sem schema/migration** — leitura e
serialização na borda; cross-BC inexistente (só o módulo `partners`).

**Novas capacidades na borda `/api/v1` de parceiros:**

- **`GET /api/v1/partners`** (novo, ITEM 3) — **agregador de busca** dos 4 tipos (supplier/financier/collaborator/act) numa projeção plana paginada `{ items: [{ type, id, name, document, active }], meta: { itemCount, totalItems, itemsPerPage, totalPages, currentPage } }`. Substitui o fan-out de 4 GETs no front (alimenta o seletor de contratado da feature 002). Query `search` (casa name/document), `type` (filtra um dos 4), `page`/`limit`. Composição **read-side na borda** lendo os 4 readers (CQRS — Vernon p.193; não cria tabela, não expõe o agregado interno — ADR-0014). Ordenação `(name, type, id)`; **safety cap** `MAX_TOTAL=10_000` → `503` (`partners-aggregate-too-large`). Autorização = **AND das 4 permissões de leitura** (`supplier:read` + `financier:read` + `collaborator:read` + `act:read`) via preHandlers encadeados.
- **`GET /api/v1/collaborators/export`**, **`/financiers/export`**, **`/acts/export`** (novos, ITEM 4) — **paridade de export CSV** com `/suppliers/export` (que já existia). Serializers `financier-csv`/`act-csv` espelham `supplier-csv` (`act` = placeholder enxuto, ADR-0036); `collaborators` reusa o serializer existente. Respeitam os filtros da listagem do tipo; headers `text/csv; charset=utf-8` + `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`; escape anti-CSV-injection + RFC 4180 via util compartilhado `shared/utils/csv.ts`; RBAC `<tipo>:read`.

Fecha gaps da família partners `/api/v1` do `web-app/specs/008-partners/api-readiness-report.md` (mesmo report que originou a spec `001`; correspondem aos ITENs 3 e 4 do ticket do front). OpenAPI gerado do Zod (`fastify-zod-openapi`, ADR-0027) reflete os novos shapes automaticamente.

---

## 2026-06-06 — 🔗 Épico `002-contracts-http-gaps` — vínculo de contratado + PATCH de metadados (`/api/v2`)

Épico [`specs/002-contracts-http-gaps/`](../specs/002-contracts-http-gaps/) (PR #18 → `dev`), originado do
[`po-feedback/0001`](./po-feedback/0001-gap-api-v2-contracts.md) + [ADR-0032](./architecture/adr/0032-transient-http-composition-read-until-bff.md).
Fecha os ITENs 1 e 2 do retorno do front (Bucket B/D). Entregue via pipeline `core-api-sdd` (5 tickets W0→W3).

**Mudanças na borda `/api/v2` de contratos:**

- **`POST /api/v2/contracts`** — passa a exigir `contractor: { type, id }` (`type ∈ supplier|financier|collaborator|act`, `id` UUID). **⚠️ Breaking** para clientes que criavam contrato sem contratado. Body sem `contractor` → `400`.
- **`GET /api/v2/contracts/:id`** — o detalhe ganha o bloco `contractor: { type, id, snapshot | null }` composto na borda via public-api de Parceiros (rota gorda **transitória**, ADR-0032). Resposta declara `Deprecation: true` + `Sunset` (RFC 8594) — sai quando o BFF v2 assumir. `snapshot` traz `name`/`document`/`updatedAt` (+ `bankAccount`/`pixKey` só para supplier); `null` em degradação graciosa (contratado ausente/IO/timeout — resposta idêntica, anti-oráculo). O detalhe também expõe `observations`/`email`/`telephone`.
- **`PATCH /api/v2/contracts/:id`** (novo) — edita **só** metadados de cadastro (`title?`, `objective?`, `observations?`, `email?`, `telephone?`). Body `.strict()`: campo imutável (`originalValue`, período, datas, `sequentialNumber`) ou chave desconhecida → `400`; corpo vazio `{}` → `400`. Contrato inexistente → `404` (RBAC puro — `contracts` não tem ownership por tenant). Valor/período seguem mutáveis **só por aditivo homologado**.
- **`DELETE /api/v2/contracts/:id`** (novo) — **recusado** com `405` (`code: contract-delete-forbidden`), imutabilidade (princípio #14). `requireAuth` precede a política.

**Domínio/persistência:** agregado `Contract` ganhou `contractor` (referência leve por identidade — Vernon/ADR-0032) + metadados; `ctr_contracts` ganhou 5 colunas (migration `0007`, `contractor_*` NOT NULL + CHECK, `contractor_id` `COLLATE utf8mb4_bin`). Núcleo permanece sem conhecer Parceiros (cross-BC só via public-api — ADR-0006/0014). Paridade 4/4 do `ContractorReadPort` (`ActView`). OpenAPI é gerado do Zod (`fastify-zod-openapi`, ADR-0027) — reflete automaticamente os novos shapes.

---

## 2026-06-06 — 🌎 ADR-0035 — parceria territorial (estados/municípios) com soft-delete (resolve D9 do ADR-0031)

Épico `specs/001-partners-http-gaps/` (gaps de borda HTTP do módulo `partners`, originado do
`api-readiness-report.md` do frontend). Novo [ADR-0035](./architecture/adr/0035-partner-territory-soft-delete.md)
**fecha a questão aberta D9** do ADR-0031: `PartnerState`/`PartnerMunicipality` são **Entity persistida com
soft-delete** (`active` + `deactivated_at` + CHECK), espelhando o padrão dos demais `par_*` — não hard delete.
Promove o ADR de feature `specs/001-partners-http-gaps/adr/0001`. O épico também entregou (via pipeline
`core-api-sdd`, 6 tickets W0→W3): import de colaboradores (`POST /collaborators/import`, text/csv), export de
fornecedores (`GET /suppliers/export`), catálogo de categorias (`GET /suppliers/service-categories`, resolve
FR-017 com 39 categorias canônicas), parceria territorial (`/partner-states`, `/partner-municipalities`) e o
descarte formal dos filtros `programa`/`idade` (FR-012). `parseCsv`/`tokenizeCsv` promovidos a
`shared/utils/csv.ts` (ADR-0002 da feature: CSV é borda, não porta genérica). Suite: 2144 testes verdes.

## 2026-06-04 — ✏️ EPIC-PARTNERS-HTTP-EDIT — edição (PUT) completa: Supplier + Collaborator (épico fechado)

Replica o piloto Financier para os outros dois counterparties, fechando o épico de edição.
`PUT /api/v1/suppliers/:id` e `PUT /api/v1/collaborators/:id` (substituição total, fiel ao legado).
Vital por recurso: Supplier=`cnpj`, Collaborator=`cpf` — alterar exige `<recurso>:edit-sensitive`
(síncrono) → 403 sem ela. Operações de domínio novas (`Supplier.edit`, `Collaborator.edit` — esta
preserva campos pessoais + estado via spread; PUT cobre só os cadastrais, pessoais via
complete-registration) + eventos `SupplierEdited`/`CollaboratorEdited`. Use cases `editSupplier`/
`editCollaborator` com a regra do vital + re-checagem de unicidade (cnpj/cpf; email do colaborador é
não-vital mas único → 409). Reusa `makeHasPermission` (auth). Os três cadastros de partners agora têm
CRUD + edição. Suite: 2079 testes verdes.

## 2026-06-04 — ✏️ EPIC-PARTNERS-HTTP-EDIT — edição cadastral (PUT) com RBAC elevado (piloto Financier)

Estreia a **edição cadastral** na borda `/api/v1` e o **RBAC condicional para campos vitais**.
`PUT /api/v1/financiers/:id` (substituição total, fiel ao legado `UpdateFinancier`): quem tem
`financier:write` edita campos não-vitais; mudar o **CNPJ** (vital) exige `financier:edit-sensitive`
(síncrono) — senão **403**. Modela a 1ª operação de edição de domínio (`Financier.edit` + evento
`FinancierEdited`); a regra do vital vive no use case `editFinancier` (`canEditSensitive` + re-checagem de
unicidade). **Novo no módulo auth (reusável):** `makeHasPermission(userReader)` — checagem **consultável**
de permissão (boolean, nega por padrão), exposta via `auth/public-api/http.ts`, para autorização condicional
dentro do handler. Piloto; replicar para Supplier (vital=cnpj) e Collaborator (vital=cpf). Suite: 2065 testes verdes.

## 2026-06-04 — 🏦 EPIC-FINANCIERS-HTTP-V1 — CRUD de Financiadores no `/api/v1` (fatia única)

Borda HTTP de Financiadores sob `/api/v1/financiers` (módulo `partners`), espelhando o legado
(`handbook/legacy_docs/openapi.yaml:443`) e reaproveitando toda a infra dos épicos anteriores. Recurso
mais simples (PJ/CNPJ, 6 campos: name/corporateName/legalRepresentative/cnpj/telephone/address; sem
payment-target/categoria/email). Fatia única (decisão do dono): `GET /financiers` (paginado + filtros
search/active), `GET /:id`, `POST` (201+Location), `POST /:id/deactivate` (sem body) + `/reactivate`.
Permissões `financier:read`/`financier:write`. `FinancierReader` + `financierMatchesFilter` + plugin.
Pendentes: edição (`PUT` — gap de domínio `Financier.edit`) e extras (`/options`,`/nameOrCNPJ`). Suite: 2056 testes verdes.

## 2026-06-04 — 🏭 EPIC-SUPPLIERS-HTTP-V1 — CRUD de Fornecedores no `/api/v1` (3 fatias closed-green)

Borda HTTP de Fornecedores sob `/api/v1/suppliers` (módulo `partners`), espelhando o legado
(`handbook/legacy_docs/openapi.yaml:545`) e reaproveitando toda a infra do EPIC-COLLABORATORS-HTTP-V1
(buildApp prefixo por plugin, composition partners RW split, read-model enriquecido): **S1** reads
(`SupplierReader`, `GET /suppliers` paginado + filtros search/active/categories, `GET /:id`); **S2**
cadastro (`POST` 201+Location, invariante de payment target → 422); **S3** lifecycle (`POST`
deactivate/reactivate, sem `disableBy`). Permissões `supplier:read`/`supplier:write`. Design em
`.claude/.planning/EPIC-SUPPLIERS-HTTP-V1.md`. Pendentes: S-EDIT (`PUT` — exige `Supplier.edit`, gap de
domínio) e extras (`/options`,`/csv`,`/nameOrCNPJ`). Suite: 2048 testes verdes.

## 2026-06-03 — 🔢 ADR-0033 (versionamento de API: `/api/v1` espelha o legado) + EPIC-COLLABORATORS-HTTP-V1

> Borda HTTP de Colaboradores. Design do épico em `.claude/.planning/EPIC-COLLABORATORS-HTTP-V1.md`.

### EPIC-COLLABORATORS-HTTP-V1 — CRUD de Colaboradores no `/api/v1` (6 fatias closed-green)

Borda HTTP completa de Colaboradores sob `/api/v1` (módulo `partners`), espelhando o contrato legado
(`handbook/legacy_docs/openapi.yaml`): **P0** bootstrap do plugin v1 + lista; **P1a** detalhe enriquecido
(read-model com `legacyId`/timestamps); **P1b** lista paginada (`PaginatedCollaborators`) + 5 filtros;
**P1c** +6 filtros (paridade, `age` adiado); **P2** `POST` cadastro (201+Location) + `PATCH`
complete-registration (autenticado); **P3** `POST` deactivate/reactivate (dois endpoints). Pendentes:
**P4-EDIT** (edição cadastral — exige operação de domínio nova + RBAC elevado p/ campos vitais) e
**P4-SMOKE** (E2E opcional). Suite: 2027 testes verdes.

### ADR-0033 — Versionamento de API HTTP (v1 = espelho do legado, v2 = modelo novo)

Convenção de versionamento por **recurso/módulo**: recursos que **espelham o legado** (Strangler Fig,
ADR-0001) entram em **`/api/v1`** com contrato herdado e **congelado**; recursos **greenfield** (`auth`,
`contracts`) seguem em **`/api/v2`**. O `buildApp()` (`src/shared/http/app.ts`) deixa de hardcodar o
prefixo: `routes` passa a `ReadonlyArray<{ plugin, prefix? }>` (default `/api/v2`, retrocompatível). Não
superseda ADR-0025/0027/0028 — os cumpre. Estreia com **Colaboradores** (módulo `partners`, ADR-0031).

---

## 2026-06-02 — 📨 Feedback da P.O. (nova seção) + ADR-0032 (composição transitória na borda)

> Branch `docs/po-feedback`.

### Nova seção `handbook/po-feedback/`

Registro dos retornos da P.O./Arquitetura Frontend v2 sobre divergências de API/comportamento (README-índice + 1 arquivo por retorno; status acompanha a resolução). Primeira entrada **`0001`** = relatório de gap _API v2 Contracts vs. v1_ na íntegra + **triagem** cruzando cada item com o código real: **7 itens já atendidos**, **5 gaps de borda HTTP** (viram tickets), **~8 divergências de modelo** (decisão arquitetural).

### ADR-0032 — Composição de leitura transitória no adapter HTTP

Decisão que originou da triagem do `0001`: a visão rica que o frontend pede é **composta no adapter HTTP** (rota gorda **transitória** com header `Sunset`, RFC 8594) até o **BFF v2** assumir. **Domínio e use cases intocados** (núcleo DDD-puro); cross-módulo (contratado/bancário de Parceiros) **só via public-api** (ADR-0006/0014), nunca SELECT em `par_*`. Atributos **próprios** do contrato (`classification`, `contractModel`, `contractType`, `categorizacao`, `centroDeCusto`, `observations`) **entram no agregado quando necessário** (modelagem legítima, não corrupção). Cria a necessidade de um _read_ na public-api de Parceiros (hoje só write/ETL).

---

## 2026-06-02 — 🔁 ETL Parceiros (PARTNERS-ETL-BOOTSTRAP) — CORE + READER (em andamento)

> Branch `feat/partners-etl-bootstrap` (commits locais). Handoff completo em `.claude/.pipeline/PARTNERS-ETL-BOOTSTRAP/HANDOFF.md`.

### Migração one-shot legado → core-api (módulo `partners`)

ETL fatiado em 5 slices, cada um W0→W3. Pré-requisitos P2 (`legacy_id`) + P3 (`CONTRACT_PERMISSION`) já em `dev` (PR #5). Decisões do dono D9–D13 no `000-request.md` (reset P4a/P4b separados; inativos com backfill; `collaborator_history` em cold storage; quarentena dupla sem PII; overflow→quarentena).

- **Decisão de domínio:** `LEGACY_MIGRATION` adicionado ao enum `DisableReason` (marcador de proveniência de ETL, não motivo de RH) — para satisfazer `InactiveCollaborator.disableBy` não-null sem fabricar causa nem perder registro.
- **`PARTNERS-ETL-CORE`** (closed-green) — camada pura em `scripts/etl/`: `QuarantineReason` (+ `toSummary` PII-free), reconciliação (invariante de balanço), e os **4 mappers** row-legada→domínio (`parse → combine → rehydrate`, backfill D10, overflow→quarentena D13). Fixtures sintéticos.
- **`PARTNERS-ETL-READER`** (closed-green) — `decode.ts` (`password` nunca lido), `compose.etl.yaml` (MySQL 8.4 efêmero `tmpfs`/localhost-only), `restore.ts` (spawn docker + teardown garantido), `reader.ts` (mysql2 SELECT-only). **Integração verificada end-to-end com Docker** contra dump sintético; `collaborator_history` em cold storage (D11).
- **Próximo:** `PARTNERS-ETL-WRITER` → P4a/P4b.

## 2026-06-02 — 🔚 Rota HTTP de encerrar contrato + gate da suite mysql-compose

### Borda HTTP (contracts)

- **`POST /api/v2/contracts/:id/end`** (ticket `CONTRACTS-HTTP-END`, W0→W3 verde) — encerra contrato via use case `endContract` (writer pool, ADR-0026), body `{ kind: 'Expire' | 'Terminate' }`, protegido por `requireAuth` + `authorize('contract:write')`. Mapeamento de erro reusa a infra existente do plugin (`ContractNotActive`→409, `contract-not-found`→404, `ContractCannotExpireYet`/`...IndefinitePeriod`→422, repo→503). Documentado em `docs/02-http-api.md` §4.

### Infra / testes

- **Suite `tests/infra/mysql-compose.test.ts` gateada por opt-in** (ticket `mysql-compose skip-guard`) — bootstrap exige `COMPOSE_INTEGRATION=1` (mesma convenção de `MYSQL_INTEGRATION`/`STORAGE_INTEGRATION`); sem o opt-in fica `skipped`, nunca `failed`, mesmo com o daemon vivo e a 3306 do stack de dev ocupada. Novo script `pnpm run test:integration:infra` aplica o override `compose.ci.yaml` (`ports: !reset null`) e usa `docker exec`, coexistindo com o stack de dev. Documentado em `docs/04-dev-guide.md` §6.

### Manutenção

- **Política de regressão zero** formalizada no `CLAUDE.md` raiz (anti-padrão #14 + seção dedicada) e espelhada no output-style `erp-contracts`: nenhum vermelho é "erro alheio/ambiental"; conserta-se a causa OU o gate mal-classificado (com prova de verde), nunca se fecha com falha não-endereçada.
- **Ticket `PARTNERS-ETL-BOOTSTRAP` aberto** (L, ETL one-shot legado→core-api, épico Parceiros/Cadastros §4) com 5 pré-requisitos mapeados; `CTR-CLI-ACTIVAR-CONTRATO` marcado `superseded` por `CONTRACTS-HTTP-WRITES-CORE`.

## 2026-06-01 — 🤝 Módulo `partners` (ADR-0031) + BC Parceiros/Cadastros

### Decisões (ADR)

- **ADR-0031 aceito** — cria o módulo **`partners`** no core-api (prefixo `par_*`), primeira das 4 fronteiras do legacy API a migrar (`suppliers`/`financiers`/`collaborators` + `collaborator_history` + geografias). Três agregados internos (supplier, financier, collaborator); `collaborator` fundido por YAGNI; geografias como lookup; perfil de usuário como agregado separado referenciando `auth.User`; VOs `Cpf`/`Cnpj`/`Email` promovidos ao shared-kernel; enums legados → unions EN com exceções (race/gender/serviceCategory/occupationArea). Precedido de sessão de design multi-agente read-only (5 especialistas).

### Domínio

- **BC Parceiros/Cadastros documentado** — novo `handbook/domain/11-parceiros-cadastros-context.md` (responsabilidades, agregados, relacionamentos cross-BC, linguagem ubíqua). `02-context-map.md` atualizado com a fronteira e o relacionamento Títulos/Contratos → Parceiros (ID + snapshot).

### Planejamento

- **Design consolidado** em `.claude/.planning/EPIC-PARTNERS-CADASTROS.md` — convergências, 9 decisões (4 fechadas pela banca, 5 P.O./ETL pendentes) e fatiamento em ~13 tickets W0→W3.

### Manutenção

- Índice de ADRs (`adr/README.md`) atualizado — incluídas as entradas **0029**, **0030** e **0031** (estava parado em 0028).

## 2026-05-30 — 🔐 Hardening de auth (spec 003) + ADR-0030 (store compartilhado adiado)

### Decisões (ADR)

- **ADR-0030 proposto** — store compartilhado (**Valkey** via `ioredis`) para rate-limit/cache **adiado** enquanto o core-api for single-instance (YAGNI); direção fixada para quando escalar horizontalmente. Discussão em `.claude/.planning/REDIS-RATE-LIMIT-STORE.md`.

### Segurança (módulo auth — spec 003)

- **BE-REC-001..005 entregues** (tickets `CTR-AUTH-*`): blocklist de senhas, dummy-hash anti-timing, rotas change-password/revoke-all, rate-limit dedicado de login/refresh, account lockout progressivo (persistido em MySQL), e cadeia completa de reset de senha (token → persistência → request via EmailPort/Nodemailer → confirm). Detalhe no épico `EPIC-AUTH-SECURITY-HARDENING`.

## 2026-05-30 — 📦 pnpm 11.x com defaults de supply-chain (ADR-0029 supersedes ADR-0012)

### Decisões (ADR)

- **ADR-0029 aceito** — adota **`pnpm 11.x`** (pinado em `pnpm@11.5.0`) como package manager único, **supersedes ADR-0012** (que fixava `10.x`). A escolha pnpm-vs-Bun-vs-npm **não** é reaberta — muda só a major.
- **Motivação:** o pnpm 11 torna _default_ proteções de supply-chain exigidas pelo ADR-0011 — `minimumReleaseAge: 1440` (default desde v11), `minimumReleaseAgeStrict`, `trustPolicy: no-downgrade`, `blockExoticSubdeps`. Fundamentado em `handbook/reference/pnpm/{supply-chain-security,settings}.md` com citação literal.
- **ADR-0012 marcado como Superseded** — a parte "por que pnpm" segue válida; as `Configurações padrão` (`pnpm@10`, `engines >=10`) ficam desatualizadas, apontando para o ADR-0029.

### Migração (config)

- `package.json`: `packageManager` → `pnpm@11.5.0`; `engines.pnpm` → `>=11.0.0 <12`.
- `Dockerfile`: `ENV PNPM_VERSION=11.5.0`.
- `pnpm-workspace.yaml`: settings de supply-chain explicitadas; lockfile re-gerado com pnpm 11 (lockfileVersion `9.0` mantido).

## 2026-05-28 — 🛡️ Especialistas de segurança web (backend + frontend) — agentes + skills

### Tooling (.claude/)

- **2 agentes + 2 skills** de segurança web JS/TS, mirados no **stack real do projeto** (não genéricos):
  - **Backend:** `security-backend-expert` (agente) + `web-security-backend` (skill) — Node.js 24 · TS 6 · Fastify 5 · pnpm/supply-chain · Magalu Cloud (S3-compat). Ancorado em `handbook/reference/{nodejs,typescript,fastify,pnpm,magalu-cloud}` + ADRs 0005/0025 (TLS no BFF), 0011/0012, 0024, 0019/0021, 0020/0027.
  - **Frontend:** `security-frontend-expert` (agente) + `web-security-frontend` (skill) — TanStack Start (React) + TS. Ancorado na doc oficial do TanStack Start (server functions = RPC, CSRF, env inlining) + reference React do openai/skills.
- **Base:** openai/skills `.curated/{security-best-practices, security-threat-model, security-ownership-map}` (adaptados, não copiados) + `handbook/reference/skills-base/security/owasp-ai-exchange.md`.
- Cada skill tem `references/*.md` normativas (MUST/SHOULD + regras de auditoria `BE-NNN`/`FE-NNN`/`SC-NNN`/`CL-NNN`) e roda em 3 modos (generation / passive review / active audit). Distintos da skill `security-reviewer` (OWASP-AI/LLM). Registrados nas tabelas de roteamento do `CLAUDE.md`.
- **Postura ajustada aos ADRs:** TLS termina no BFF (ADR-0005/0025) ⇒ não reportar "falta de HTTPS" no core-api; secret nunca no browser (ADR-0005); IDs opacos UUID; Zod só na borda (ADR-0027).

---

## 2026-05-28 — 🧭 ADR-0028 (localização do shell HTTP + verticalidade por feature)

### Decisão

- **[ADR-0028](./architecture/adr/0028-http-edge-shell-location.md)** — fixa onde vive a borda HTTP do core-api: **shell transversal** (`buildApp`, error envelope, `sendResult`, config) em `src/shared/http/`; **composition root** (entrypoint + `listen` + graceful shutdown) em `src/server.ts` (raiz); **HTTP de cada feature** (plugin, rotas, schemas Zod) em `src/modules/<m>/adapters/http/`, exposto via `<m>/public-api/http.ts`. **Cumpre** o ADR-0006:53-63 (`shared/` + `server.ts`) e o ADR-0025:37 (composition root único) — não superseda nenhum. Motivação: o H0 entregou o shell em `src/http/` (topo), que aparentava "camada HTTP horizontal" em tensão com a organização vertical-por-feature (Modular Monolith).

### Consequência operacional

- Ticket de refactor `CORE-HTTP-SHELL-RELOCATE` move `src/http/` → `src/shared/http/` + `src/server.ts`, reescreve imports `#src/http/*` → `#src/shared/http/*`, move `tests/http/` → `tests/shared/http/` e estende o glob ESLint para `src/shared/http/**` + `src/modules/*/adapters/http/**`. Sem mudança de comportamento (testes do H0 cobrem). `EPIC-HTTP-CORE-API.md` atualizado com os novos paths.

---

## 2026-05-27 — 📐 ADR-0027 (Zod contract-first) + planejamento do épico HTTP (spec-driven)

### Decisão

- **[ADR-0027](./architecture/adr/0027-zod-openapi-contract-first-http-edge.md)** — Zod v4 + `zod-openapi` + `fastify-zod-openapi` como **contract-first da borda HTTP**: um schema Zod por rota valida I/O e **gera o OpenAPI 3.1.1**. Invariante: Zod só em `adapters/http/`; smart constructors mantêm a regra de negócio (ADR-0006/0025:30). O `openapi.yaml` legado (3.0.3) deixa de ser contrato vivo e vira ACL/referência de migração.

### Planejamento (sem código de produção)

- **Método spec-driven nativo** adotado — **sem** instalar o spec-kit oficial (conflito com ADR-0011 supply-chain + ADR-0012 Node/pnpm puro; exigiria Python/uv e duplicaria o W0→W3). Template `.claude/templates/spec.md` + runbook `.claude/runbooks/spec-driven-pipeline.md`; artefato `001-spec/SPEC.md` como gate pré-W0.
- **Épico `EPIC-HTTP-CORE-API`** especificado (`.claude/.planning/EPIC-HTTP-CORE-API.md`): borda HTTP de auth (primeiro) + contracts; TLS termina no BFF (ADR-0005); fatiado em H0 (bootstrap Fastify) → H1/H2 (rotas+authz auth) → I1 (RW split, ADR-0026), contracts em spec-filha. Recursos (agente·skill·docs) mapeados por etapa. Aguarda aprovação para abrir o H0.
- **Tickets fechados** `closed-green`: `AUTH-DB-REPO-SESSION` (W2/W3 reconciliados) e `AUTH-TEST-INTEGRATION-SCRIPT` (runner `pnpm run test:integration:auth` — fecha o gap de integração auth fora do gate padrão).

---

## 2026-05-27 — ✅ CHECKPOINT: módulo `auth` — domínio + repos + login híbrido (14 tickets, todos ALL-GREEN)

### Resumo da sessão

Sessão longa que partiu da análise do `api_documentations/doc.yaml` (contrato REST do legado NestJS),
desenhou o **módulo de autenticação** do core-api do zero e o levou até o **login funcional com sessão
híbrida**. **14 tickets** `auth` fechados (todos `closed-green`, **W2 round 1 — zero rejeições**), +3 ADRs
aceitos, 2 dependências auditadas, **21 commits**. Suíte: **1370 testes** (1354 pass / 0 fail / 16 skip),
partindo de ~1266 no início da sessão (**+104 testes**). `src/modules/auth`: **31** arquivos; testes: **28**.

### ADRs aceitos (0024–0026)

- **[ADR-0024](./architecture/adr/0024-identity-and-rbac-auth-module.md)** — Identidade & RBAC (módulo `auth`): identidade própria OIDC-ready, sessão híbrida (JWT curto + refresh stateful), permissions granulares. Cumpre o pré-requisito de identidade do [ADR-0022](./architecture/adr/0022-read-models-via-projection-over-event-stream.md).
- **[ADR-0025](./architecture/adr/0025-http-server-fastify-core-api.md)** — Servidor HTTP no core-api com Fastify (adapter de borda; BFF segue burro, ADR-0005 não superseded). **Reservado→ativável.**
- **[ADR-0026](./architecture/adr/0026-mysql-read-write-split-connection.md)** — Read/Write split de conexão (writer/reader, Master-Slave ready), transversal.

### Entregue (código — 14 tickets `closed-green`)

| Fase                 | Tickets                                                                                                                                                               |
| :------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D — domínio**      | `AUTH-VO-EMAIL`, `AUTH-VO-PERMISSION`, `AUTH-VO-PASSWORD` (Password+PasswordHash), `AUTH-AGG-ROLE`, `AUTH-AGG-USER` (+`authorize`), `AUTH-AGG-SESSION` (RefreshToken) |
| **A — repos**        | `AUTH-REPO-USER` (write/read split), `AUTH-REPO-ROLE`, `AUTH-REPO-SESSION` — port no domínio + contract-suite + InMemory                                              |
| **A — use cases**    | `AUTH-USECASE-REGISTER-USER`, `AUTH-USECASE-AUTHENTICATE` (access), `AUTH-USECASE-AUTHENTICATE-REFRESH` (refresh)                                                     |
| **X — cripto/token** | `AUTH-ADAPTER-ARGON2-HASHER` (argon2id), `AUTH-ADAPTER-JWT-ISSUER` (ES256), `RefreshTokenMinter`                                                                      |

**Fluxo funcional:** `registerUser` (argon2id, sem persistir senha em claro) + `authenticateUser`
(credencial → access JWT ES256 + refresh opaco persistido). Tudo com adapter `InMemory`/fake; MySQL e
HTTP em fases futuras.

### Dependências adicionadas (auditadas)

- **`hash-wasm@4.12.0`** (argon2id, WASM puro, zero dep nativa). **Auditado o issue [#69](https://github.com/Daninet/hash-wasm/issues/69)** (leak): afeta a API de instância, **não** a one-shot `argon2id()` — probe de 60 hashes confirmou RSS estável.
- **`jose@6.2.3`** (JWT ES256, zero dep, Web Crypto). Recusados: impl própria de cripto, HS256, `@node-rs/argon2` (binário nativo), `jsonwebtoken`.

### Decisões de design (log vivo)

[`domain/auth/design-decisions.md`](./domain/auth/design-decisions.md) — **mutável, consultar/criticar antes de cada ticket `auth`**. 14 decisões: `DD-USER-01..05`, `DD-SESSION-01..03`, `DD-PORTS-01`, `DD-CRYPTO-01`, `DD-TOKEN-01`, `DD-LOGIN-01..02`. Destaques: `User` como state machine refinada (`ActiveUser|DisabledUser`); `authorize` fail-closed fora do agregado; `RefreshToken` com estado **computado** (`state(token,now)`); argon2id via hash-wasm; access JWT ES256 (core assina/BFF valida); login anti-enumeration.

### Notas propagadas (fases futuras — em `design-decisions.md`)

- **EventBus/outbox do auth:** use cases retornam o evento mas não publicam (destrava AuditLog do ADR-0022 quando o transporte existir).
- **Fase P (MySQL):** `auth_user.email` UNIQUE INDEX; `rehydrate(row)` dispatcher por `status`.
- **Sessão (A6/A7):** `disable`/`changePassword` devem invalidar sessões; lockout fora do `User`.
- **Hardening HTTP:** timing-oracle no login (hash dummy quando user não existe).

### Pendente (próximos)

- **A6** `refreshAccessToken` (rotação), **A7** `revokeSession`, **A8** `changePassword`, **A9** `assignRole`.
- **Fase P** (schema/repos Drizzle MySQL `auth_*`), **Fase H** (borda Fastify — ativa ADR-0025), **I1** (RW split pools).

### Métricas

`pnpm run pipeline:metrics --write` → [`.claude/.pipeline/_METRICS.md`](../.claude/.pipeline/_METRICS.md). Os 14 tickets `auth` fecharam em **W2 round 1** (zero rejeições de review).

---

## 2026-05-27 — Módulo `auth`: ADRs aceitos + Fase D entregue + log vivo de decisões de design

### Contexto

Sequência da decisão de criar o módulo de autenticação. Os ADRs 0024/0025/0026 foram **aceitos** (de
`Proposed`), a Fase D (VOs + 1º agregado) entrou via pipeline W0→W3, e as decisões de design de domínio
passaram a ser registradas num **log vivo** (a pedido: "para sempre consultadas, criticadas e melhoradas").

### Adicionado

- **[`domain/auth/design-decisions.md`](./domain/auth/design-decisions.md)** — log **vivo** (mutável, ≠ ADR)
  de decisões de design do módulo `auth`. Inaugurado com `DD-USER-01..05` (agregado `User`), destiladas de
  um **painel de 6 skills** (ts-domain-modeler, ports-and-adapters, clean-code-reviewer, tdd-strategist,
  requirements-engineer, security-reviewer). Registra votos, objeções da minoria e gatilho de revisão por decisão.

### Entregue (código — tickets closed-green, Fase D do módulo `auth`)

- `AUTH-VO-EMAIL`, `AUTH-VO-PERMISSION`, `AUTH-VO-PASSWORD` (Password + PasswordHash), `AUTH-AGG-ROLE`.
  Domínio puro; hashing fica no port `PasswordHasher` (X1). **D5 `AUTH-AGG-USER`** em andamento.

### Atualizado

- ADRs **0024/0025/0026** `Proposed → Accepted` (índice de ADRs atualizado). A entrada abaixo descreve o conteúdo dos três.

---

## 2026-05-27 — Série de ADRs do módulo `auth` + HTTP + read/write split (ADR-0024/0025/0026)

### Contexto

Discussão de design para um **módulo de autenticação**. A análise da `api_documentations/doc.yaml` (contrato REST do
legado NestJS) e a decisão da liderança técnica — **HTTP entra, CLI sai para este módulo, MySQL com isolamento que
permita Master-Slave ao escalar, sob infra reduzida** — geraram três decisões encadeadas. O [ADR-0022](./architecture/adr/0022-read-models-via-projection-over-event-stream.md)
já registrava identidade/RBAC como pré-requisito disparado (`:44`, `:72`), de modo que o ADR-0024 cumpre uma
pendência pré-existente, não uma invenção nova.

### Adicionado (ADRs — `Status: Proposed`, aguardam aprovação)

- **[ADR-0024](./architecture/adr/0024-identity-and-rbac-auth-module.md)** — Identidade & RBAC, módulo `auth`.
  Identidade **própria OIDC-ready** (port `Authenticator` abstrai a fonte; `password_hash` nullable); **sessão híbrida**
  (access token JWT curto validado stateless pelo BFF + refresh token stateful rotacionável/revogável em `auth_refresh_token`);
  **permissions granulares** (`Permission` branded `resource:action`, authorization service puro). core-api emite,
  BFF valida (ADR-0005). Destrava o AuditLog diferido no ADR-0022. Tabelas `auth_*` no database `core` (ADR-0014/0020).
- **[ADR-0025](./architecture/adr/0025-http-server-fastify-core-api.md)** — Servidor HTTP no core-api com **Fastify**
  como adapter de borda (ativa o agente `fastify-server-expert`). Domínio/application permanecem sem framework (ADR-0006);
  o BFF continua burro (ADR-0005 **não** superseded). Desbloqueia auth (0024) e exposição HTTP de Contratos (origem no ADR-0023).
- **[ADR-0026](./architecture/adr/0026-mysql-read-write-split-connection.md)** — Read/Write split de conexão MySQL
  (pools `writer`/`reader`, **Master-Slave ready**), **transversal** ao core-api. Single node hoje (ambos os pools no mesmo
  host); réplica vira só configuração. Read-after-write crítico lê do primário. Preserva a regra de ouro do ADR-0014
  (um único escritor). Nota honesta: o ganho do split vem de `contracts`/`fin` e read-models (ADR-0022), não do `auth`
  (write-heavy).

### Atualizado

- [`architecture/adr/README.md`](./architecture/adr/README.md) — índice com as 3 entradas (Proposed).

### Pendente

- Aprovação dos 3 ADRs (mover `Proposed → Accepted`).
- Após aprovação: revisão de domínio do módulo `auth` (handbook) + série de tickets W0→W3 (VOs `Email`/`Permission` →
  agregado `User` → `authenticate` → adapters → borda Fastify). Estender ADR-0014 documentando o prefixo `auth_*`.

---

## 2026-05-27 — Ciclo de vida do Contrato revisado: estado `Pendente` (ADR-0023)

### Contexto

Ao planejar a exposição HTTP do módulo Contratos (ACL sobre o `openapi.yaml` legado), a divergência
de status entre domínio (3 estados) e legado (5) foi levada à P.O. via
[Inquiry-0021](./inquiries/0021-contract-status-lifecycle-http.md).

### Decisão — ADR-0023 (decide Inquiry-0021)

A P.O. confirmou que **`Pendente` é regra real**: o contrato é cadastrado antes da assinatura, sem
efetividade (não inicia vigência, não aceita aditivos), e é **ativado** ao subir o documento
assinado + data. → **[ADR-0023](./architecture/adr/0023-contract-lifecycle-pending-state.md)** (Accepted):
ciclo de vida passa de 3 para **4 estados** (`Pendente → Em Andamento → Finalizado / Distrato`).

- Agregado `Contract` ganha o estado refinado `PendingContract` + transição `activate` (espelha
  `Amendment`: `Pending → PendingWithDocument → Homologated`).
- Nomenclatura: código EN (`Pending | Active | Expired | Terminated`); UI/ACL em PT
  (`Pendente | Em Andamento | Finalizado | Distrato`).
- **HTTP fica bloqueado** até a revisão de domínio entrar (handbook `gestao-contratos.md` + série de
  tickets `ts-domain-modeler`).

### Pendente

- Atualizar `gestao-contratos.md` (máquina de estados 4 nós, RN-CV-01/02, evento `ContractActivated`).
- Série de tickets de domínio (estado `PendingContract`, `create` dual, `activate`, persistência, CLI).

---

## 2026-05-26 — Acabamento de Contracts (parte 2): UC-11 import, Timeline e ADR-0022

### Contexto

Continuação da sessão de fechamento de gaps (parte 1 em 2026-05-25). Executados os gaps que
estavam no backlog + decisão arquitetural dos itens que dependiam de investigação. Tudo via
pipeline W0→W3 e commitado/pushed na branch `wip/checkpoint-2026-05-25`.

### Decisão arquitetural — ADR-0022 (decide inquiries 0017 + 0018)

[Inquiry-0017](./inquiries/0017-timeline-read-model-vs-adr-0020.md) (Timeline) e
[Inquiry-0018](./inquiries/0018-auditlog-transversal-todos-bcs.md) (AuditLog) decididas em
conjunto → **[ADR-0022](./architecture/adr/0022-read-models-via-projection-over-event-stream.md)** (Accepted).

Achado decisivo: o `ctr_outbox` **retém** entradas após entrega (`markProcessed`, não delete) —
já é o **log append-only** de eventos. Logo:

- Outbox = log canônico; **sem event-store novo** (rejeitado por redundância).
- **Derive-on-read do outbox rejeitado** (acopla leitura à entrega; payload VARCHAR serializado).
- **Read-models via projeção** sobre o stream (alimentados pelo event-delivery existente), colunas decompostas (ADR-0020).
- **Timeline:** implementada (projeção + UC-08); pass 2 (CLI + MySQL) no backlog.
- **AuditLog:** mesmo padrão (transversal), **diferido** até identidade/RBAC (o "Quem" não é confiável sem ator autenticado).
- Índice de ADRs e `inquiries/INDEX.md` atualizados (0017 `Decided`, 0018 `Decided (deferred)`; Decided 10→12, Open 7→5).

### Adicionado (código — tickets closed-green)

- **`CTR-IMPORT-LEGACY` (UC-11, núcleo)** — `especificacao-dominio.md:463-476`. Use case `importContracts`
  (v1 só Contratos Mãe): dry-run + persistente, relatório por linha, atomicidade por linha, duplicidade
  intra-arquivo + vs repo. **CNPJ validado e descartado** (D2) via novo `shared/kernel/cnpj.ts`.
  Extraído `buildContract` puro de `create-contract.ts` (determinismo dry-run = persistente).
- **`CTR-IMPORT-LEGACY-CLI` (UC-11, passada 2)** — parser CSV (subset RFC-4180, hand-rolled, **zero
  dependência** por ADR-0011) + JSON nativo, UTF-8; comando CLI `importar-contratos --arquivo/--formato/--confirmar`
  (dry-run por default). Relatório PT-BR.
- **`CTR-TIMELINE-READ-MODEL` (UC-08, passada 1)** — read-model projetado (ADR-0022): `toTimelineEntry`
  puro, port `TimelineRepository` (+ in-memory idempotente), `TimelineProjectionDelivery` como
  `EventDelivery` (consumer `timeline`), use case `getContractTimeline`. Resolve `contractId` de eventos
  que não o carregam via índice `amendmentId→contractId`.

### Aberto / atualizado (inquiries)

- **[Inquiry-0019](./inquiries/0019-hard-delete-tripwire-sem-superficie.md)** — `TentativaDeExclusaoDetectada`
  (gap 5). Achado: não há superfície de deleção física (port só `findById`/`list`/`save`); recomendação:
  prevenir por privilégio MySQL (`REVOKE DELETE`) em vez de detectar por evento. Não-código.

### Backlog rastreado (não iniciado)

- `CTR-IMPORT-LEGACY` **v2** (aditivos legados — depende de [Inquiry-0014 Q3](./inquiries/0014-schema-legado-vs-modelo-alvo.md)).
- `CTR-TIMELINE-CLI-PERSISTENCE` (pass 2 — UC-02 + CLI `ver-timeline` + MySQL `ctr_timeline_*` + wiring no worker).
- `FIN-ACL-CONTRACT-EVENTS` (gap 7 — módulo Financial, ADR-0014).
- AuditLog (Inquiry-0018) — reabre com identidade/RBAC.

### Estado da suíte

`pnpm test`: **1162 testes / 1146 pass / 0 fail / 16 skipped** (skips = integração Docker). 7 commits pushed na sessão (parte 1 + parte 2).

---

## 2026-05-25 — Acabamento de Contracts (UC-07 + R4) + 2 inquiries arquiteturais

### Contexto

Sessão de fechamento de gaps do módulo Contracts a partir do `RELATORIO-COBERTURA-DOMINIO-2026-05-25.md`. Executados os 2 gaps prontos (domínio existente) via pipeline W0→W3; os arquiteturais viraram inquiry antes de qualquer código (regra do orquestrador).

### Adicionado (código — tickets fechados closed-green)

- **`CTR-USECASE-END-CONTRACT`** — UC-07 Encerramento de contrato (`03-gestao-contratos-context.md:70-74`). Use case `endContract` (Expire/Terminate) orquestrando `Contract.expire`/`terminate` + comando CLI `encerrar-contrato`. Publica `ContractEnded` via outbox.
- **`CTR-AMENDMENT-CHRONOLOGY-R4`** — R4 cronologia do aditivo (`04-aditivos-context.md:86`). Guard em `homologateAmendment`: rejeita `amendment.createdAt < contract.signedAt` (âncora = `signedAt`, decisão do P.O.).

### Aberto (inquiries — pendentes, sem código)

- **[Inquiry-0017](./inquiries/0017-timeline-read-model-vs-adr-0020.md)** — Timeline (UC-02/UC-08) vs. ADR-0020 (proíbe coluna JSON). Fork: projeção dedicada vs. event-store append-only. → **decidida em 2026-05-26 (ADR-0022)**.
- **[Inquiry-0018](./inquiries/0018-auditlog-transversal-todos-bcs.md)** — `AuditLogGenerated` transversal (`06-event-line-context.md:24`). Depende de identidade/RBAC (Fase 2+). → **decidida-diferida em 2026-05-26 (ADR-0022)**.
- **[Inquiry-0019](./inquiries/0019-hard-delete-tripwire-sem-superficie.md)** — `TentativaDeExclusaoDetectada` (gap 5). Achado: não há superfície de deleção física no sistema (port só `findById`/`list`/`save`); melhor prevenir por privilégio MySQL que detectar por evento de domínio. Não-código.

### Backlog rastreado (status nesta data)

- `CTR-IMPORT-LEGACY` (gap 3 / UC-11 — feature grande) → **executado em 2026-05-26** (ver entrada acima). `FIN-ACL-CONTRACT-EVENTS` (gap 7 — módulo Financial, ADR-0014) — segue não iniciado.

---

## 2026-05-19 — Entrevista 0001 (DDD Funcional) ENCERRADA

### Contexto

A entrevista [`0001-functional-ddd-domain-refresh`](./interviews/0001-functional-ddd-domain-refresh.md) começou em 2026-05-18 como reformulação radical do domínio do módulo Contracts à luz de modelagem funcional moderna. Pacto: senior do projeto entrevista um PhD em DDD funcional via Q&A externa, com host responsável por destilar regras e corrigir contradições. 12 blocos temáticos abertos (A-L). Após 4 dias e ~50 turnos de conversa, **10 dos 12 blocos fechados**. Os 2 remanescentes (E1/E2 sobre `{ entity, event }` e F1/F2 sobre schema evolution de eventos) ficam pra **entrevista 0002** quando o outbox MySQL voltar à mesa.

### Adicionado

- **Pasta `handbook/interviews/`** (nova convenção) — formato auditável de entrevistas técnicas longas em `.md` versionado. README + 25 arquivos da entrevista 0001 (master + 9 perguntas semânticas unificadas + 14 perguntas individuais com banners superseded + 1 meta de diagramas + followups).
- **Tabela canônica L3** em [`Pergunta_J_K_L`](./interviews/0001/Pergunta_J_K_L_tec_lider_using_skill_ts-domain-modeler.md) — **105 entradas classificadas** em DO (40) + CONSIDER (16) + AVOID (5) + DON'T (44). PhD sub-entregou 16 entradas; host expandiu para cobrir os 7 blocos fechados + 20 diretrizes do projeto + J/K. Vira fonte canônica do `SKILL.md §3.L`.
- **3 diagramas Mermaid/ASCII canônicos** ([`Pergunta_diagramas_meta`](./interviews/0001/Pergunta_diagramas_meta_tec_lider_using_skill_ts-domain-modeler.md)):
  1. State Machine do `Amendment` — `PendingWithoutDocument → PendingWithDocument → Homologated` com aninhamento status × kind.
  2. Sequence diagram do fluxo de homologação cross-agregado.
  3. Árvore ASCII anotada do layout canônico de pastas.

### Decisões cravadas (resumo, ver tabela L3 completa para detalhes)

- **Padrão D (module-as-namespace)** — free functions + `import * as Module from './module.ts'`. Nunca `export const X = { … }`.
- **Result homemade** (`shared/result.ts`, ~50 LOC) com `ok`, `err`, `mapErr`, `combine`. Zero deps. Sem `andThen`/`pipe`/Effect/fp-ts/neverthrow.
- **Tagged errors via free functions** em `errors.ts` por agregado (Padrão D coerente).
- **State machine in types** — agregados como union refinada (`Amendment = PendingWithoutDocument | PendingWithDocument | Homologated`). Transições tipadas (`parseActive`, `attachSignedDocument`, `homologate`).
- **Aninhamento (status × kind)** — não cross-product. `Amendment` carrega 3 estados × 4 kinds aninhados.
- **Brand via `unique symbol` global** em `shared/brand.ts`. Wrapper para grandezas/unidades; primitivo para IDs opacos.
- **`shared/immutable.ts`** facade — esconde `Object.freeze` por trás de vocabulário do domínio.
- **`Instant = Brand<number, 'Instant'>`** — sem `Date` cru no domínio.
- **Dupla taxonomia** Amendment ≠ ContractAdjustment, ponte via `toAdjustments(homologated): readonly ContractAdjustment[]` (array — evolução assimétrica permite 1:N e 0:1).
- **Domínio 100% sync** — Application Layer (Imperative Shell) lida com `Promise`.
- **Exhaustive switch sem `throw`** — omitir `default` ou `return _exhaustiveCheck`. `assertNever` banido.
- **Layout canônico:** `src/shared/kernel/` (Evans cross-BC); `src/modules/<bc>/domain/shared/` (específico do BC); ports genéricos em `application/ports/`; Repository em `domain/<aggregate>/repository.ts`; `adapters/` (nunca `infra/`); módulo no plural (`contracts/`); `cli/` como pasta de primeira classe; `public-api/` por módulo (ADR-0006).
- **Mappers retornam `Result<Aggregate, RehydrationError>`** via smart constructors de VOs internos.
- **Imports — Opção C:** relativos intra-BC + subpath cross-BC (`#kernel/*`, `#shared/*`).
- **`import type`** sempre quando puro tipo (razão: `verbatimModuleSyntax: true`).
- **`satisfies`** antes do cast brand: `{ … } satisfies RawShape as BrandedVO`.

### Tickets que isto habilita (21 coordenados — ordem por leverage do PhD)

**Top-3 (maior leverage):**

1. `CTR-DOMAIN-STATE-MACHINE-CONTRACT` + `CTR-DOMAIN-STATE-MACHINE-AMENDMENT`.
2. `CTR-SHARED-VO-CANONICAL` + `CTR-SHARED-BRAND-UNIQUE-SYMBOL` + `CTR-SHARED-IMMUTABLE`.
3. `CTR-SHARED-RESULT-COMBINATORS` + `CTR-DOMAIN-COMPOSE-REFACTOR`.

**Demais:** `CTR-DOMAIN-DEBRAND-AGG`, `CTR-DOMAIN-MAPPER-RESULT`, `CTR-DOMAIN-TAGGED-ERRORS`, `CTR-DOMAIN-INVARIANT-CONTEXTUAL`, `CTR-DOMAIN-EXHAUSTIVE-SWITCH-FIX`, `CTR-DOMAIN-IMPORT-CODEMOD`, `CTR-DOMAIN-IMPORTS-STRATEGY`, `CTR-DOMAIN-IMPORT-TYPE-UNIFORM`, `CTR-DOMAIN-RESTRUCTURE`, `CTR-DOMAIN-K-OPTIONAL`.

**Refresh da SKILL (última fase, após refactors):** `CTR-SKILL-REFRESH-{A,B,C,D,G,H,I,L}` — refresh integral das seções da `SKILL.md` ts-domain-modeler.

### Observações metodológicas registradas

- **PhD sub-entrega em síntese (5 ocorrências):** Bloco B precisou followup com 5 tensões; Bloco C teve contradição direta com Bloco B (`throw` no exhaustive); Bloco D teve declaration merging contra Bloco B; Diagramas tiveram 6 erros factuais; Tabela L3 entregue com 16/105 entradas. Padrão: sempre pedir lista exaustiva com contagem-alvo no enunciado.
- **Lembrete de diretrizes no topo de pergunta funciona pra prose**, mas **não pra geração de artefato concreto** (snippet ou diagrama). Sempre revisar artefatos contra decisões cravadas.
- **Decisão TS handbook §695 como autoridade** ("looks no different than the JavaScript we would've written otherwise") + Wlaschin ("código de domínio não usa jargão de programador") são as duas referências mais citadas da entrevista.

### Próxima entrevista (sugerida — `0002`)

Outbox MySQL + Event sourcing puro vs `{ entity, event }` (E1 reaberto) + Observability tagged + Property-based testing com `fast-check`. Abre quando o módulo de comunicação cross-módulo for materializar.

---

## 2026-05-15 — ADR-0020: MySQL como Único Dialeto (supersedes ADR-0018)

### Contexto

O [ADR-0019](./architecture/adr/0019-document-storage-s3-with-minio-dev.md) (emitido nesta mesma data, mais cedo) materializou Docker Compose como infraestrutura local oficial do projeto, com `compose.yaml` na raiz do `core-api` provisionando MinIO (ADR-0019) e MySQL 8.4 (opt-in via profile `db`). A premissa central do [ADR-0018](./architecture/adr/0018-persistence-dual-dialect-drizzle.md) — _"rodar Docker MySQL localmente cria fricção para devs"_ — deixou de ser verdade. Com isso, manter SQLite como dialeto paralelo deixou de ter benefício e passou a ser ônus líquido (manter 2 schemas, mappers ramificados, lista normativa de paridade, toolchain C++ no Docker build, suite de testes duplicada).

### Adicionado

- **[ADR-0020](./architecture/adr/0020-mysql-only-supersedes-dual-dialect.md)** — `Status: Accepted` (aprovado pelos deciders em 2026-05-15). MySQL 8.4 vira único dialeto em todo o ciclo de vida (dev local, CI, staging, prod). Adapter `InMemory` preservado (para testes de domínio/use case e demo da P.O. via CLI driver `memory`). Convenção de tabelas adota prefixo `ctr_*` dentro do database `core` (alinhamento com ADR-0014). Lista normativa de features SQL atualizada: 4 features que estavam proibidas só por paridade voltam a ser permitidas (`ON DUPLICATE KEY UPDATE`, `FULLTEXT`, window functions, CTEs recursivas); 6 continuam proibidas por razão própria (JSON nativo, stored procs, `ENUM` nativo, tipos espaciais, `AUTO_INCREMENT` em PK de domínio, isolation level explícito).

### Atualizado

- **[ADR-0018](./architecture/adr/0018-persistence-dual-dialect-drizzle.md)** — Status `Accepted` → `Superseded by ADR-0020`. Banner de aviso adicionado no topo explicando a mudança de premissa. Conteúdo do ADR permanece intocado como evidência histórica.
- [`architecture/adr/README.md`](./architecture/adr/README.md) — Índice atualizado (0018 superseded, 0020 accepted).

### Tickets que isto habilita (em ordem)

1. `CTR-DB-COMPOSE-MYSQL` — `compose.yaml` com my.cnf custom + init scripts + healthcheck robusto.
2. `CTR-DB-SCHEMA-MYSQL-CTR-PREFIX` — `schemas/mysql.ts` com prefixo `ctr_*`, charset, índices F-H2/F-M2, CHECKs F-L1/F-L2.
3. `CTR-DB-MIGRATION-MYSQL` — `drizzle.config.ts` MySQL + primeira migration.
4. `CTR-DB-DRIVER-MYSQL` — Wire `mysql2`, resolver F-C1 (transaction async) e F-C2 (FK error union).
5. `CTR-CLEANUP-SQLITE` — Remover schema/driver/migration SQLite, dep `better-sqlite3`, testes específicos.
6. `CTR-DOCKERFILE-MYSQL` — Dockerfile sem toolchain C++.
7. `CTR-CLI-MYSQL-SMOKE` — `--driver mysql` + suite E2E rodando contra MySQL real.
8. `CTR-DOCS-UPDATE-FOR-ADR-0020` — atualizar `CLAUDE.md` raiz + 8 SKILL.md que ainda referenciam ADR-0018.

### Backward compat / breaking

- **Breaking** em `package.json`: `better-sqlite3` e `@types/better-sqlite3` removidos; script `db:generate:sqlite` substituído por `db:generate:mysql`.
- **Breaking** em CLI: flag `--driver sqlite` deixa de existir; aceita apenas `--driver memory|mysql`.
- **Breaking** no `Dockerfile`: estágio `deps` perde `python3 + make + g++` (~150MB de imagem economizados).
- **Preservado**: domain, application, ports, adapter `InMemory`, driver CLI `memory`, suite de contrato compartilhada (`*.contract.ts`/`*.suite.ts`).

---

## 2026-05-14 — CLI ganha `--driver memory|sqlite|mysql` (ticket CTR-CLI-DRIVER-FLAG fechado)

### Contexto

O ticket `CTR-ADAPTER-DRIZZLE-DUAL` entregou o adapter Drizzle/SQLite mas só era exercitado por testes — a CLI continuava 100% InMemory + state file JSON. O `CTR-CLI-DRIVER-FLAG` (4 waves, 310/310 verdes) wirea o adapter na CLI para que a P.O. e devs validem o motor de cálculo contra **persistência real** antes do MySQL chegar.

### Adicionado

- Nova seção [§4.1 "CLI e escolha de driver"](./architecture/06-persistence-strategy.md#41-cli-e-escolha-de-driver) em `06-persistence-strategy.md` documentando: tabela de uso por driver, regras de validação de flags, exit codes (sysexits.h: 0/1/64/70/74), shutdown garantido via `try/finally`, e diretriz "quando escolher cada driver".

### Entregas correspondentes em `ERP-CONTRACTS/`

- **Refatoração `CliContext`**: agora expõe **ports** (`contractRepo`, `amendmentRepo`, `eventBus`) — handles InMemory ficam confinados a `cli/drivers/memory.ts`. Boundary realmente contido.
- **3 drivers**: `cli/drivers/{memory,sqlite,mysql}.ts`. Memory preserva backward compat (default + state file JSON); SQLite usa `openSqlite()` com `shutdown` fechando a conexão; MySQL é stub que retorna `cli-mysql-driver-not-wired` com exit 70.
- **Parser de flags**: `cli/parse-driver-flags.ts` separa extração sintática (`extractFlags`) de validação semântica (`buildXxxDriver`) — 17 unit tests cobrindo defaults, conflitos cruzados e missing-value.
- **Suite E2E paralela**: `tests/cli/contracts.cli.sqlite.test.ts` roda os mesmos cenários BDD com `--driver sqlite --db <tempfile>`. Paridade real entre InMemory e Drizzle/SQLite forçada pela igualdade de output.
- **7 erros PT-BR** novos no `formatters/error.ts` (cli-driver-_, sqlite-driver-_, cli-mysql-driver-not-wired).
- **6 comandos refatorados** (mecânica `ctx.xxxHandle.repo` → `ctx.xxx`; `ctx.persist()` virou `await`).

### Backward compat

Toda script existente que invoca a CLI sem `--driver` continua funcionando idêntico ao pré-W1: padrão é `--driver memory --state ./cli-state.json`. Suite original `tests/cli/contracts.cli.test.ts` (16 testes) passa sem modificação.

---

## 2026-05-14 — Persistence Strategy doc + ADR-0018 Accepted + ticket CTR-ADAPTER-DRIZZLE-DUAL fechado

### Contexto

A implementação que materializa o ADR-0018 (4 waves do ticket CTR-ADAPTER-DRIZZLE-DUAL) foi entregue: 283 testes verdes, adapter Drizzle/SQLite funcional, schema MySQL stubado, mappers canônicos, migrations versionadas via `drizzle-kit`.

### Adicionado

- [`architecture/06-persistence-strategy.md`](./architecture/06-persistence-strategy.md) — **Guia operacional** da estratégia dual-dialect: mapeamentos canônicos por tipo (`Money`, `Date`, `Period`, IDs, arrays), topologia de execução, build do binário nativo `better-sqlite3` (macOS + Docker), boundary `error → Result`, critérios para re-avaliar.

### Atualizado

- [ADR-0018](./architecture/adr/0018-persistence-dual-dialect-drizzle.md) — Status **Proposed → Accepted**. Clarificação na lista normativa: `drizzle.insert(...).onConflictDoUpdate(...)` é aceito porque o Drizzle traduz para a sintaxe nativa de cada dialeto; o que está proibido é **escrever** `ON DUPLICATE KEY UPDATE` ou `INSERT OR REPLACE` à mão (resolve a NOTE 3 do review W2).
- [`architecture/adr/README.md`](./architecture/adr/README.md) — Status do ADR-0018 atualizado para Accepted.
- [`architecture/README.md`](./architecture/README.md) — Índice ganhou linha 06.

### Notas técnicas (entregas correspondentes em `ERP-CONTRACTS/`)

- `src/modules/contracts/adapters/persistence/` — driver SQLite + 2 schemas espelhados + mappers + repos Drizzle.
- `tests/modules/contracts/adapters/persistence/` — suite de contrato reutilizável (20 cenários) rodando contra InMemory **e** Drizzle/SQLite.
- `drizzle.config.ts` + `pnpm db:generate:sqlite` — migrations versionadas geradas em `src/modules/contracts/adapters/persistence/migrations/sqlite/`.
- `Dockerfile` — estágio `deps` com `python3 + make + g++` para compilar binário nativo `better-sqlite3`.

---

## 2026-05-14 — ADR-0018: Persistência Dual-Dialect (Drizzle MySQL + SQLite)

### Contexto

O módulo `contracts` está pronto no domínio (243 testes verdes) e na CLI MVP, mas ainda usa repositórios InMemory + state file JSON. A infra MySQL prometida pela Codebit ([ADR-0013](./architecture/adr/0013-mysql-database-engine.md)) ainda não foi provisionada, e bloquear a entrega no fornecedor externo seria caro.

A pergunta arquitetural: **como adicionar persistência real sem violar o ADR-0013 (MySQL é a produção) e sem esperar a infra?**

### Adicionado

- [`architecture/adr/0018-persistence-dual-dialect-drizzle.md`](./architecture/adr/0018-persistence-dual-dialect-drizzle.md) — **ADR Proposed** estabelecendo estratégia dual-dialect via Drizzle: MySQL continua sendo produção; SQLite entra **exclusivamente como ambiente de dev/CI** com paridade controlada por disciplina explícita. Princípio condutor: **1 port, 1 repositório, 2 schemas espelhados, 2 mappers, 1 lista canônica de features permitidas.**

### Lista normativa de features SQL (resumo)

| ✅ Permitidas                                                                                               | ❌ Proibidas                                                                                                                                                                                       |
| :---------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DML básico, WHERE/ORDER/LIMIT, INNER/LEFT JOIN, COUNT/SUM/MAX, UNIQUE/INDEX, FKs, transações, CHECK simples | Colunas JSON nativas, `ON DUPLICATE KEY UPDATE`, FULLTEXT, stored procedures, triggers, window functions, CTEs recursivas, ENUM nativo, tipos espaciais, AUTO_INCREMENT, isolation level explícito |

### Mapeamentos canônicos por dialeto

| Tipo de domínio                     | SQLite                                                   | MySQL                                                |
| :---------------------------------- | :------------------------------------------------------- | :--------------------------------------------------- |
| `Money` (cents)                     | `integer`                                                | `bigint`                                             |
| `Date` (timestamp)                  | `integer` unix-ms                                        | `datetime(3)`                                        |
| `Period` (Fixed \| Indefinite)      | 3 colunas: `period_kind` + `period_start` + `period_end` | Mesma decomposição com `varchar(16)` + `datetime(3)` |
| `AmendmentKind` / `AmendmentStatus` | `text` + CHECK                                           | `varchar(16)` + CHECK                                |
| `homologatedAmendmentIds` (array)   | Tabela de junção                                         | Mesma                                                |

### Atualizado

- [`architecture/adr/README.md`](./architecture/adr/README.md) — Índice de ADRs incrementado com 0018 (Proposed).

### Relação com decisões anteriores

| ADR                                                              | Relação                                                                                                                        |
| :--------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| [ADR-0013](./architecture/adr/0013-mysql-database-engine.md)     | **Preservado.** MySQL continua sendo o engine de produção. ADR-0018 apenas adiciona SQLite como ambiente paralelo para dev/CI. |
| [ADR-0006](./architecture/adr/0006-modular-monolith-core-api.md) | **Honrado.** A estratégia dual-dialect só é viável porque ports & adapters já isolam domínio do mecanismo de persistência.     |
| [ADR-0015](./architecture/adr/0015-mysql-outbox-pattern.md)      | **Não afetado.** Outbox vive em MySQL quando a infra subir; SQLite não exercita outbox no dev.                                 |

### Quando re-avaliar

A decisão será revisitada se MySQL gerenciado for provisionado e estabilizado por 3+ meses **e** o esforço de manter SQLite ultrapassar o ganho em velocidade de testes — ou se um requisito de domínio exigir feature da lista proibida.

### Ticket relacionado

- [`ERP-CONTRACTS/.claude/.pipeline/CTR-ADAPTER-DRIZZLE-DUAL/`](../ERP-CONTRACTS/.claude/.pipeline/CTR-ADAPTER-DRIZZLE-DUAL/) — implementação que materializa este ADR (W0 RED a iniciar após aprovação).

---

## 2026-05-14 — Descoberta do schema legado real (Inquiry-0014 + mapeamento de 32 tabelas)

### Contexto

A pasta `DUMP PROD` (compartilhada por Nicole Ruivo / going2 em 2026-04-30) foi colocada localmente em `database/.dump/`. Para atender LGPD (dados pessoais, valores fiscais), foi extraído apenas o schema (`schema-only.sql`, 49KB), descartando os 23 INSERTs do dump original (1.3MB). `.gitignore` criado bloqueando `database/.dump/` por completo. **Nenhum dado pessoal versionado em momento algum.**

A análise sistemática das **32 tabelas** revelou discrepâncias estruturais entre o legado real e o modelo alvo do handbook — registradas como [Inquiry-0014](./inquiries/0014-schema-legado-vs-modelo-alvo.md).

### Adicionado

- [`domain/10-mapeamento-legado-schema.md`](./domain/10-mapeamento-legado-schema.md) — **Documento mestre da descoberta:** inventário das 32 tabelas agrupadas em 7 BCs implícitos do legado (Identity, Financial Core, Chart of Accounts, Budgeting, Contracts, Workflow, Geography), mapeamento legado → módulos alvo, gaps estruturais, achados positivos, recomendações imediatas.
- [Inquiry-0014](./inquiries/0014-schema-legado-vs-modelo-alvo.md) — **Schema legado real vs. modelo alvo:** 4 perguntas para a banca (Q1 chave de correlação, Q2 BC novo de Planejamento Orçamentário, Q3 migração de `contracts`, Q4 primeiro vertical slice), com hipóteses de trabalho do autor para cada.
- [Inquiry-0011 Apêndice D](./inquiries/0011-auditoria-fiscal-cross-periodo.md) — **Achado empírico que muda a base da §7.3:** legado não tem campos NFe (chave 44 dígitos, número documento, série, modelo, CFOP). O conceito de Fato Gerador é adição do modelo alvo, não migração. Hipótese D refinada: tripla simbólica `(id_legado + tipo_origem + createdAt_legado)` + legado preservado read-only.
- `database/.dump/schema-only.sql` — Schema bruto (não versionado, fora do repo).
- `.gitignore` na raiz do projeto bloqueando `database/.dump/`, `node_modules/`, `dist/`, `.env*`.

### Atualizado

- [`architecture/03-data-architecture.md`](./architecture/03-data-architecture.md) §1 e §2 — Nome real do database legado registrado (`abc-erp-financeiro-prod` em Cloud SQL MySQL 8.4.7-google). Collation real confirmada como `utf8mb4_0900_ai_ci` (padrão MySQL 8) — documento já aceitava ambas, agora documenta a realidade.
- [`domain/02-context-map.md`](./domain/02-context-map.md) — Aviso no topo apontando para o gap descoberto (BC de Planejamento Orçamentário ausente).
- [`inquiries/INDEX.md`](./inquiries/INDEX.md) — Total sobe para 14, `Open` sobe para 3 (com 0014).
- [`inquiries/PERGUNTAS-EM-ABERTO.md`](./inquiries/PERGUNTAS-EM-ABERTO.md) — Bloco da Inquiry-0014 adicionado (7 perguntas). Confirmação no bloco da Inquiry-0012 de que `app.setGlobalPrefix('api/v1')` é literalmente uma linha (TypeORM 0.3 + NestJS confirmados via assinatura do schema).
- [`inquiries/0011-auditoria-fiscal-cross-periodo.md`](./inquiries/0011-auditoria-fiscal-cross-periodo.md) — Aviso no topo direcionando o leitor para o Apêndice D antes de deliberar; campo "Last updated: 2026-05-14".

### Confirmações empíricas

| #   | Premissa anterior                                                                                                    | Realidade no dump                                                                            |
| :-- | :------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| C1  | Engine real = MySQL 8 ([Inquiry-0010](./inquiries/0010-mysql-engine-correction.md))                                  | ✅ MySQL **8.4.7-google** (Cloud SQL) — confirma legado em GCP                               |
| C2  | Charset `utf8mb4` + `utf8mb4_unicode_ci` ou `utf8mb4_0900_ai_ci`                                                     | ✅ Real: **`utf8mb4_0900_ai_ci`**                                                            |
| C3  | Backend NestJS 10 + TypeORM 0.3 + `mysql2` ([Inquiry-0010](./inquiries/0010-mysql-engine-correction.md))             | ✅ Confirmado via assinatura no schema (FK_hash, tabelas `migrations`, `query-result-cache`) |
| C4  | "Uma linha no main.ts para Hipótese A" ([Inquiry-0012 §6.1](./inquiries/0012-bff-managed-api-gateway-vs-fastify.md)) | ✅ Literal — `app.setGlobalPrefix('api/v1')` no NestJS resolve                               |

### Achados que mudam o handbook

1. **Não existe documento fiscal modelado no legado.** Sem chave NF-e, sem número de documento original, sem série, sem CFOP. O Fato Gerador do handbook é **nascimento, não migração**. Muda a base do ADR-0017 e da Hipótese D da Inquiry-0011.
2. **Há um BC oculto no legado: Planejamento Orçamentário.** `cost_centers*` + `budget_*` + `programs` + `categorization` (hub com 10 FKs) modelam comportamento sem equivalente em [`domain/02-context-map.md`](./domain/02-context-map.md). Gap de modelagem do handbook.
3. **Cardinalidade modesta.** `accounts.AUTO_INCREMENT ≈ 6`, dump total 1.3MB. Confirma a Hipótese D (Vernon p. 166 + Evans p. 228): construir Reporting DB hoje sem demanda real é prematuro.
4. **Integridade referencial forte.** Todas as FKs presentes e nomeadas pelo TypeORM. Grafo de dependências confiável; ordem de migração derivável diretamente.

### Em aberto

- 🟢 [Inquiry-0014](./inquiries/0014-schema-legado-vs-modelo-alvo.md) permanece com status `Open` — banca interna ainda não deliberou Q1–Q4.
- 🟢 [Inquiry-0011](./inquiries/0011-auditoria-fiscal-cross-periodo.md) tem nova pergunta Q7.7 no Apêndice D (refinamento da Hipótese D na ausência de campos fiscais).
- 🟡 [ADR-0017](./architecture/adr/0017-correlation-keys-cross-period-audit.md) permanece `Proposed`, mas com base empírica revisada — provável revisão/supersede após Q1.
- ⬜ Próximo BC a documentar: `domain/11-planejamento-orcamentario-context.md` (depende de Q2).
- ⬜ Reverse engineering das regras de rateio em `categorization` (depende de acesso ao código fonte do legado pelo `codebit-br` — pendente em [Inquiry-0003 §E18](./inquiries/PERGUNTAS-EM-ABERTO.md)).

### Lição metodológica

A análise de schema **antes** de iniciar a implementação permitiu detectar:

- Confirmações silenciosas de premissas (engine, charset, ORM) — economia de retrabalho.
- Gaps de modelagem do handbook (BC Planejamento Orçamentário) — visíveis só no schema, não nas conversas com P.O.
- Premissas empíricas frágeis em deliberação em curso (Inquiry-0011 §7.3) — corrigidas antes de virar ADR aceito.

Princípio: **ler o schema antes de modelar o agregado**. O domínio fala primeiro, o handbook segue.

---

## 2026-05-07 — Inquiry-0011 fundamentada + ADR-0017 rascunho (auditoria fiscal cross-período)

### Contexto

A revisão `handbook/reviews/0001-revisao-refatoracao-migracao-segura.md` (achado **F1.4 — Lacuna 1**) identificou que o handbook não tratava o cenário de **auditoria fiscal cross-período** — consultas cuja janela atravessa a fronteira temporal entre o legado (CRUD, "título avulso") e o core (Agregado, "Documento Fiscal" como Fato Gerador). A janela de oportunidade para preservar reconciliabilidade futura se fecha quando o desenho de `core.fin_documentos` começar (entrada de M3).

### Adicionado

- [Inquiry-0011](./inquiries/0011-auditoria-fiscal-cross-periodo.md) — **Apêndice C: Fundamentação canônica** com 8 citações literais extraídas em 4 ondas de busca via MCP `acdg-skills`:
  - Fowler/Sadalage, _Refactoring_ p. 68 — Parallel Change / Expand-Contract
  - Newman, _Building Microservices_ p. 115 — Reporting Database + tooling de schema migration
  - Vernon, _IDDD_ p. 712 — Read Model Projections + replay; p. 166 — disciplina arquitetural
  - Evans, _DDD_ p. 228 — Anticorruption Layer + "A Cautionary Tale"
  - **Valente, _Fundamentos de Manutenção de Software_ §8.3.2 (Strangler Fig PT-BR) e §8.4.5 (Particionamento do banco PT-BR)**
- [Inquiry-0011](./inquiries/0011-auditoria-fiscal-cross-periodo.md) — **Apêndice A: Decisão registrada (rascunho do autor)** propondo Hipótese D, com campos da banca em branco até deliberação.
- [ADR-0017](./architecture/adr/0017-correlation-keys-cross-period-audit.md) — **Status `Proposed`** — Chaves de correlação cross-período entre `legacy` e `core`. Decide adicionar 3 colunas (`numero_documento_original_legado`, `id_legado`, `cnpj_emitente`) ao schema de `core.fin_documentos` desde o nascimento, adiando construção de Reporting DB / Read Model CQRS até gatilho explícito.

### Atualizado

- [`architecture/adr/README.md`](./architecture/adr/README.md) — índice de ADRs com entrada do ADR-0017 (Proposed). Note: ADR-0016 segue reservado para "estratégia de implementação dos 2 módulos no `core-api`" conforme pendência registrada no changelog de 2026-04-28; ADR-0017 pulou esse número intencionalmente.

### Justificativa central

A Hipótese D ("adiar com gatilho explícito + chave de correlação preservada hoje") **não é decisão lean fora do corpus** — é aplicação direta de três patterns canônicos:

1. **Mecanismo técnico** — Parallel Change / Expand-Contract (Sadalage citado por Fowler) para adicionar colunas hoje sem reader. Variante "expand-and-preserve" porque retenção fiscal de 5+ anos impede a fase contract.
2. **Disciplina de adiar** — Vernon p. 166: "use them only where applicable, where they mitigate a specific risk that would otherwise increase the potential for project or system failure".
3. **Argumento de fechamento** — Evans p. 228: "integration is always expensive — we should be sure it is really needed".

Valente §8.4.5 (PT-BR) endossa explicitamente combinar estratégias de particionamento; a Hipótese D é uma combinação seletiva de **Banco de Dados Dedicado** (já vigente em ADR-0014) com **replicação seletiva de chaves estáveis** (estratégia 4 de Valente, aplicada a colunas e não a tabelas).

### Em aberto

- 🟢 [Inquiry-0011](./inquiries/0011-auditoria-fiscal-cross-periodo.md) permanece com status `Open` — banca interna de arquitetura ainda não deliberou.
- 🟢 [ADR-0017](./architecture/adr/0017-correlation-keys-cross-period-audit.md) permanece `Proposed` até deliberação da banca.
- ⏳ Validação fiscal direta (Q3 e Q5 do Inquiry-0011) com contabilidade — campos exatos de correlação (chave NF-e 44 dígitos, série, modelo, regime tributário) e latência aceitável para reporting fiscal — fora do escopo do corpus técnico, conforme decisão metodológica registrada na inquiry e na memória do projeto.

### Lição metodológica

Esta inquiry consolidou um padrão de trabalho separando explicitamente:

- **Decisões técnicas/arquiteturais** — buscadas no corpus canônico via MCP `acdg-skills` com regra de citação literal de ≥4 linhas.
- **Decisões fiscais/de negócio** — validadas fora do corpus, diretamente com contabilidade ou especialistas em ERPs de mercado.

Não confundir os dois escopos no mesmo bloco de fundamentação.

---

## 2026-04-28 — Adição do Módulo Contratos ao handbook

### Contexto

Após reorganização da pasta `domain_questions/` por módulo + Bounded Context, ficou explícito que o ERP comporta um **segundo módulo de negócio** ainda não refletido no handbook: **Contratos**. O domínio já estava descoberto e validado com a P.O. (artefatos em [`domain_questions/contratos/`](./domain_questions/contratos/)), mas faltava a propagação para o handbook formal e para os artefatos de arquitetura.

### Adicionado

- **Pasta [`domain/contratos/`](./domain/contratos/)** — módulo Contratos completo no estilo do handbook formal:
  - `README.md` — índice executivo
  - `01-introduction.md` — visão de produto, atores, MVP, KPIs
  - `02-context-map.md` — 4 BCs (Gestão de Contratos, Aditivos, Timeline, Integração Financeira)
  - `03-gestao-contratos-context.md` — BC Core ⭐ (Contrato Mãe + Estado Vigente)
  - `04-aditivos-context.md` — BC Core ⭐ (Acréscimo, Supressão, Prazo, Variado + homologação)
  - `05-timeline-context.md` — BC Supporting (append-only + repositório documental)
  - `06-event-line-context.md` — matriz de eventos interna do módulo
  - `07-external-context.md` — fronteira com Financeiro (ACL), Storage e RBAC
  - `DOCUMENTO_MESTRE.md` — especificação consolidada
- **Reorganização de [`domain_questions/`](./domain_questions/)** — separado por módulo (`contratos/` e `financeiro/`), com BCs em sub-pasta `bounded-contexts/`. Limpeza de rascunhos duplicados (v1 superada por v2, dumps de chat).

### Atualizado

- [`README.md`](./README.md) — visão estratégica passa a apresentar os 2 módulos lado a lado; estado do projeto inclui módulo Contratos; princípios imutáveis separados em "compartilhados", "Financeiro" e "Contratos".
- [`domain/README.md`](./domain/README.md) — vira índice de módulos do ERP, listando Financeiro (raiz, por motivo histórico) e Contratos (sub-pasta).
- [`architecture/02-system-topology.md`](./architecture/02-system-topology.md) — diagrama do `core-api` mostra os 2 módulos hospedados; seção 2.3 explica responsabilidades de cada módulo + princípio "sem cross-write entre módulos".
- [`architecture/03-data-architecture.md`](./architecture/03-data-architecture.md) — nova seção 1.1 "Organização interna do `core` por módulo" com prefixos `fin_*` e `ctr_*`; mesma regra de ouro vale em nível de módulo.
- [`architecture/04-integration-events.md`](./architecture/04-integration-events.md) — catálogo §6 dividido em "cross-serviço (legacy↔core)" e "cross-módulo (Contratos↔Financeiro)"; lista eventos `EstadoContratualAtualizado`, `ContratoEncerrado` etc.

### Justificativa central

- **Por que Modular Monolith e não serviço próprio?** Alinhado com [ADR-0006](./architecture/adr/0006-modular-monolith-core-api.md): tamanho do time, ausência de SRE dedicado e auditoria cross-módulo (Time Travel) tornam a separação física custosa sem benefício proporcional. Caminho de extração futuro preservado pela disciplina do outbox + prefixos de tabela.
- **Por que outbox mesmo intra-processo?** Atomicidade transacional, auditoria gratuita, e o módulo já nasce com o "passaporte" pronto caso vire serviço próprio depois.
- **Por que `domain/` ficou assimétrico (Financeiro flat + Contratos em sub-pasta)?** Mover Financeiro para `domain/financeiro/` exigiria atualizar links em ADRs aceitos (imutáveis) — ADRs 0001, 0006, 0008. Uniformização futura cabe em ADR próprio.

### Pendência

- ⏳ ADR formal sobre estratégia de implementação dos 2 módulos no `core-api` (prefixos `fin_*` / `ctr_*`, comunicação via outbox in-process) — bom candidato a **ADR-0016**.
- ⏳ Inquiry sobre ordem de ataque entre módulos (Bradesco/Financeiro primeiro vs primeiro BC do Contratos em paralelo) — após retomada com a P.O.

---

## 2026-04-28 — CORREÇÃO CRÍTICA: Engine de banco é MySQL, não PostgreSQL

### Contexto

Em revisão crítica iniciada por questionamento direto, descobriu-se que toda a fase de modelagem inicial (ADRs 0001-0012) partiu da assunção incorreta de que o engine de banco era PostgreSQL. O engine real é **MySQL 8**, conforme `legacy_project/package.json` e `legacy_project/CLAUDE.md`.

A decisão consciente foi **manter MySQL** em ambos legado e core-api novo (não migrar para PostgreSQL), respeitando ADR-0001 (Strangler Fig — uma briga de cada vez).

### Adicionado

- [ADR-0013](./architecture/adr/0013-mysql-database-engine.md): Engine de Banco de Dados — MySQL 8 (correção de assunção).
- [ADR-0014](./architecture/adr/0014-mysql-database-isolation.md): Isolamento por Database em MySQL — supersedes ADR-0003.
- [ADR-0015](./architecture/adr/0015-mysql-outbox-pattern.md): MySQL Outbox Pattern — supersedes ADR-0004.
- [Inquiry-0010](./inquiries/0010-mysql-engine-correction.md): Documentação completa da correção (incluindo lição aprendida).

### Atualizado / Superseded

- [ADR-0003](./architecture/adr/0003-shared-db-isolated-schemas.md): status `Accepted` → `Superseded by ADR-0014`. Conteúdo mantido como evidência histórica.
- [ADR-0004](./architecture/adr/0004-postgres-outbox-pattern.md): status `Accepted` → `Superseded by ADR-0015`. Conteúdo mantido como evidência histórica.
- [ADR-0008](./architecture/adr/0008-bradesco-integration-architecture.md): mantido (conteúdo arquitetural válido); referência ao driver `pg` deve ser lida como `mysql2`.
- [Inquiry-0008](./inquiries/0008-postgres-driver-pg-vs-postgres.md): marcada como **OBSOLETA** (driver real é `mysql2`).
- `architecture/02-system-topology.md`: diagrama atualizado para MySQL com databases isolados.
- `architecture/03-data-architecture.md`: reescrito para sintaxe MySQL (DDL, charset utf8mb4, tipos).
- `architecture/04-integration-events.md`: outbox em MySQL (CHAR(36), JSON, índice composto, sem LISTEN/NOTIFY).
- `infrastructure/01-infra-handoff.md`: provisionamento MySQL com utf8mb4; carga via `mysqldump`.
- `infrastructure/03-secrets-catalog.md`: formato `DATABASE_URL` para MySQL.
- `infrastructure/04-observability-baseline.md`: auditoria via plugin MySQL em vez de pgaudit.
- ADR README: índice atualizado com novos ADRs e supersede status.

### Justificativa central

Manter MySQL é a decisão certa porque:

1. **ADR-0001 (Strangler Fig)** alerta contra batalhas simultâneas. Trocar engine no meio da migração é exatamente esse tipo de risco.
2. Não há requisito de domínio que MySQL 8 não atenda.
3. Conversão MySQL → PostgreSQL adiciona projeto à parte com risco de bugs sutis em queries financeiras.
4. Time + Codebit já operam MySQL.
5. Drizzle ORM funciona com `drizzle-orm/mysql2`.

### Lição aprendida

Validar premissas técnicas fundamentais com o **código real** logo no início da modelagem. `package.json` do legado deveria ter sido lido antes do primeiro ADR sobre persistência. Custo da correção foi baixo porque foi pega cedo (antes de implementação real).

### Pendência

- ⏳ Atualizar versão do ticket da Codebit (preparada anteriormente) antes de enviar — trocar PostgreSQL por MySQL 8 e remover seção sobre conversão MySQL → PostgreSQL.

---

## 2026-04-28 — Documentação completa do plano + sistema de Inquiries

### Adicionado

#### Pasta `inquiries/` — log de chamadas, dúvidas e decisões

- README explicando uso da nova pasta como trilha de auditoria do raciocínio.
- `_template.md` para padronizar registro.
- `INDEX.md` com status de todas as inquiries (filtros por status e tema).
- 9 inquiries históricas documentando o raciocínio de cada decisão arquitetural relevante:
  - [Inquiry-0001](./inquiries/0001-modular-monolith-vs-microservices.md): Modular Monolith vs Microservices.
  - [Inquiry-0002](./inquiries/0002-bradesco-van-architecture.md): Arquitetura Bradesco (VAN + REST).
  - [Inquiry-0003](./inquiries/0003-multi-cloud-strategy.md): Multi-cloud (Pending Response — bloqueado pela Codebit).
  - [Inquiry-0004](./inquiries/0004-node-version-and-typescript-future.md): Node 24 + TypeScript 7.0.
  - [Inquiry-0005](./inquiries/0005-supply-chain-axios-and-dependency-hardening.md): Supply chain Axios + hardening.
  - [Inquiry-0006](./inquiries/0006-package-manager-pnpm-vs-bun.md): pnpm vs Bun.
  - [Inquiry-0007](./inquiries/0007-http-framework-fastify-vs-express.md): Fastify vs Express.
  - [Inquiry-0008](./inquiries/0008-postgres-driver-pg-vs-postgres.md): Driver Postgres `pg` vs `postgres`.
  - [Inquiry-0009](./inquiries/0009-email-strategy-nodemailer-with-adapter.md): Email — Nodemailer + Adapter.

#### 6 ADRs novos

- [ADR-0007](./architecture/adr/0007-multi-cloud-aws-gcp.md): Topologia multi-cloud AWS + GCP (status **Proposed**, aguarda Codebit).
- [ADR-0008](./architecture/adr/0008-bradesco-integration-architecture.md): Arquitetura da integração Bradesco (REST + VAN/STCPCLT).
- [ADR-0009](./architecture/adr/0009-node-24-typescript-6-with-7-roadmap.md): Node 24 LTS + TypeScript 6 com plano para 7.0 (`supersedes` parcial do ADR-0002).
- [ADR-0010](./architecture/adr/0010-email-port-adapter-pattern.md): Email — Port & Adapter Pattern com Nodemailer.
- [ADR-0011](./architecture/adr/0011-supply-chain-hardening.md): Política de Supply Chain Hardening.
- [ADR-0012](./architecture/adr/0012-pnpm-package-manager.md): pnpm como package manager único.

### Justificativas centrais agregadas

- **Modular Monolith** alinhado a invariantes cross-BC do handbook (R3 Sincronia, R3 Reabertura, R8 Integridade, Auditoria Shared Kernel, Time Travel cross-BC).
- **Bradesco com 2 caminhos físicos** (REST API mTLS + VAN/SSH/STCPCLT) confirmado em e-mail com Cadu (Going2) — implicação operacional para infra (Windows VM).
- **Multi-cloud AWS + GCP** inferido de duas fontes independentes (e-mail Cadu + ticket SGM #95026 Codebit) — pendente confirmação formal.
- **Node 24 LTS** substitui Node 20 EOL este mês; TypeScript 7.0 Beta lançado em 21/abril/2026 com compilador em Go.
- **Axios proibido** após incidente de supply chain de 31/março/2026 (CISA alerta de 20/abril/2026).
- **pnpm** mantido como única escolha; Bun rejeitado por gaps de segurança (sem audit, sem assinatura, lockfile binário).
- **Nodemailer** mantido pelo custo zero, encapsulado em port pra futura troca trivial.

### Em aberto

- 🟡 [Inquiry-0003](./inquiries/0003-multi-cloud-strategy.md): aguardando respostas da Codebit (bloqueia provisionamento de infra).
- 🟡 [ADR-0007](./architecture/adr/0007-multi-cloud-aws-gcp.md): em status `Proposed` até confirmação.

---

## 2026-04-27 — Atualização

### Adicionado

- [ADR-0006](./architecture/adr/0006-modular-monolith-core-api.md): Modular Monolith para o `core-api` (granularidade de serviço). Decisão tomada após análise convergente entre revisão própria do handbook e validação cruzada com fonte externa de literatura arquitetural. Os 4 BCs do handbook (Documentos, Títulos, Bradesco, OCR) ficam como módulos internos em um único deployable (`apps/core-api/src/contexts/`), com fronteiras lógicas garantidas via ESLint + ports/adapters + eventos in-process.

### Justificativa central

- Invariantes cross-BC do handbook (R3 Sincronia, R3 Reabertura, R8 Integridade de Imposto, Auditoria Shared Kernel, Time Travel cross-BC) tornam a separação física entre BCs operacionalmente cara sem benefício proporcional.
- Tamanho do time, volume de dados e ausência de SRE dedicado não justificam a complexidade de microservices.
- Caminho de extração futuro preservado: se sinais aparecerem (event loop starvation no OCR, escala assimétrica, time crescer para 10+ devs com squads dedicadas), extrair `bank-ocr-api` é movimento de dias, não meses.

---

## 2026-04-27 — Estrutura inicial

### Adicionado

- Estrutura inicial do handbook em pastas: `domain/`, `architecture/`, `architecture/adr/`, `infrastructure/`, `operations/`.
- README mestre na raiz como ponto de entrada único de toda a documentação.
- Seção `architecture/` com 5 documentos descrevendo **como** o sistema é construído.
- Seção `architecture/adr/` com 5 ADRs documentando as decisões fundamentais da migração.
- Seção `infrastructure/` com handoff completo para o time de plataforma e baseline de observabilidade.
- Seção `operations/` (placeholder) para receber runbooks e post-mortems futuros.
- Este `CHANGELOG.md`.

### Movido

- Documentos de domínio (`01-introduction.md` a `09-status-maquina-estados.md`, `DOCUMENTO_MESTRE.md`) movidos da raiz do handbook para `domain/`.
- `00-README.md` antigo renomeado para `domain/README.md` (índice da seção de domínio).

### ADRs registrados

- [ADR-0001](./architecture/adr/0001-strangler-fig-over-rewrite.md): Estratégia Strangler Fig sobre rewrite ou refactor in-place.
- [ADR-0002](./architecture/adr/0002-keep-nodejs-runtime.md): Manutenção do runtime Node.js nesta fase de migração.
- [ADR-0003](./architecture/adr/0003-shared-db-isolated-schemas.md): Banco compartilhado com schemas isolados.
- [ADR-0004](./architecture/adr/0004-postgres-outbox-pattern.md): Postgres Outbox como mecanismo inicial de eventos.
- [ADR-0005](./architecture/adr/0005-thin-bff-gateway.md): BFF Gateway burro (apenas roteamento).

---

> Toda mudança relevante no handbook deve gerar uma entrada nova aqui, com a data no topo.
