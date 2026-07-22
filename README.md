# core-api — ERP Bem Comum

Backend do ERP Bem Comum, modelado como **modular monolith**. Vários módulos de negócio coabitam o mesmo processo Node, isolados por pasta + prefixo de tabela (`ctr_*`, `fin_*`, …) e comunicando-se por **eventos via Outbox** (ADR-0014/0015). Cada módulo é desenhado para poder ser extraído como serviço independente no futuro, sem refactor traumático.

> **Stack:** Node.js 24 LTS · TypeScript 6.0 (roadmap TS 7 / compilador nativo — ADR-0009) · ESM (`"type": "module"`, `NodeNext`) · pnpm 11 · Drizzle ORM 0.45 + mysql2 3.22 (MySQL 8.4 — ADR-0020) · **borda HTTP Fastify 5** com Zod **contract-first** + OpenAPI 3.1 (ADR-0025/0027) · storage S3/MinIO (ADR-0019) · auth próprio com JWT ES256 via `jose` (ADR-0024).
>
> **Source of Truth:** [`handbook/`](./handbook/) (`handbook/architecture/adr/` vence tudo). Contexto canônico em [`AGENTS.md`](./AGENTS.md) (o `CLAUDE.md` é stub que o importa). Orquestrador, agentes e skills em [`./.claude/`](./.claude/).
>
> **Regras invariantes:** sempre `pnpm`, nunca `npm` (ADR-0012) · borda HTTP é a UX primária; **a CLI embutida foi retirada** (ADR-0037) — validação E2E é feita via Bruno (ADR-0034/0038).

---

## 🧩 Módulos

Seis Bounded Contexts sob `src/modules/`, cada um com a mesma anatomia (`domain/` → `application/` → `adapters/` → `public-api/`). A comunicação cross-módulo passa **exclusivamente** por `public-api/` + eventos no Outbox (ADR-0006/0014).

| Módulo                                          | Responsabilidade                                                                                                                                           | Borda HTTP                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [`auth`](./src/modules/auth/)                   | Identidade própria + **RBAC por permissão**, login/refresh (JWT ES256), usuários, papéis, reset de senha, foto de perfil — ADR-0024.                       | `/api/v2/auth`, `/api/v1/{users,me,approvers}`   |
| [`contracts`](./src/modules/contracts/)         | Gestão de Contratos — agregados `Contract`/`Amendment`/`Document`, ciclo de vida (pending/active/cancelled — ADR-0023/0039), export CSV. Módulo inaugural. | `/api/v2/contracts`                              |
| [`financial`](./src/modules/financial/)         | Financeiro — títulos/payables, baixa manual, conciliação bancária, remessa CNAB240, extrato/timeline, read-model de fornecedor (ADR-0045).                 | `/api/v2/financial`                              |
| [`partners`](./src/modules/partners/)           | Registry de parceiros — colaboradores, fornecedores, financiadores, geografia/território (soft-delete ADR-0035), ACT (ADR-0036) — ADR-0031.                | `/api/v1/{collaborators,suppliers,financiers,…}` |
| [`programs`](./src/modules/programs/)           | Gestão de programas + logo storage S3/MinIO — spec 008, ADR-0033.                                                                                          | `/api/v1/programs`                               |
| [`notifications`](./src/modules/notifications/) | E-mail transacional — templates + `EmailSender` (Nodemailer/Resend), **consumidor** de eventos de domínio (ADR-0010/0047).                                 | worker `email-dispatch`                          |

---

## 🏗️ Estrutura

Identificadores em **EN** (regra invariante de `AGENTS.md §"Idioma"`). Strings ao humano e mensagens de erro formatadas em PT.

