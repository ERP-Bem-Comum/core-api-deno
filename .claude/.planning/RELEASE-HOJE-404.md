# RELEASE-HOJE — plano de ataque da issue #404

> Guarda-chuva **[#404](https://github.com/ERP-Bem-Comum/core-api/issues/404)** — priorização de **6 frentes** (front pronto, aguardando backend).
> Levantado 2026-07-10. **#404 NÃO é uma feature** — é roadmap de 6 frentes que cruzam 4 módulos.
> Por isso **não existe um único `/speckit-specify`**: `/speckit-specify` só cabe nos 2 módulos novos (reports, statistics). O resto é ticket W0→W3, retomada ou já-feito.

---

## Decomposição reconciliada (realidade × #404)

`src/modules/` hoje = `auth, budget-plans, contracts, financial, notifications, partners, programs`.
**`reports` e `statistics` não existem** → frentes 5 e 6 são greenfield de módulo.

| Fr  | Issue                                           | Módulo                  | Estado REAL                                                                                                                              | Ação                                          | Artefato                         | Tam |
| :-- | :---------------------------------------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------- | :------------------------------- | :-- |
| 3   | **#394** options → 500 (ref não-UUID)           | budget-plans            | Bug strict response-schema. **Pivô**: desbloqueia #319 e #401.                                                                           | Ticket W0→W3                                  | `BGP-OPTIONS-REF-UUID`           | S   |
| 3   | **#401** GET /:id/children (cenários)           | budget-plans            | Cenário criado fica invisível                                                                                                            | Ticket W0→W3                                  | `BGP-SCENARIO-CHILDREN`          | S   |
| 3   | **#372/#373** projeções no GET list             | budget-plans            | Dado já no agregado; só projetar                                                                                                         | Ticket W0→W3 (batch)                          | `BGP-ITEM-PROJECTIONS`           | S   |
| 3   | **#341** hierarquia 3 níveis Centro→Cat→Subcat  | financial/**reference** | `FIN-CATEGORY-HIERARCHY` (#147) entregou só 2 níveis (`parentId`); falta Centro de Custo no topo + legado                                | Ticket W0→W3                                  | `FIN-REFERENCE-HIERARCHY-3LEVEL` | L   |
| 4   | **#319** Consolidado ABC + CSV                  | budget-plans            | ✅ **Código já em `dev`** (`get-consolidated-result.ts` + `get-consolidated-export.ts`). Retorna 0 só por falta de dados de rede (#394). | **Só validar + fechar** após #394             | —                                | —   |
| 1   | **#269** contrapartida na transferência         | financial               | SDD completo na branch `feat/269-transfer-counterpart` (feature 029, plan+tasks, sem PR)                                                 | **Retomar** pipeline `FIN-COUNTERPART-CREATE` | (branch)                         | M   |
| 2   | **#270** vencimento individual do payable       | financial               | Regra: alterar 1 título sem propagar pai↔filhos/impostos                                                                                 | Ticket W0→W3                                  | `FIN-PAYABLE-DUEDATE-ISOLATED`   | M   |
| 5   | **#114** Relatórios (9 slices) + #238/#240/#243 | **reports (novo)**      | Módulo inexistente; portar do legado                                                                                                     | **`/speckit-specify`** → spec 036             | (spec)                           | XL  |
| 6   | **#112** Dashboard + #241/#242 + **#352** BFF   | **statistics (novo)**   | Módulo inexistente; portar `/statistics/dashboard`                                                                                       | **`/speckit-specify`** → spec 037             | (spec)                           | L   |
| —   | **#179** slices de recebíveis                   | —                       | Depende de módulo `receivables` inexistente                                                                                              | **FORA de escopo** (deferred)                 | —                                | —   |

### Nota sobre o ticket ativo `FIN-STRICT-RESPONSE-SCHEMAS`

Está aberto com `000-request.md` **vazio** (órfão). Tema = curadoria de `.strict()` em response schemas — provável **#384**. A **#394 é um caso concreto** dessa curadoria. Decisão: `BGP-OPTIONS-REF-UUID` resolve a #394 pontual em budget-plans; `FIN-STRICT-RESPONSE-SCHEMAS` fica como a política transversal (a escrever/decidir à parte). Não bloqueiam entre si.

---

## Regras de disparo (invariantes — valem para TODA execução)

1. **1 módulo por sessão/worktree** (ADR-0014, anti-padrão #4). Preparar escopos cross-módulo é OK (não toca `src/`); **executar** W0→W3 não é.
2. **Worktree isolada** por frente em `.claude/worktrees/` (já há `384-strict-response` ativa — não misturar).
3. **W0 RED antes de tocar `src/`** (fail-first).
4. **Validação MySQL/Docker sempre no x99**, nunca Docker local no Mac.
5. **W3** = `typecheck` + `format:check` + `lint` + `test` todos verdes. Regressão zero.
6. PRs vão para **`dev`** (linha de integração; go-live aposentada).

---

## Ordem de disparo (maior desbloqueio primeiro)

### ▸ Bloco A — budget-plans quick-wins (COMEÇAR AQUI)

Mesmo módulo → 1 worktree, tickets em sequência.

```bash
# worktree dedicada
claude --worktree   # ou git worktree add .claude/worktrees/404-budget-plans feat/404-budget-plans

pnpm run pipeline:state init BGP-OPTIONS-REF-UUID --size S   # #394 — PIVÔ (desbloqueia #319+#401)
pnpm run pipeline:state init BGP-SCENARIO-CHILDREN --size S  # #401
pnpm run pipeline:state init BGP-ITEM-PROJECTIONS --size S   # #372+#373
```

Após #394 verde → **validar #319** no x99 (código já existe; conferir totais ≠ 0 com dados de rede) e **fechar #319**.

### ▸ Bloco B — financial

```bash
pnpm run pipeline:state init FIN-PAYABLE-DUEDATE-ISOLATED --size M  # #270
# #269: NÃO criar ticket — retomar branch feat/269-transfer-counterpart (FIN-COUNTERPART-CREATE, W0)
```

### ▸ Bloco C — reference (enabler)

```bash
pnpm run pipeline:state init FIN-REFERENCE-HIERARCHY-3LEVEL --size L  # #341
```

### ▸ Bloco D — módulos novos (SDD, sessão dedicada cada)

```bash
# Reports (#114) — cole a feature-description da seção abaixo:
/speckit-specify  → spec 036-reports (9 slices; #238 REP-1, #240 REP-2, #243 REP-4)
# Dashboard (#112) — sessão SEPARADA (outro módulo):
/speckit-specify  → spec 037-statistics-dashboard (#241 DASH-F1, #242 DASH-F5, #352 BFF)
```

---

## Agentes / Skills / MCPs por bloco

| Bloco                     | Skills (por wave)                                                                                                        | Agentes especialistas                                                                           | MCP                                         |
| :------------------------ | :----------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------- | :------------------------------------------ |
| A budget-plans            | `tdd-strategist` (W0) · `ports-and-adapters` (W1) · `code-reviewer` (W2) · `ts-quality-checker` (W3)                     | `fastify-server-expert` + `zod-expert` (par), `drizzle-orm-expert`                              | `mcp__security` (borda HTTP)                |
| B financial               | `tdd-strategist` · `ts-domain-modeler` · `code-reviewer` · `ts-quality-checker`                                          | `drizzle-orm-expert`, `mysql-database-expert`                                                   | `acdg-skills` (regra de domínio)            |
| C reference               | `drizzle-schema-author` · `database-engineer` · `modular-monolith` · `ts-quality-checker`                                | `mysql-database-expert`                                                                         | `acdg-skills`                               |
| D reports/dashboard (SDD) | `requirements-engineer` → `ts-domain-modeler` → `drizzle-schema-author` → `test-pyramid-engineer` → `ts-quality-checker` | `mysql-database-expert` (EXPLAIN read-models agregados), `fastify-server-expert` + `zod-expert` | `acdg-skills` (teoria/ADR), `mcp__security` |

Roteamento sempre via `contratos-orchestrator`. **Um agente OU uma skill por vez.**

---

## Feature-descriptions prontas para `/speckit-specify`

### spec 036 — reports (#114)

> Novo módulo `reports` (read-only, portado do legado `ERP-BACKEND`). Expõe 9 slices de relatório como endpoints HTTP, consumidos por front já mergeado. Slices priorizados nesta entrega: **REP-1 Equipe ABC** (#238, 9 colunas enxutas, RBAC por exceção), **REP-2 Fornecedores sem Contrato** (#240, aproximado, divergência documentada), **REP-4 Posição de Pagamentos** (#243). Read-models de agregação sobre `fin_*`/`par_*` (sem escrever). Recebíveis (#179) FORA — depende de módulo `receivables` inexistente. Isolamento por prefixo (ADR-0014), comunicação cross-módulo só via public-api (ADR-0006).

### spec 037 — statistics-dashboard (#112)

> Novo módulo `statistics`. Porta `/statistics/dashboard` do legado. Slices: **DASH-F1** (#241, KPI Despesas + Top Centro + Distribuição), **DASH-F5** (#242, Fornecedores sem contrato top-5). Compõe `DashboardStatisticsDto` no **BFF** (#352). Agregações KPI sobre read-models financeiros existentes (`fin_payable_view` etc.). Front consome placeholder honesto hoje → liga sozinho ao expor o endpoint.

---

## Itens sem trabalho de código

- **#319** — código em `dev`; validar totais no x99 pós-#394 e fechar a issue.
- **#269** — retomar `feat/269-transfer-counterpart` (SDD pronto); abrir PR ao fim.
- **#179** — deferred, fora do escopo desta release.

---

## Checklist de disparo

- [x] Bloco A: `BGP-OPTIONS-REF-UUID` (#394) → `BGP-SCENARIO-CHILDREN` (#401) → `BGP-ITEM-PROJECTIONS` (#372/#373) — ✅ MERGED (PRs #418/#419/#421), issues CLOSED
- [x] Validar + fechar **#319** pós-#394 — ✅ CLOSED
- [x] Bloco B: `FIN-PAYABLE-DUEDATE-ISOLATED` (#270) — ✅ MERGED (PR #424), #270 CLOSED · #269 ✅ CLOSED
- [x] Bloco C: `FIN-REFERENCE-HIERARCHY-3LEVEL` (#341) — ✅ MERGED (PR #429), #341 CLOSED
- [~] Bloco D — **reports (#114) parcial:** REP-1 #238 (PR #430) · REP-2 #240 (PR #435) · REP-4 #243 (PR #434) ✅ MERGED · **#437** correção semântica do REP-2 → PR #439 aberto · REP-3 `REPORTS-ANALYSIS-PAYABLES` **W1 in-progress** (worktree `reports-analysis-payables`) · restam 5 slices · **#436** (payee_kind) pendente
- [ ] Bloco D — **dashboard (#112):** `/speckit-specify` → spec 037 (não iniciado; #241/#242/#352)
