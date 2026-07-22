# Quality Check — Ticket SHARED-DRIVER-BOOT-GUARD (#456)

**Skill:** ts-quality-checker
**Data:** 2026-07-22T16:19Z
**Branch:** `fix/456-driver-boot-guard` (worktree dedicado)
**Veredito final:** ✅ **GREEN**

| #   | Check                                     | Status     | Detalhes                                                  |
| :-- | :---------------------------------------- | :--------- | :-------------------------------------------------------- |
| 1   | Type check (`pnpm run typecheck`)         | ✅         | exit 0, zero erros                                         |
| 2   | Format check (`pnpm run format:check`)    | ✅         | "All matched files use Prettier code style!"               |
| 2b  | Lint (`pnpm run lint`)                    | ✅         | exit 0, zero erros/warnings (execução comprovada)          |
| 3   | Testes (`pnpm test`)                      | ✅         | **tests 4325 · pass 4306 · fail 0 · skipped 19 · todo 0**  |
| 4   | Build                                     | ⏭️ SKIPPED | Roda via `--experimental-strip-types`, sem alvo `dist/`    |
| 5   | Fumaça do `quickstart.md` (stdio em pipe) | ✅         | 7 mensagens + `exit=78` (`EX_CONFIG`)                      |

**Política de regressão zero respeitada:** `fail 0` em todos os checks. Nenhum vermelho apareceu —
nada precisou ser consertado, nada foi afrouxado, nenhum teste foi deletado, marcado `skip`/`todo`
ou relaxado. Contagem bate exatamente com o previsto: baseline `dev` 4308 + 17 do ticket = **4325**.

> **Nota de execução (armadilha de falso-verde):** todos os comandos rodaram com o cwd **dentro do
> worktree**. Rodar `eslint` a partir da raiz do repositório principal apontando para um caminho em
> `.claude/worktrees/` retorna exit 0 **sem lintar nada**, porque o flat config tem `.claude/**` em
> `ignores`. Dentro do worktree o padrão `.claude/**` resolve para `<worktree>/.claude/**` e o
> `src/`/`tests/` do ticket são lintados normalmente — comprovado no Check 2b.

---

## Saída integral

### Check 1 — `pnpm run typecheck`

```
$ tsc --noEmit
EXIT=0
```

(sem nenhuma linha de diagnóstico — zero erros)

### Check 2 — `pnpm run format:check`

```
$ prettier --check .
Checking formatting...
All matched files use Prettier code style!
EXIT=0
```

### Check 2b — `pnpm run lint`

```
$ eslint .
EXIT=0
```

(sem nenhuma linha — zero erros e zero warnings)

#### Prova de que o lint realmente processou os arquivos do ticket

Exit 0 sozinho não distingue "limpo" de "ignorado". Rodando `eslint` com `--format json` sobre os
quatro arquivos tocados, cada um aparece como **resultado processado** (um objeto por arquivo, sem
o aviso `File ignored because of a matching ignore pattern`):

```
$ pnpm exec eslint src/shared/persistence/module-driver-config.ts \
    tests/shared/persistence/module-driver-config.test.ts \
    src/server.ts \
    src/modules/reports/adapters/http/composition.ts --format json

<worktree>/src/modules/reports/adapters/http/composition.ts      | errors=0 warnings=0 source_linted=true
<worktree>/src/server.ts                                         | errors=0 warnings=0 source_linted=true
<worktree>/src/shared/persistence/module-driver-config.ts        | errors=0 warnings=0 source_linted=true
<worktree>/tests/shared/persistence/module-driver-config.test.ts | errors=0 warnings=0 source_linted=true
```

### Check 3 — `pnpm test`

Suíte completa, sem Docker, sem nenhuma variável de opt-in de integração. Rodada **duas vezes**
(reprodutível, exit 0 nas duas; a segunda com log integral de 6895 linhas). Sumário literal:

```
ℹ tests 4325
ℹ suites 1238
ℹ pass 4306
ℹ fail 0
ℹ cancelled 0
ℹ skipped 19
ℹ todo 0
ℹ duration_ms 92340.270417
```

Primeira execução (mesmo resultado, tempo diferente):

```
ℹ tests 4325
ℹ suites 1238
ℹ pass 4306
ℹ fail 0
ℹ cancelled 0
ℹ skipped 19
ℹ todo 0
ℹ duration_ms 91158.006125
```

#### Bloco literal da suíte do ticket dentro da rodada completa