```
src/
├── server.ts                            Entrypoint HTTP — compõe os plugins de cada módulo, graceful shutdown
│
├── shared/                              Cross-módulo, puro (sem regra de negócio)
│   ├── primitives/                      Result<T,E>, Brand<T,Tag>, exhaustive, immutable
│   ├── kernel/                          VOs de domínio compartilhados: cpf, cnpj, money, period, plain-date, user-ref
│   ├── ports/  adapters/                Cross-cutting (Clock + SystemClock/FixedClock)
│   ├── http/                            Shell da borda: app.ts, config.ts, errors.ts, reply.ts (ADR-0028)
│   ├── outbox/                          Worker genérico de Outbox + tipos (ADR-0015)
│   ├── observability/                   correlation id
│   ├── runtime/                         last-resort handlers (uncaught/unhandled)
│   └── utils/                           csv, date, hash, id, string
│
├── modules/<módulo>/                    Bounded Context (auth · contracts · financial · partners · programs · notifications)
│   ├── domain/                          PURO — Result<T,E>, branded, Readonly, sem infra
│   ├── application/
│   │   ├── ports/                       type contracts (Repository, EventBus, Storage, …)
│   │   └── use-cases/                   factory functions (deps) => (input) => Promise<Result>
│   ├── adapters/                        Implementações concretas
│   │   ├── http/                        plugin Fastify, controllers/DTOs, schemas Zod (composition.ts)
│   │   ├── persistence/                 Drizzle + mysql2 (schemas, mappers c/ Result, repos, drivers, migrations)
│   │   ├── outbox/                      append transacional de eventos
│   │   └── storage/, export/, …         conforme o módulo
│   └── public-api/                      Fronteira cross-módulo: http.ts, events.ts, index.ts, permissions.ts, read.ts, migrate.ts
│
├── workers/                             Composition roots de processos longos (ADR-0022/0041)
│   ├── supplier-view-projection/        fin_supplier_view ← eventos do partners (ADR-0045)
│   ├── contract-count-projection/       par_contract_count_view ← eventos do contracts (ADR-0046)
│   └── email-dispatch/                  notifications consome eventos de domínio → EmailSender (ADR-0047)
│   (+ relays de outbox por módulo: contracts/worker, partners/worker)
│
└── jobs/                                Oneshot jobs (ADR-0041)
    ├── contracts/sweeper/               varredura de ciclo de vida de contratos por tempo
    ├── financial/supplier-view-backfill/  backfill do read-model de fornecedor
    └── migrate/                         aplica migrations Drizzle

tests/                                   bdd · e2e · modules · workers · jobs · infra · etl · regression · shared · pipeline …
db/drizzle/                              configs do drizzle-kit por módulo (contracts, auth, partners, programs, financial, notifications)
scripts/                                 ci · e2e (Bruno) · etl · pipeline · seed · setup

handbook/                                Source of Truth — interno ao repo
├── architecture/adr/                    48 ADRs aceitos (IMUTÁVEIS)
├── reference/<tech>/                    typescript · nodejs · drizzle · mysql · mysql2 · docker · pnpm · fastify
│                                        · fastify-plugins · nodemailer · zod · bruno · magalu-cloud · claude-code
├── domain/, domain_questions/, inquiries/, interviews/, research/, reviews/, operations/, …

docs/                                    Doc consolidada IA-friendly (markdown plano) — ver também ./llms.txt
.claude/
├── agents/                              14 agentes especialistas (por tecnologia)
├── skills/                              42 skills (técnicas/disciplinas)
├── rules/                               Regras path-scoped (domain, application, adapters, testing, contracts-module, api-collections)
├── .pipeline/                           Tickets W0→W3 (histórico auditável)
└── hooks/                               pre-commit-typecheck.sh, block-npm.sh, prettier-write.sh, …
```

### Imports cross-pasta

`package.json#imports` declara **subpath imports** nativos (Node, sem transpiler):

```jsonc
"imports": {
  "#src/*": "./src/*",
  "#scripts/*": "./scripts/*"
}
```

Imports relativos e via `#src/*` carregam **a extensão `.ts`** (requisito de `NodeNext` + `allowImportingTsExtensions`):

```ts
import { Money } from '#src/shared/kernel/money.ts';
```

---

## 🌐 Borda HTTP

A UX primária é HTTP (ADR-0037). `src/server.ts` compõe um plugin Fastify por módulo e expõe a API **versionada** (ADR-0033):

- **`/api/v2/…`** — modelo **greenfield** (`auth`, `contracts`, `financial`): plugin direto.
- **`/api/v1/…`** — **espelho do legado** (`partners`, `programs`, gestão de usuários/acessos): superfície compatível com o sistema antigo durante a estratégia strangler-fig (ADR-0001).

Características da borda:

