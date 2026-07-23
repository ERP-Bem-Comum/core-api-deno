[← Voltar para ADRs](./README.md)

# ADR-0055: PostgreSQL como Engine de Persistência (supersedes ADR-0013, ADR-0020)

- **Status:** Accepted
- **Date:** 2026-07-23
- **Deciders:** Arquiteto técnico + Gabriel Aderaldo
- **Supersedes:** [ADR-0013](./0013-mysql-database-engine.md) (MySQL 8 como engine) · [ADR-0020](./0020-mysql-only-supersedes-dual-dialect.md) (MySQL 8.4 como dialeto único)
- **Relacionado:** [ADR-0054](./0054-deno-runtime-supersedes-node.md) (Deno) — decidido no mesmo movimento de re-plataforma.

---

## Contexto

A [inquiry 0023](../../inquiries/0023-language-runtime-reevaluation.md) admitia "simulação explícita de Postgres" como premissa. O spike `spike/0023` mediu o swap MySQL → PostgreSQL **mantendo o Drizzle** (`pg-core`), com schema e dados reais.

Achado central: **o schema sai quase idêntico.** Os mapeamentos canônicos que o ADR-0018/0020 já escolheram — UUID em `varchar(36)`, Money em `bigint`, sem `ENUM`/`JSON`/`AUTO_INCREMENT` — são **portáveis por design**. O `drizzle-kit generate` nos dois dialetos produziu DDL que difere só em sintaxe de dialeto (quoting, `datetime`→`timestamp`, `IN`→`= ANY(ARRAY[])`), e os dados dumpados são idênticos.

## Decisão

**Adotar o PostgreSQL como engine de persistência**, substituindo o MySQL 8.4, mantendo o **Drizzle ORM** (dialeto `pg-core`) e o driver **`postgres.js`** (`drizzle-orm/postgres-js`).

A lista normativa de features do ADR-0020 (SELECT/INSERT/UPDATE/DELETE, JOIN, FK, transações, índices, CHECK, agregações, window functions, CTEs) permanece — todas existem no Postgres. As **proibições** do ADR-0020 (JSON nativo, stored procs/triggers, ENUM nativo, tipos espaciais, AUTO_INCREMENT em PK de domínio) **também permanecem**, mantendo a portabilidade e a disciplina.

## Consequências

### Positivas
- **Schema ~95% idêntico** — a tradução é mecânica: `mysqlTable`→`pgTable`, `datetime`→`timestamp`, `int`→`integer`. Tipos, CHECK, UNIQUE, defaults, nomes: inalterados.
- **LISTEN/NOTIFY** — capacidade que o MySQL não tem. Habilita wake-up push do outbox worker (ADR-0015): latência de entrega de evento de ~500ms–1s (poll) para **~6ms** (medido ao vivo, idêntico em Node/Bun/Deno — é o Postgres empurrando). Encapsulado num port `Waker` (o worker não muda).
- Domínio e aplicação **não mudam** — tudo na camada de adapter/persistence.

### Negativas (os custos reais, medidos)
- **`boolean`** — o MySQL usava `tinyint(1)`; o Postgres tem `boolean` nativo. As ~25 colunas boolean e seus mappers (que liam `1`/`0`) precisam de ajuste para `true`/`false`.
- **Upsert nativo — ~29 arquivos** usam `onDuplicateKeyUpdate` (`ON DUPLICATE KEY UPDATE`, permitido pelo ADR-0020) → precisam virar `.onConflictDoUpdate()` (Postgres). É o ponto onde a query **não** é dialeto-agnóstica.
- **Migrations** — as ~70 tabelas têm migrations em DDL MySQL; um swap regenera todas em `pg-core`. Greenfield onde possível (ambientes dev/QA recriáveis).
- **Lock-in de `postgres.js`/pg** — aceitável (padrão maduro, multi-runtime).

### Neutras
- O `postgres.js` roda em Node, Deno e Bun sem mudança — a escolha de banco é **ortogonal** à de runtime (ADR-0054).

## Alternativas consideradas

- **Manter MySQL 8.4** (ADR-0020) — o `SKIP LOCKED` já existe no MySQL 8, então o outbox funciona; mas **não há LISTEN/NOTIFY** — o wake-up push do outbox é impossível sem broker (que o ADR-0015/YAGNI evita). Rejeitada porque o LISTEN/NOTIFY é o ganho concreto que motiva o swap, e o custo medido é mecânico e localizado (boolean + 29 upserts + migrations), sem tocar domínio.
- **Dual-dialect (ADR-0018, já superseded)** — rejeitada de novo: manter dois dialetos é o custo que o ADR-0020 eliminou; este ADR troca o dialeto, não volta a ter dois.

## Estratégia de migração (strangler-fig, pareada com ADR-0054)

1. **Por módulo:** traduzir `schemas/*.ts` para `pg-core`, ajustar os mappers boolean e os `.onConflictDoUpdate()`, regenerar migrations.
2. **Gate:** a suíte de integração de cada módulo roda contra Postgres real (x99) e deve passar com a mesma assinatura da versão MySQL.
3. **Outbox:** introduzir o port `Waker` — `SleepWaker` (poll, atual) e `NotifyWaker` (Postgres LISTEN/NOTIFY) — sem alterar o `runLoop`.
4. **ETL/legado:** o `postgres.js` + Drizzle `pg` para os readers; o dump comparado provou paridade de dados.

## Referências

- [Inquiry 0023](../../inquiries/0023-language-runtime-reevaluation.md) · [ADR-0015](./0015-mysql-outbox-pattern.md) (outbox) · [ADR-0018](./0018-persistence-dual-dialect-drizzle.md) (mapeamentos canônicos preservados).
- Spike `spike/0023`: comparação de dump MySQL × Postgres + latência LISTEN/NOTIFY medida ao vivo (2026-07-23).