```
▶ SHARED-DRIVER-BOOT-GUARD — US1: deploy incompleto e barrado antes de servir trafego
  ✔ caso 1 — producao + driver ausente: erro nomeia o modulo E a variavel (#374) (0.609083ms)
  ✔ caso 2 — producao + mysql sem URL: erro nomeia a variavel de endereco (0.100417ms)
  ✔ caso 3 — producao + typo no driver (mysqll): erro cita o valor recebido e os aceitos (0.116333ms)
  ✔ caso 4 — producao + configuracao completa: ok, os 7 modulos em mysql, sem aviso (FR-009) (0.347417ms)
  ✔ caso 9 — variavel vazia conta como AUSENTE, nunca como valor invalido (0.161875ms)
  ✔ caso 10 — NODE_ENV ausente nao e producao: regra permissiva, sem erro (0.083291ms)
✔ SHARED-DRIVER-BOOT-GUARD — US1: deploy incompleto e barrado antes de servir trafego (1.941834ms)
▶ SHARED-DRIVER-BOOT-GUARD — US2: diagnostico completo numa unica tentativa
  ✔ caso 5 — producao + 3 modulos quebrados: exatamente 3 erros no MESMO retorno (0.134375ms)
  ✔ caso 6 — um modulo com 2 problemas simultaneos: ambos aparecem no retorno (0.082459ms)
  ✔ caso 11 — reports: as 4 fontes resolvidas por CASCATA (overrides ausentes) devolvem ok (0.109583ms)
  ✔ caso 12 — reports com 1 fonte que nao resolve: erro ACUMULADO, nunca isolado (FR-012) (0.11875ms)
✔ SHARED-DRIVER-BOOT-GUARD — US2: diagnostico completo numa unica tentativa (0.565334ms)
▶ SHARED-DRIVER-BOOT-GUARD — US3: dev/testes sem fricção e degradações com ADR intactas
  ✔ caso 7 — fora de producao + nada configurado: ok em memory + 1 aviso por modulo degradado (0.122709ms)
  ✔ caso 8 — memory EXPLICITO em producao: ok, sem erro (FR-007) (0.058708ms)
  ✔ caso 13 — CRITICO: replica de leitura ausente NAO e erro (ADR-0026, FR-008) (0.062667ms)
  ✔ caso 14 — CRITICO: composicao de programa indisponivel nao derruba o boot (ADR-0032, FR-008) (0.102834ms)
✔ SHARED-DRIVER-BOOT-GUARD — US3: dev/testes sem fricção e degradações com ADR intactas (0.431417ms)
▶ SHARED-DRIVER-BOOT-GUARD — invariante de credencial (W2 M3/S1)
  ✔ caso 15 — URL colada na variavel de DRIVER por engano nao vaza credencial na mensagem (0.078875ms)
  ✔ caso 16 — valor de driver com quebra de linha nao forja linha no stderr (CWE-117) (0.0465ms)
  ✔ caso 17 — nenhum aviso ecoa valor de endereco de conexao (0.061708ms)
✔ SHARED-DRIVER-BOOT-GUARD — invariante de credencial (W2 M3/S1) (0.238708ms)
```

Executando **só** o arquivo do ticket, para isolar a contagem:

```
$ node --test --experimental-strip-types --enable-source-maps --no-warnings \
    tests/shared/persistence/module-driver-config.test.ts
ℹ tests 17
ℹ suites 4
ℹ pass 17
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 107.618792
```

### Check 4 — Build

```
SKIPPED — o projeto roda via `--experimental-strip-types` (ADR-0002/ADR-0009); não há alvo `dist/`.
O `tsc --noEmit` do Check 1 é o gate de compilação.
```

---

## Contagem de testes: baseline → atual

| Origem                                               |   Testes |
| :--------------------------------------------------- | -------: |
| Baseline `dev`                                       | **4308** |
| + W0 (`002-tests/REPORT.md`, casos 1–14)             |    +14   |
| + W2 round 3 (invariante de credencial, casos 15–17) |     +3   |
| **Esperado**                                         | **4325** |
| **Medido (`pnpm test`)**                             | **4325** ✅ |

Aritmética fecha nos dois sentidos: `4325 − 17 = 4308` e a rodada isolada do arquivo novo dá
exatamente `tests 17`. **Divergência zero.**

### Prova de que nada foi afrouxado

