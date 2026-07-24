# AGENTS.md

Guia canônico do projeto para agentes de IA (Claude Code e outros). Esta é a **fonte de verdade única** de contexto do repositório — o `CLAUDE.md` é apenas um stub que importa `@AGENTS.md`. Regras de camada estão escopadas em [`.claude/rules/`](./.claude/rules/) — carregam só quando o agente toca arquivos do diretório alvo (ver `paths:` em cada arquivo). Material de tooling do Claude Code (worktrees, checkpoints, commands, bug #47936) vive em [`.claude/runbooks/claude-code-cheatsheet.md`](./.claude/runbooks/claude-code-cheatsheet.md), fora do contexto default.

---

## IMPORTANTE

- **Nunca `npm`.** Sempre `pnpm` (ADR-0012). Há hook `PreToolUse(Bash)` que bloqueia. Qualquer doc/PR com `npm install`/`npm run` deve ser convertido.

---

## O que é este repositório

`core-api` — backend do ERP Bem Comum, modelado como **modular monolith**. Fase 1 entrega apenas o **módulo Contratos** (`src/modules/contracts/`). Fases futuras adicionam Financeiro e outros, sob o mesmo processo Node mas com isolamento de pasta + comunicação por eventos (handbook §06).

**Stack:** Node.js 24 LTS · TypeScript 6.0 (roadmap TS 7 — ADR-0009) · ESM (`type: "module"`, `NodeNext`) · pnpm · Drizzle ORM com `mysql2` (MySQL 8 — ADR-0020) · CLI como UX primária (nenhum servidor HTTP ainda).

**Source of truth da arquitetura:** [`handbook/`](./handbook/). Quando código e handbook discordam, **o handbook vence**.

---

## Hierarquia de regras (quando duas fontes discordam)

```
1. handbook/architecture/adr/             ← ADRs aceitos, IMUTÁVEIS, vencem tudo
2. handbook/ (domínio, infra, inquiries, reference/<tech>/)
3. Este AGENTS.md + .claude/rules/*.md    (regras transversais e por camada)
4. .claude/agents/<agent>.md              (especialistas em tecnologia)
5. .claude/skills/<skill>/SKILL.md        (como aplicar as regras)
6. .claude/skills/<skill>/references/     (docs externas, citadas, não normativas)
```

Nunca contradizer um ADR aceito — abrir novo ADR que `supersedes` o anterior, registrar em `handbook/CHANGELOG.md`.

**ADRs críticos:**

- [ADR-0002](./handbook/architecture/adr/0002-keep-nodejs-runtime.md) — Node.js como runtime único.
- [ADR-0006](./handbook/architecture/adr/0006-modular-monolith-core-api.md) — Modular monolith + ports & adapters.
- [ADR-0009](./handbook/architecture/adr/0009-node-24-typescript-6-with-7-roadmap.md) — Node 24 + TS 6, plano TS 7.
- [ADR-0010](./handbook/architecture/adr/0010-email-port-adapter-pattern.md) — Email Port/Adapter (Fase 2+).
- [ADR-0011](./handbook/architecture/adr/0011-supply-chain-hardening.md) — Supply-chain (corepack, `only-allow=pnpm`, `approve-builds`).
- [ADR-0012](./handbook/architecture/adr/0012-pnpm-package-manager.md) — `pnpm` é o package manager canônico.
- [ADR-0013](./handbook/architecture/adr/0013-mysql-database-engine.md) — MySQL 8 é o engine de produção.
- [ADR-0014](./handbook/architecture/adr/0014-mysql-database-isolation.md) — Isolamento por prefixo (`ctr_*`, `fin_*`, `outbox`).
- [ADR-0015](./handbook/architecture/adr/0015-mysql-outbox-pattern.md) — Outbox pattern para eventos cross-módulo.
- [ADR-0019](./handbook/architecture/adr/0019-document-storage-s3-with-minio-dev.md) — Document storage AWS S3 + MinIO (dev). `@aws-sdk/client-s3` é o cliente único.
- [ADR-0020](./handbook/architecture/adr/0020-mysql-only-supersedes-dual-dialect.md) — MySQL 8.4 como único dialeto. Lista normativa de features SQL permitidas/proibidas. Supersedes ADR-0018.

---

## Idioma (regra invariante)

| Camada                                                           | Idioma                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------- |
| Código (tipos, funções, variáveis, pastas, arquivos)             | **EN**                                                     |
| Strings ao humano (mensagens da CLI, erros formatados)           | **PT** (via dicionário em `cli/formatters/`)               |
| Documentação (`.claude/`, `.pipeline/`, READMEs, handbook, ADRs) | **PT**                                                     |
| Erros internos (string literal union)                            | **EN kebab-case** — `'contract-not-active'`                |
| Eventos de domínio                                               | **EN passado** — `ContractCreated`, `AmendmentHomologated` |
| IDs de ticket                                                    | **EN** — `CTR-VO-MONEY`, `CTR-STORAGE-PORT`                |
| Commit messages                                                  | **PT** — `feat(contracts): adiciona VO Money`              |

---

## Regras invariantes — sintaxe TS

Regras por camada (domínio, application, adapters, testes, módulo contracts) estão em [`.claude/rules/`](./.claude/rules/) e carregam só quando relevante. Sintaxe global (vale pra todo `.ts`):

- **`import type { X }`** ou `import { type X }` para imports puramente de tipo (`verbatimModuleSyntax`).
- **Extensões `.ts` nos imports relativos** (`allowImportingTsExtensions`). Ex: `import { Money } from '../shared/money.ts'`.
- **Subpath imports `#src/*`** declarados em `package.json#imports`. Ex: `import { Money } from '#src/modules/contracts/domain/shared/money.ts'`.
- **`tsconfig.json` strict completo:** `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `noImplicitReturns`, `exactOptionalPropertyTypes`, `useUnknownInCatchVariables`, `isolatedModules`, `verbatimModuleSyntax`.

---

## Pipeline fail-first W0→W3

**Toda mudança em código de produção** abre um ticket em `.claude/.pipeline/<TICKET-ID>/`. Bug fix trivial (1-3 linhas) ou mudança de config pode ir direto.

```
.claude/.pipeline/<TICKET-ID>/
├── 000-request.md           # escopo (humano escreve antes)
├── STATE.json               # canônico — gerenciado por `pnpm run pipeline:state` (CTR-PIPELINE-STATE-JSON)
├── STATE.md                 # gerado de STATE.json — não editar à mão
├── 002-tests/REPORT.md      # W0 — testes RED (falham por inexistência da API)
├── 003-impl/REPORT.md       # W1 — implementação mínima até GREEN
├── 004-code-review/REVIEW.md  # W2 — audit read-only (max 3 rounds)
└── 005-quality/REPORT.md    # W3 — tsc + format + tests + build
```

**Disciplina:** W0 RED antes de tocar `src/`. W1 implementa o mínimo. W2 read-only, max 3 rounds antes de escalar. W3 = `pnpm run typecheck` + `pnpm run format:check` + `pnpm test` todos verdes.

**STATE.json é canônico** a partir de `CTR-PIPELINE-STATE-JSON`. Tickets novos usam `pnpm run pipeline:state init <ticket> --size <X>` em vez de criar `STATE.md` à mão. Tickets legados (sem `STATE.json`) continuam válidos como histórico.

Tickets fechados em `.claude/.pipeline/` são histórico auditável — **não deletar**.

---

## Roteamento via `contratos-orchestrator`

[`./.claude/agents/contratos-orchestrator.md`](./.claude/agents/contratos-orchestrator.md) é o **ponto de entrada único**. Identifica intenção, decide se delega para um **agente especialista** (tecnologia) ou para uma **skill** (técnica/disciplina), e orquestra as 4 waves.

### Agentes especialistas (por tecnologia em `handbook/reference/`)

Carrega **um único** agente por turno.

| Quando o tema é…                                                                                         | Agente                                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Roteamento + pipeline W0→W3                                                                              | [`contratos-orchestrator`](./.claude/agents/contratos-orchestrator.md)         |
| TypeScript / type system / Modules / tsconfig                                                            | [`typescript-language-expert`](./.claude/agents/typescript-language-expert.md) |
| Node.js runtime / `node:test` / ESM / signals / AsyncLocalStorage                                        | [`nodejs-runtime-expert`](./.claude/agents/nodejs-runtime-expert.md)           |
| Deno runtime / `deno.json` / permissões `--allow-*` / specifiers `jsr:`/`npm:` (cutover — ADR-0054/0056) | [`deno-runtime-expert`](./.claude/agents/deno-runtime-expert.md)               |
| Drizzle ORM (schema, query builder, Drizzle Kit, transações)                                             | [`drizzle-orm-expert`](./.claude/agents/drizzle-orm-expert.md)                 |
| MySQL puro (EXPLAIN, índice, locks, tuning, replicação)                                                  | [`mysql-database-expert`](./.claude/agents/mysql-database-expert.md)           |
| Driver `mysql2` (pool, `caching_sha2_password`, TLS, timeouts)                                           | [`mysql2-driver-expert`](./.claude/agents/mysql2-driver-expert.md)             |
| Docker / Compose / Dockerfile / BuildKit                                                                 | [`docker-compose-expert`](./.claude/agents/docker-compose-expert.md)           |
| pnpm / lockfile / supply-chain / corepack                                                                | [`pnpm-workspace-expert`](./.claude/agents/pnpm-workspace-expert.md)           |
| Fastify (borda HTTP — **ativo**, ADR-0025; UX primária, ADR-0037)                                        | [`fastify-server-expert`](./.claude/agents/fastify-server-expert.md)           |
| Nodemailer (adapter SMTP — **ativo** desde `CTR-EMAIL-ADAPTER-NODEMAILER`)                               | [`nodemailer-email-expert`](./.claude/agents/nodemailer-email-expert.md)       |
| Segurança backend web (Node/TS/Fastify/pnpm/Magalu)                                                      | [`security-backend-expert`](./.claude/agents/security-backend-expert.md)       |
| Segurança frontend web (TanStack Start/React)                                                            | [`security-frontend-expert`](./.claude/agents/security-frontend-expert.md)     |
| Bruno API client (coleções `.bru` que testam a borda HTTP — **suporte, sem ADR**)                        | [`bruno-api-client-expert`](./.claude/agents/bruno-api-client-expert.md)       |

### Skills (técnicas/disciplinas aplicadas)

> **Discovery de skills (Kimi Code):** as skills vivem em `.claude/skills/`; o Kimi (Node) as descobre
> via o **symlink versionado `.agents/skills → ../.claude/skills`** (não auto-descobre `.claude/skills/`
> direto). Se as skills `/skill:*` não aparecerem, confira o symlink `.agents/skills` ou adicione
> `extra_skill_dirs = [".claude/skills"]` no seu `~/.kimi-code/config.toml`. No Claude Code, são nativas.

| Atividade                                                            | Skill                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Modelar agregado/VO/evento de domínio                                | [`ts-domain-modeler`](./.claude/skills/ts-domain-modeler/SKILL.md)                                                                                                                                                             |
| Definir port (Repository, EventBus, Storage, Clock)                  | [`ports-and-adapters`](./.claude/skills/ports-and-adapters/SKILL.md)                                                                                                                                                           |
| Modelar schema Drizzle (`mysqlTable`, índices, FKs)                  | [`drizzle-schema-author`](./.claude/skills/drizzle-schema-author/SKILL.md)                                                                                                                                                     |
| Contratos entre módulos (`ctr_*` ↔ `fin_*` via outbox)               | [`modular-monolith`](./.claude/skills/modular-monolith/SKILL.md)                                                                                                                                                               |
| ~~Subcomando de CLI~~ (aposentado — ADR-0037; CLI embutida removida) | —                                                                                                                                                                                                                              |
| Scripts FS em Node 24 + strip-types                                  | [`nodejs-fs-scripter`](./.claude/skills/nodejs-fs-scripter/SKILL.md)                                                                                                                                                           |
| Invocar processos externos (git, docker, pnpm…)                      | [`nodejs-process-runner`](./.claude/skills/nodejs-process-runner/SKILL.md)                                                                                                                                                     |
| Modelagem aplicada de DB (DDL + EXPLAIN)                             | [`database-engineer`](./.claude/skills/database-engineer/SKILL.md)                                                                                                                                                             |
| Ensino conceitual / fundamentos de DB                                | [`database-tutor`](./.claude/skills/database-tutor/SKILL.md) · [`database-theorist`](./.claude/skills/database-theorist/SKILL.md)                                                                                              |
| TDD aplicado / tutor / fundamentos                                   | [`tdd-strategist`](./.claude/skills/tdd-strategist/SKILL.md) · [`tdd-tutor`](./.claude/skills/tdd-tutor/SKILL.md) · [`tdd-theorist`](./.claude/skills/tdd-theorist/SKILL.md)                                                   |
| Arquitetura da suíte (camada/double/cobertura/gating)                | [`test-pyramid-engineer`](./.claude/skills/test-pyramid-engineer/SKILL.md)                                                                                                                                                     |
| Code review / Clean Code / fundamentos                               | [`clean-code-reviewer`](./.claude/skills/clean-code-reviewer/SKILL.md) · [`clean-code-tutor`](./.claude/skills/clean-code-tutor/SKILL.md) · [`clean-code-theorist`](./.claude/skills/clean-code-theorist/SKILL.md)             |
| Engenharia de requisitos (aplicada / tutor / theorist)               | [`requirements-engineer`](./.claude/skills/requirements-engineer/SKILL.md) · [`requirements-tutor`](./.claude/skills/requirements-tutor/SKILL.md) · [`requirements-theorist`](./.claude/skills/requirements-theorist/SKILL.md) |
| Threat modeling / OWASP AI (reservado p/ Fase 2+ com IA)             | [`security-reviewer`](./.claude/skills/security-reviewer/SKILL.md)                                                                                                                                                             |
| Segurança backend aplicada (Node/Fastify/pnpm/Magalu)                | [`web-security-backend`](./.claude/skills/web-security-backend/SKILL.md)                                                                                                                                                       |
| Segurança frontend aplicada (TanStack Start/React)                   | [`web-security-frontend`](./.claude/skills/web-security-frontend/SKILL.md)                                                                                                                                                     |
| Executar pipeline W0→W3 de um ticket                                 | [`pipeline-maestro`](./.claude/skills/pipeline-maestro/SKILL.md)                                                                                                                                                               |
| Revisão read-only (W2)                                               | [`code-reviewer`](./.claude/skills/code-reviewer/SKILL.md)                                                                                                                                                                     |
| Gate final de qualidade (W3)                                         | [`ts-quality-checker`](./.claude/skills/ts-quality-checker/SKILL.md)                                                                                                                                                           |

**Regra:** um agente OU uma skill por vez. Outros viram referência via `[[link]]`. Quando a tarefa cruza tecnologias, o orquestrador escolhe o mais especializado.

---

## Comandos essenciais

```bash
# Setup
pnpm install                  # respeita pnpm-lock.yaml + corepack
pnpm install --frozen-lockfile  # CI

# Qualidade (parte do W3)
pnpm run typecheck            # tsc --noEmit
pnpm run format:check         # prettier --check .
pnpm run lint                 # eslint . (flat config, typescript-eslint strict + stylistic + type-checked)
pnpm test                     # tests/**/*.test.ts via node:test + --experimental-strip-types
pnpm run test:integration     # sobe MySQL via Docker compose --wait

# Servidor HTTP (UX primária — ADR-0037) + worker de outbox
node src/server.ts             # sobe a borda HTTP (Fastify); config via env (CONTRACTS_DATABASE_URL etc.)
pnpm run worker:outbox         # worker do outbox em foreground; env CONTRACTS_DATABASE_URL + OUTBOX_*
# (CLI embutida removida — CLI-RETIRE-EMBEDDED / ADR-0037. Validação E2E via Bruno + fastify.inject.)

# Migrations + secrets
pnpm run db:generate          # Drizzle Kit → src/modules/contracts/adapters/persistence/migrations/mysql/
pnpm run secrets:setup        # gera ./secrets/*.txt para docker-compose

# Pipeline state (CTR-PIPELINE-STATE-JSON)
pnpm run pipeline:state init <ticket> --size S
pnpm run pipeline:state wave-start <ticket> W0 --agent tdd-strategist
pnpm run pipeline:state wave-finish <ticket> W0 --outcome RED --report 002-tests/REPORT.md
pnpm run pipeline:state wave-round <ticket> W2     # incrementa round (max 3)
pnpm run pipeline:state wave-reopen <ticket> W2    # reabre wave done+REJECTED → in-progress (round++, max 3)
pnpm run pipeline:state close <ticket>             # exige todas as 4 waves done
pnpm run pipeline:state render <ticket>            # regenera STATE.md de STATE.json

# Pipeline dashboard (CTR-PIPELINE-DASHBOARD)
pnpm run pipeline:status                    # tabela markdown de todos os tickets com STATE.json
pnpm run pipeline:status --filter open      # só open + in-progress
pnpm run pipeline:status --filter closed    # só closed-green + closed-rejected
pnpm run pipeline:status --json             # output JSON para tooling

# Pipeline metrics (CTR-PIPELINE-METRICS)
pnpm run pipeline:metrics                   # markdown com agregações
pnpm run pipeline:metrics --json            # JSON
pnpm run pipeline:metrics --write           # grava em .claude/.pipeline/_METRICS.md
```

Pre-commit hook: `.claude/hooks/pre-commit-typecheck.sh` (ativar via `git config core.hooksPath .claude/hooks`).

---

## Hooks ativos em `.claude/settings.json`

| Evento                                 | Script                      | Função                                                        |
| -------------------------------------- | --------------------------- | ------------------------------------------------------------- |
| `SessionStart`                         | `session-start-context.sh`  | Resumo do estado do projeto no boot.                          |
| `UserPromptSubmit`                     | `inject-ticket-context.sh`  | Injeta STATE.md do ticket ativo.                              |
| `PreToolUse(Bash)` if `Bash(npm *)`    | `block-npm.sh`              | Bloqueia `npm` (ADR-0012).                                    |
| `PostToolUse(Edit\|Write)`             | `prettier-write.sh`         | Formata o arquivo tocado.                                     |
| `Stop` (async)                         | `stop-typecheck.sh`         | Typecheck em background no fim.                               |
| `SubagentStop(contratos-orchestrator)` | `subagent-stop-validate.sh` | Detecta Bug #47936; log em `.claude/.last-subagent-stop.log`. |

---

## Anti-padrões (não fazer)

1. **Carregar múltiplos agentes/skills simultaneamente** sem necessidade — orquestrador escolhe **um**.
2. **Duplicar regras** que já vivem no handbook ou em SKILL.md / agent.md — referencie, não copie.
3. **Pular waves** (ir direto pra W1 sem W0 RED) — quebra o fail-first.
4. **Misturar módulos** numa sessão (`ctr_*` e `fin_*` ao mesmo tempo) — ofende ADR-0014.
5. **Editar ADR aceito** — cria novo que `supersedes` o anterior.
6. **Editar código não-trivial sem ticket** em `.claude/.pipeline/<TICKET>/000-request.md`.
7. **`throw new Error(...)` no `default` de switch exhaustivo** — usar `const _: never = x` apenas.
8. **`import` sem extensão `.ts`** — `NodeNext` exige caminho completo.
9. **`import` de tipo sem `type`** — `verbatimModuleSyntax` exige `import type { X }` ou `import { type X }`.
10. **`npm` em qualquer doc, script, PR ou comentário** — sempre `pnpm` (ADR-0012).
11. **Ativar um agente marcado como reservado** sem antes abrir o ADR de adoção da tecnologia.
12. **Citar `.mdx`/`.md` do handbook "de memória"** — abrir o arquivo e citar literalmente.
13. **Importar de `<module>/domain/` ou `<module>/application/` de outro módulo** — usar exclusivamente `<module>/public-api/` (ADR-0006).
14. **Dispensar vermelho como "não é meu erro"** — ver §"Política de regressão zero" abaixo. É o anti-padrão mais grave: terminar wave/ticket/turn com falha não-endereçada.
15. **Consertar no meio do caminho um problema fora do escopo do ticket atual** (scope-creep) — em vez disso, registre-o via skill [`issue-report`](.claude/skills/issue-report/SKILL.md) (GitHub Issue testável, com critérios de aceite + dedup) e siga o ticket corrente. Não perca o achado **nem** desvie o foco (ADR-0040).

---

## Política de regressão zero (invariante de processo)

**Não existe "o erro não é meu".** Qualquer falha que apareça numa sessão — teste vermelho, `lint`, `typecheck`, hook, build, gate W3 — é tratada como **regressão a corrigir AGORA**, tenha ou não sido causada pelo diff atual. "Erro ambiental", "já estava quebrado antes" e "não toquei nessa parte" **não** são desculpas para fechar com vermelho.

Diante de uma falha, exatamente uma destas saídas é aceitável:

1. **Consertar a causa** — o código/teste volta ao verde de verdade.
2. **Corrigir o gate que classifica errado** — quando a falha é um teste mal-gateado (ex.: integração que roda em `pnpm test` puro em vez de atrás de opt-in `*_INTEGRATION=1`), conserta-se o gate **e prova-se** que o caminho correto (`pnpm run test:integration:*`) fica verde. Nunca se "esconde" atrás de um `skip` sem provar que o teste passa no home dele.
3. **Escalar ao humano** com diagnóstico da causa-raiz — só quando 1 e 2 estão fora do alcance/escopo, e sempre explícito, nunca silencioso.

Fechar `pnpm test`/W3 com falha não-endereçada (mesmo que "alheia") é o anti-padrão #14. O backstop mecânico é o gate W3 (`typecheck` + `format:check` + `lint` + `test`) e o hook `Stop` (`stop-typecheck.sh`) — mas a disciplina é de julgamento, não delegável ao hook.

---

## Onde mais procurar

- **Regras por camada (path-scoped):** [`.claude/rules/`](./.claude/rules/) — domain, application, adapters, testing, módulo contracts. Carregam sob demanda.
- **Cheatsheet do Claude Code:** [`.claude/runbooks/claude-code-cheatsheet.md`](./.claude/runbooks/claude-code-cheatsheet.md) — `/clear`, `/compact`, `/rewind`, `/btw`, `/recap`, `!` prefix, `--from-pr`, worktrees, checkpoints, bug #47936, cache invalidation. Abrir sob demanda.
- **Output style do projeto:** [`.claude/output-styles/erp-contracts.md`](./.claude/output-styles/erp-contracts.md) — idioma PT/EN por camada, citação literal do handbook, commit PT-BR. Ativo em `.claude/settings.json#outputStyle`. Aplica após `/clear` ou nova sessão.
- **Statusline rica:** [`.claude/statusline.sh`](./.claude/statusline.sh) — modelo + ticket ativo + branch + PR + cache hit ratio + cost + rate limits. Atualiza após cada turn, cacheia git + ticket por 5s.
- **`.worktreeinclude`:** [`.worktreeinclude`](./.worktreeinclude) — arquivos gitignored copiados automaticamente em todo novo `claude --worktree` (secrets/, .env).
- **Auto memory:** `~/.claude/projects/<hash>/memory/MEMORY.md` (carregado integral no startup). Lições registradas: `pnpm always`, `Outbox MySQL planning paused`, `Announce skill+path before invoking`, `Maestro plugin blocked`, `Sub-agent #47936 mitigation`. Doc: [`handbook/reference/claude-code/memory.md`](./handbook/reference/claude-code/memory.md).
- **Referências de tecnologia:** [`handbook/reference/<tech>/`](./handbook/reference/) — typescript, nodejs, drizzle, mysql, mysql2, docker, pnpm, fastify, nodemailer. Cada subdir tem agente especialista próprio (tabela acima).
- **Domínio formal:** [`handbook/domain_questions/contratos/`](./handbook/domain_questions/contratos/) e [`handbook/domain/`](./handbook/domain/).
- **Planejamento pausado:** [`.claude/.planning/`](./.claude/.planning/) — `OUTBOX-MYSQL.md`, `SUBAGENT-INTERRUPTION-FIX.md`.

---

## Material local-only — `handbook/guidelines/`

[`handbook/guidelines/`](./handbook/guidelines/) é **local-only** (em `.gitignore`). Contém PDFs Bradesco para integração CNAB/Pix/WebService com restrição de redistribuição. **Leitura autorizada localmente** — não copiar trechos para código commitável. Referenciar explicitamente (`@handbook/guidelines/bradesco_guideline/...`) quando o contexto exigir.