- **Contract-first com Zod 4 + OpenAPI 3.1** (`fastify-zod-openapi` / `zod-openapi`, ADR-0027): o schema valida a entrada **e** gera o contrato. Swagger UI via `@fastify/swagger`/`@fastify/swagger-ui`.
- **Hardening** com `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` (limite dedicado para login/refresh).
- **Auth/RBAC** cross-módulo: `requireAuth` + `authorize`/`hasPermission` exportados pelo `auth` protegem as rotas dos demais módulos.
- **Read/Write split** (ADR-0026): cada módulo aceita `*_DATABASE_URL` (writer) e `*_READER_URL` (réplica; ausente → reusa o writer).
- Drivers `memory` | `mysql` por módulo via env (`<MÓDULO>_DRIVER`), resolvidos por uma única guarda no boot (`src/shared/persistence/module-driver-config.ts`, #456). **Em produção**, driver ausente/inválido ou `mysql` sem `*_DATABASE_URL` **derruba o boot** com exit 78 (`EX_CONFIG`), listando todos os problemas de uma vez — nunca degrada em silêncio (foi o que deixou #374 e #444 mudos). **Fora de produção**, degrada para in-memory com aviso por módulo. `memory` **explícito** é sempre aceito; em produção, avisa.

---

## 🚀 Scripts

> **Sempre `pnpm`, nunca `npm`** (ADR-0012). Versão pinada via `packageManager` + corepack; há hook `PreToolUse(Bash)` que bloqueia `npm`.

```bash
pnpm install                           # respeita pnpm-lock.yaml
pnpm install --frozen-lockfile         # em CI

# Qualidade (parte do gate W3)
pnpm run typecheck                     # tsc --noEmit (strict completo)
pnpm run format:check                  # prettier --check .
pnpm run lint                          # eslint . (flat config, typescript-eslint strict + type-checked)
pnpm test                              # tests/**/*.test.ts via node:test + --experimental-strip-types

# Servidor + processos de background
pnpm run serve                         # sobe a borda HTTP (node src/server.ts); config via env
pnpm run dev                           # overmind start — HTTP + workers juntos (Procfile)
pnpm run worker:outbox                 # relay do outbox de contracts (idem :partners)
pnpm run worker:email-dispatch         # consumidor de e-mail (notifications)
pnpm run worker:supplier-projection    # projeção fin_supplier_view
pnpm run job:migrate                   # aplica migrations
pnpm run job:contracts:sweep           # oneshot: varredura de ciclo de vida de contratos

# Testes de integração (sobem MySQL/MinIO via Docker compose --wait) e E2E HTTP (Bruno)
pnpm run test:integration:financial    # idem :contracts :auth :partners :programs :notifications :storage :etl …
pnpm run test:e2e:auth                 # coleções .bru (idem :contracts :collaborators)
pnpm run test:integration:all          # bruno-all.sh

# Migrations (Drizzle Kit) — uma config por módulo em db/drizzle/
pnpm run db:generate                   # contracts  (idem :auth :partners :programs :financial :notifications)

# Secrets locais p/ docker-compose
pnpm run secrets:setup                 # gera ./secrets/*.txt

# Pipeline fail-first (STATE.json canônico)
pnpm run pipeline:state init <ticket> --size S
pnpm run pipeline:status               # dashboard de todos os tickets
pnpm run pipeline:metrics              # agregações
```

Detalhes completos: [`AGENTS.md §Comandos essenciais`](./AGENTS.md#comandos-essenciais).

---

## 🐳 Ambiente local (Docker Compose)

`compose.yaml` sobe o stack completo com hardening (`read_only`, `cap_drop`, `security_opt`): **MySQL 8.4**, **MinIO** (storage S3-compat dev, ADR-0019), **Mailpit** (captura de e-mail dev), o serviço `http` e os workers/jobs (`outbox-*`, `*-projection`, `email-dispatch`, `contracts-sweeper`, `migrate`). Variantes: `compose.ci.yaml` (CI) e `compose.etl.yaml` (ETL).

---

## 🌊 Como contribuir

Todo trabalho não-trivial passa pela **pipeline 4-wave fail-first** (W0 RED → W1 GREEN → W2 REVIEW → W3 QUALITY), com um ticket em `.claude/.pipeline/<TICKET-ID>/` e `STATE.json` canônico. Bug fix trivial (1-3 linhas) ou config pode ir direto.

- [`./.claude/agents/contratos-orchestrator.md`](./.claude/agents/contratos-orchestrator.md) — **ponto de entrada único**: roteia para agente especialista ou skill e orquestra as waves.
- [`AGENTS.md`](./AGENTS.md) — regras transversais (idioma, hierarquia de fontes, anti-padrões, política de regressão zero).
- [`handbook/architecture/adr/`](./handbook/architecture/adr/) — ADRs aceitos (IMUTÁVEIS).

Achado fora do escopo do ticket atual? Não conserte na hora (scope-creep): registre via skill [`issue-report`](./.claude/skills/issue-report/SKILL.md) (ADR-0040).

---

## 🤖 Painel de agentes especialistas

Cada agente é ancorado num subdir de [`handbook/reference/`](./handbook/reference/) + ADRs vinculantes, invocado pelo `contratos-orchestrator` (um agente **ou** uma skill por turno).

| Agente                                                                         | Tecnologia                          | Status              |
| ------------------------------------------------------------------------------ | ----------------------------------- | ------------------- |
| [`contratos-orchestrator`](./.claude/agents/contratos-orchestrator.md)         | Roteamento + pipeline W0→W3         | ✅ ativo            |
| [`typescript-language-expert`](./.claude/agents/typescript-language-expert.md) | TypeScript 6 / type system          | ✅ ativo            |
| [`nodejs-runtime-expert`](./.claude/agents/nodejs-runtime-expert.md)           | Node 24 / ESM / `node:test`         | ✅ ativo            |
| [`drizzle-orm-expert`](./.claude/agents/drizzle-orm-expert.md)                 | Drizzle ORM + Drizzle Kit           | ✅ ativo            |
| [`mysql-database-expert`](./.claude/agents/mysql-database-expert.md)           | MySQL 8.4 (SQL, índices, locks)     | ✅ ativo            |
| [`mysql2-driver-expert`](./.claude/agents/mysql2-driver-expert.md)             | Driver `mysql2` (pool, auth, TLS)   | ✅ ativo            |
| [`docker-compose-expert`](./.claude/agents/docker-compose-expert.md)           | Docker / Compose / BuildKit         | ✅ ativo            |
| [`pnpm-workspace-expert`](./.claude/agents/pnpm-workspace-expert.md)           | pnpm 11 / supply-chain              | ✅ ativo            |
| [`fastify-server-expert`](./.claude/agents/fastify-server-expert.md)           | Fastify 5 + plugins                 | ✅ ativo (ADR-0025) |
| [`zod-expert`](./.claude/agents/zod-expert.md)                                 | Zod 4 (schemas de borda, ADR-0027)  | ✅ ativo            |
| [`nodemailer-email-expert`](./.claude/agents/nodemailer-email-expert.md)       | Nodemailer SMTP adapter             | ✅ ativo            |
| [`bruno-api-client-expert`](./.claude/agents/bruno-api-client-expert.md)       | Bruno (`.bru`) — E2E HTTP           | ✅ suporte          |
| [`security-backend-expert`](./.claude/agents/security-backend-expert.md)       | Segurança backend (Node/TS/Fastify) | ✅ ativo            |
| [`security-frontend-expert`](./.claude/agents/security-frontend-expert.md)     | Segurança frontend (TanStack/React) | ✅ ativo            |

As **42 skills** cobrem disciplinas aplicadas: `ts-domain-modeler`, `ports-and-adapters`, `drizzle-schema-author`, `modular-monolith`, `pipeline-maestro`, `code-reviewer`, `ts-quality-checker`, `issue-report`, a família **speckit-\*** (spec-driven), as famílias `database-*`, `tdd-*`, `clean-code-*`, `requirements-*`, `web-security-*`, e os scripters `nodejs-fs-scripter`/`nodejs-process-runner`. Tabela completa em [`AGENTS.md §Roteamento`](./AGENTS.md#roteamento-via-contratos-orchestrator).

---

## 📐 Regras transversais (resumo)

- **`throw` proibido** em `domain/` e `application/`. `Result<T, E>` em vez disso (`src/shared/primitives/result.ts`).
- **Sem `class`, sem `this`** — `Readonly<>` types + funções puras + factory functions com deps injetadas.
- **Branded types** para IDs e VOs (`ContractId`, `Money`, `Period`, `Cpf`, `Cnpj`, …).
- **Discriminated unions** + `switch` exaustivo com `const _: never = x` no default (sem `throw`).
- **Imutabilidade absoluta** — mudança por cópia (`{ ...prev, status: 'Cancelled' }`).
- **`import type`** + extensões `.ts` em imports relativos (`NodeNext` + `verbatimModuleSyntax`).
- **Erros são string literal unions** EN kebab-case (`'contract-not-active' | 'amendment-pending'`), não classes.
- **MySQL 8.4 único** em dev/CI/prod via Docker compose (ADR-0020); lista normativa de features SQL permitidas/proibidas.
- **Isolamento de módulo:** importar de outro módulo **só** via `<module>/public-api/` (nunca `domain/`/`application/` alheios) — ADR-0006.
- **Idioma:** código em **EN**; documentação (handbook, ADRs, `.claude/`, `.pipeline/`) em **PT**; strings ao humano em **PT**.

Lista completa em [`AGENTS.md §"Regras invariantes — sintaxe TS"`](./AGENTS.md#regras-invariantes--sintaxe-ts) e nas regras path-scoped de [`.claude/rules/`](./.claude/rules/).

---

## 📋 Status (2026-06-23)

### ✅ Entregue

- **6 módulos** com a mesma anatomia (`domain` → `application` → `adapters` → `public-api`): `auth`, `contracts`, `financial`, `partners`, `programs`, `notifications`.
- **Borda HTTP Fastify** real e versionada (`/api/v2` greenfield + `/api/v1` espelho do legado), contract-first com Zod 4 + OpenAPI 3.1 (ADR-0025/0027/0028/0033). CLI embutida **retirada** (ADR-0037).
- **Auth & RBAC** próprios — JWT ES256 (`jose`), usuários, papéis/permissões, reset de senha, foto de perfil (ADR-0024).
- **Financial** — títulos/payables, baixa manual, conciliação bancária, CNAB240, extrato/timeline, read-model de fornecedor.
- **Eventos cross-módulo** via **Outbox MySQL** (ADR-0015) + **read-models por projeção** idempotente (ADR-0022/0045/0046), processados por **workers dedicados** e **oneshot jobs** (ADR-0041).
- **Persistência** Drizzle + mysql2 sobre MySQL 8.4 único (ADR-0020), com read/write split (ADR-0026). **Storage** S3 + MinIO via `@aws-sdk/client-s3` (ADR-0019). **E-mail** transacional como evento de domínio (ADR-0047).
- **E2E HTTP** via **Bruno** (`scripts/e2e/`, ADR-0034/0038); integração via Docker compose `--wait`.
- **`.claude/` populado:** 14 agentes + 42 skills + tickets W0→W3 em `.pipeline/`; spec-kit em `specs/` (24 features).

### 🟡 Em andamento

- **`024-fin-transactional-outbox`** — outbox transacional do Financeiro (tabela `fin_outbox` espelhando `ctr_outbox`; atomicidade estado+evento na mesma transação, issue #127 / ADR-0015). Ver `specs/024-fin-transactional-outbox/plan.md`.
- **ADR-0048 (Proposed)** — Anticorruption Layer legado↔core, gate das Camadas 0–2 (spike #233 / épico #169).

---

## 📚 Documentação canônica

- **Contexto do projeto:** [`AGENTS.md`](./AGENTS.md) (fonte única; `CLAUDE.md` é stub que importa) + regras path-scoped em [`.claude/rules/`](./.claude/rules/).
- **Doc consolidada (humanos + IA):** [`docs/`](./docs/) e [`llms.txt`](./llms.txt).
- **Decisões formais:** [`handbook/architecture/adr/`](./handbook/architecture/adr/) (48 ADRs IMUTÁVEIS) + [`handbook/CHANGELOG.md`](./handbook/CHANGELOG.md).
- **Domínio de negócio:** [`handbook/domain/`](./handbook/domain/) + [`handbook/domain_questions/`](./handbook/domain_questions/).
- **Tecnologias:** [`handbook/reference/<tech>/`](./handbook/reference/) — cada uma com agente especialista próprio.
- **Orquestrador + agentes + skills:** [`.claude/agents/contratos-orchestrator.md`](./.claude/agents/contratos-orchestrator.md).
  </content>
  </invoke>