1. **Nenhum arquivo de teste rastreado foi tocado.** `git diff dev --stat -- tests/` retorna **vazio**:

   ```
   $ git diff dev --stat -- tests/
   (sem saída)
   ```

2. **Nenhum arquivo foi deletado** em relação à `dev`:

   ```
   $ git diff dev --diff-filter=D --name-only
   (sem saída)
   ```

3. **O diff completo contra a `dev` toca 4 arquivos, nenhum sob `tests/`:**

   ```
   $ git diff dev --name-status
   M	.specify/feature.json
   M	README.md
   M	src/modules/reports/adapters/http/composition.ts
   M	src/server.ts
   ```

   Logo, o único delta possível na suíte é **aditivo**: o arquivo novo
   `tests/shared/persistence/module-driver-config.test.ts` (ainda não rastreado).

4. **O arquivo de teste novo não tem um único `skip`/`todo`:**

   ```
   $ grep -rnE "\.(skip|todo)\b|\{\s*skip:|\{\s*todo:|it\.skip|test\.skip|describe\.skip" \
       tests/shared/persistence/module-driver-config.test.ts
   (sem saída — exit 1)
   ```

   Confirmado também pelo sumário da rodada isolada: `skipped 0`, `todo 0` nos 17 casos.

5. **Os 19 `skipped` da suíte completa são todos gates de integração pré-existentes**, presos a
   opt-in de ambiente (`PARTNERS_ETL_INTEGRATION`, `COMPOSE_INTEGRATION`, `MYSQL_INTEGRATION`,
   `STORAGE_INTEGRATION`, `NOTIFICATIONS_INTEGRATION`) ou a fixtures gitignored (LGPD). Nenhum é
   deste ticket. Marcadores literais da rodada:

   ```
   ﹣ BUDGET-PLANS ETL integration — legado -> bgp_* # PARTNERS_ETL_INTEGRATION!=1 ou ETL_LEGACY_CONNECTION_STRING ausente
   ﹣ readLegacyContractsData (integração, fixture via mysql2) # PARTNERS_ETL_INTEGRATION!=1 ou ETL_LEGACY_CONNECTION_STRING ausente
   ﹣ CONTRACTS WRITER integration — legado → core-api destino # PARTNERS_ETL_INTEGRATION!=1 ou ETL_LEGACY_CONNECTION_STRING ausente
   ﹣ FINANCIAL WRITER integration — legado → core-api destino # PARTNERS_ETL_INTEGRATION!=1 ou ETL_LEGACY_CONNECTION_STRING ausente
   ﹣ READER integration — fixture (mysql2) → read → decode # PARTNERS_ETL_INTEGRATION!=1 ou ETL_LEGACY_CONNECTION_STRING ausente
   ﹣ ORCHESTRATOR integration — legado → core-api (2 DBs) # PARTNERS_ETL_INTEGRATION!=1 ou ETL_LEGACY_CONNECTION_STRING/ETL_CORE_CONNECTION_STRING ausentes
   ﹣ CTR-DB-COMPOSE-MYSQL — CA-2: falha sem secrets # COMPOSE_INTEGRATION!=1 — rode `pnpm run test:integration:infra`
   ﹣ CTR-DB-COMPOSE-MYSQL — bootstrap completo (CA-3..CA-19) # COMPOSE_INTEGRATION!=1 — rode `pnpm run test:integration:infra`
   ﹣ SKIP - STORAGE_INTEGRATION=1 desligado # SKIP
   ﹣ skip: MYSQL_INTEGRATION≠1 (sem Docker) # MYSQL_INTEGRATION≠1
   ﹣ CA-10: aplicar migration contra MySQL retorna exit 0 # MYSQL_INTEGRATION≠1 (rode `pnpm test:integration`)
   ﹣ CA-11: information_schema.tables lista as 3 tabelas ctr_* # MYSQL_INTEGRATION≠1 (rode `pnpm test:integration`)
   ﹣ CA-12: information_schema.check_constraints contém os 7 CHECKs # MYSQL_INTEGRATION≠1 (rode `pnpm test:integration`)
   ﹣ CA-13: INSERT que viola F-L1 (status=Active com ended_at populado) é rejeitado # MYSQL_INTEGRATION≠1
   ﹣ CA-14: INSERT que viola F-L2 (status=Homologated sem completude) é rejeitado # MYSQL_INTEGRATION≠1
   ﹣ CA-11: SELECT @@session.time_zone retorna +00:00 após openMysql # MYSQL_INTEGRATION≠1
   ﹣ CA-12: openMysql sem applyMigrations NÃO aplica migrations (M5 prod-safe) # MYSQL_INTEGRATION≠1
   ﹣ CA-5: openMysql contra container healthy retorna ok(handle) # MYSQL_INTEGRATION≠1
   ﹣ CA-6: openMysql contra credenciais inválidas retorna mysql-driver-connect-failed # MYSQL_INTEGRATION≠1
   ﹣ CA-7: openMysql com string mal-formada retorna mysql-driver-connection-string-invalid # MYSQL_INTEGRATION≠1
   ﹣ CA-8: openMysql com applyMigrations: true é idempotente (duas chamadas seguidas) # MYSQL_INTEGRATION≠1
   ﹣ SKIP - MYSQL_INTEGRATION=1 desligado # SKIP
   ﹣ SKIP - STORAGE_INTEGRATION=1 desligado # SKIP
   ﹣ sem fixtures reais na pasta gitignored — pulando (CI/ambiente sem os PDFs) # SKIP
   ﹣ SKIP - NOTIFICATIONS_INTEGRATION=1 desligado # SKIP
   ﹣ SKIP - NOTIFICATIONS_INTEGRATION=1 + RESEND_API_KEY ausentes # SKIP
   ﹣ SKIP - STORAGE_INTEGRATION=1 desligado # SKIP
   ﹣ buildPoolOptions — EFEITO de reaping (CA-8) # SKIP
   ﹣ PoolRegistry — dedup real de conexões (CA-9) # SKIP
   ```

6. **Risco R2 do `research.md` (regra fora de produção rígida demais) não se materializou.** A
   suíte inteira roda sem `NODE_ENV=production` e sem nenhuma `*_DRIVER` definida; se a guarda
   tivesse endurecido o caminho não-produção, dezenas de testes que compõem módulos sem env teriam
   ficado vermelhos. `fail 0` é a prova do FR-009/SC-006.

---

## Check 5 — Verificação de fumaça do `quickstart.md` (stdio em **pipe**, não TTY)

Objetivo: provar que o comportamento **do processo** casa com o da função testada, e que a saída
não depende de TTY (é assim que o coletor de log do ECS/QA lê o stderr).

> **Gotcha de shell registrado:** o shell desta sessão é **zsh 5.9**, onde `${PIPESTATUS[0]}` expande
> para vazio (zsh usa o array `$pipestatus`, 1-indexado). O código de saída abaixo foi lido com
> `${pipestatus[1]}`, equivalente exato do `${PIPESTATUS[0]}` do bash. Não é defeito da
> implementação — é diferença de shell.

### CA1 — produção com driver ausente (o comando pedido)

```
$ NODE_ENV=production node src/server.ts 2>&1 | cat; echo "exit=${pipestatus[1]}"
server: auth: AUTH_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: contracts: CONTRACTS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: partners: PARTNERS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: programs: PROGRAMS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: financial: FINANCIAL_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: budget-plans: BUDGET_PLANS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: reports: REPORTS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
exit=78
```

✅ **7 mensagens** (uma por módulo, na ordem estável do mapa) e **`exit=78`** (`EX_CONFIG` do
`sysexits.h`). Nenhuma linha de "listening" — o processo morre **antes** de servir tráfego e antes
de abrir qualquer conexão. É exatamente o CA1 do `quickstart.md`.

### CA2 — produção com `mysql` sem endereço (conferência extra)

```
$ NODE_ENV=production AUTH_DRIVER=mysql node src/server.ts 2>&1 | cat; echo "exit=${pipestatus[1]}"
server: auth: AUTH_DATABASE_URL nao configurada — obrigatoria quando AUTH_DRIVER e "mysql"
server: contracts: CONTRACTS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: partners: PARTNERS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: programs: PROGRAMS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: financial: FINANCIAL_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: budget-plans: BUDGET_PLANS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: reports: REPORTS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
exit=78
```

✅ Cita `AUTH_DATABASE_URL` **e** os demais módulos no mesmo relatório (FR-005: um deploy conserta tudo).

### CA3 — erro de digitação no driver (conferência extra)

```
$ NODE_ENV=production AUTH_DRIVER=mysqll node src/server.ts 2>&1 | cat; echo "exit=${pipestatus[1]}"
server: auth: AUTH_DRIVER com valor invalido "mysqll" — valores aceitos: "mysql" ou "memory"
server: auth: AUTH_DATABASE_URL nao configurada — obrigatoria quando AUTH_DRIVER e "mysql"
server: contracts: CONTRACTS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: partners: PARTNERS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: programs: PROGRAMS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: financial: FINANCIAL_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: budget-plans: BUDGET_PLANS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: reports: REPORTS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
exit=78
```

✅ Cita o valor recebido (`"mysqll"`) e os aceitos — era o CA6 da issue #456, que antes caía em
memória calado. A **segunda** linha do `auth` (cobrança do `AUTH_DATABASE_URL`) **não é ruído**: é
decisão registrada em `src/shared/persistence/module-driver-config.ts:231-232` — "quem digitou
`mysqll` quis dizer `mysql`, cobrar tambem o endereco fecha os dois defeitos no mesmo deploy
(US2-2)". Coberta pelo caso 6.

---

## Higiene do worktree

`git status --porcelain --untracked-files=all` — só conteúdo do ticket, **zero lixo** (nenhum `.log`,
`.bak`, `.tmp`, `.orig`, `.rej`, `~`, `.DS_Store`, nenhum backup):

```
 M .specify/feature.json
 M README.md
 M src/modules/reports/adapters/http/composition.ts
 M src/server.ts
?? .claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/000-request.md
?? .claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/001-rollout-check.md
?? .claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/002-tests/REPORT.md
?? .claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/003-impl/REPORT.md
?? .claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/004-code-review/REVIEW.md
?? .claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/004-code-review/SECURITY-REVIEW.md
?? .claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/STATE.json
?? .claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/STATE.md
?? specs/037-persistence-driver-boot-guard/checklists/requirements.md
?? specs/037-persistence-driver-boot-guard/contracts/env-matrix.md
?? specs/037-persistence-driver-boot-guard/data-model.md
?? specs/037-persistence-driver-boot-guard/plan.md
?? specs/037-persistence-driver-boot-guard/quickstart.md
?? specs/037-persistence-driver-boot-guard/research.md
?? specs/037-persistence-driver-boot-guard/spec.md
?? specs/037-persistence-driver-boot-guard/tasks.md
?? src/shared/persistence/module-driver-config.ts
?? tests/shared/persistence/module-driver-config.test.ts
```

Busca explícita por lixo — nada encontrado:

```
$ git ls-files --others --exclude-standard | grep -Ei '\.(log|bak|tmp|orig|rej|swp|swo)$|~$|DS_Store'
(sem saída)
```

Os dois diffs pequenos são conteúdo legítimo do ticket:

- `.specify/feature.json`: ponteiro da feature corrente `036-budget-plans-monthly` →
  `037-persistence-driver-boot-guard`.
- `README.md`: uma linha, trocando a descrição do fallback silencioso pela da guarda de boot
  (exit 78 em produção, degradação com aviso fora dela).

O repositório principal **não foi tocado** — todo o trabalho ficou confinado ao worktree
`fix/456-driver-boot-guard`.

---

## Critérios de aceite (#456 / spec 037) — fechamento no gate

- **CA1** (produção + driver ausente derruba o boot, exit 78) — ✅ Check 5 CA1 + caso 1.
- **CA2** (produção + `mysql` sem endereço) — ✅ Check 5 CA2 + caso 2.
- **CA3** (typo no driver é erro, não fallback mudo) — ✅ Check 5 CA3 + caso 3.
- **CA4** (relatório completo numa tentativa só, FR-005) — ✅ casos 5, 6 e 12; visível nos 3 smokes.
- **CA5/FR-007** (`memory` explícito é respeitado em produção, com aviso) — ✅ caso 8.
- **CA6** (fora de produção segue sem fricção, com aviso por módulo) — ✅ casos 7 e 10.
- **CA7/FR-009** (ambiente correto não muda) — ✅ caso 4 + `fail 0` na suíte inteira.
- **CA8/FR-008** (degradações com ADR continuam degradando: réplica ADR-0026, composição ADR-0032) — ✅ casos 13 e 14.
- **Invariante de credencial (W2 M3/S1)** — ✅ casos 15, 16 e 17 (CWE-532 / CWE-117).
- **SC-005** (contagem ≥ baseline + 14) — ✅ baseline + **17**.

---

## Próximo passo

**GREEN** → wave W3 pode ser marcada `done` com outcome `GREEN` e o ticket fechado
(`pnpm run pipeline:state wave-finish` / `close` — **não executados por esta wave**, por instrução).
Nada foi commitado.
