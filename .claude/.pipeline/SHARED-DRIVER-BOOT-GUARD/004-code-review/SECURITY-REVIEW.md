# W2 — Auditoria de Segurança (read-only)

**Ticket**: SHARED-DRIVER-BOOT-GUARD · **Issue**: #456 · **Spec**: `specs/037-persistence-driver-boot-guard/`
**Data**: 2026-07-22 · **Agente**: `security-backend-expert` (skill `web-security-backend`) · **Round**: 1
**Escopo**: `src/shared/persistence/module-driver-config.ts` (novo) · `src/server.ts` (diff) · `src/modules/reports/adapters/http/composition.ts` (diff) · `tests/shared/persistence/module-driver-config.test.ts`
**Fora de escopo**: clean-code (revisor paralelo), correção dos achados (read-only).

---

## Veredito

**APROVADO COM RESSALVAS.**

A mudança **melhora** a postura de segurança do boot: elimina um _insecure default_ replicado em 7 pontos (CWE-1188 — _Initialization of a Resource with an Insecure Default_) que já causou perda de integridade de dado em produção duas vezes (#374, #444). Nenhuma das 6 mensagens construídas ecoa endereço de conexão; nenhum achado Crítico ou Alto.

As ressalvas são todas de **segunda ordem** — não bloqueiam o W3, mas duas delas (S2 e S4) devem ser resolvidas/verificadas **antes do merge**, porque decidem se a guarda de fato arma no ambiente onde os incidentes aconteceram.

| Severidade      | Qtd |
| --------------- | --- |
| Crítica         | 0   |
| Alta            | 0   |
| Média           | 4   |
| Baixa           | 3   |
| Informativa     | 3   |

---

## Seção obrigatória — Vazamento de credencial

**Veredito: NÃO há vazamento de credencial no caminho normal.** Nenhuma das mensagens de erro ou de aviso construídas por `module-driver-config.ts` interpola o valor de uma variável `*_DATABASE_URL`; todas citam apenas o **nome** da variável, satisfazendo `specs/037-persistence-driver-boot-guard/data-model.md:47` (_"Nenhuma mensagem de erro desta feature pode ecoar o valor de um endereço de conexão — só o **nome** da variável ausente."_). Existe **uma via latente** (S1) em que um erro de operador coloca o valor de uma credencial na mensagem — corrigível em 1 linha.

### Inventário completo das mensagens construídas

| # | Construtor | Arquivo:linha | O que interpola | Veredito |
| - | ---------- | ------------- | --------------- | -------- |
| 1 | `missingDriverError` | `module-driver-config.ts:150-152` | `spec.name` (literal), `spec.driverVar` (**nome** da env), `ACCEPTED_DRIVERS_TEXT` (literal) | **Seguro.** Zero valores de env. |
| 2 | `invalidDriverError` | `module-driver-config.ts:154-159` (eco em `:158`) | idem + `declaration.value` = **valor** de `*_DRIVER` | **Seguro para o caso previsto** (`"mysqll"`); ver **S1** para o caso do operador que troca a variável. |
| 3 | `missingUrlError` | `module-driver-config.ts:161-162` | `spec.name`, `spec.urlVar` (**nome**), `spec.driverVar` (**nome**) | **Seguro.** O valor de `spec.urlVar` é lido (`readVar`, `:183`/`:204`) mas só para testar `=== undefined`; nunca entra na string. |
| 4 | `missingDriverWarning` | `module-driver-config.ts:164-166` | `spec.name`, `spec.driverVar` (**nome**) | **Seguro.** |
| 5 | `invalidDriverWarning` | `module-driver-config.ts:168-173` (eco em `:172`) | idem + `declaration.value` | **Seguro para o caso previsto**; mesma via latente da #2, agora no caminho **fora de produção** (dev/QA, onde a higiene de log é menor). |
| 6 | `resolveReportsSource` (err) | `module-driver-config.ts:221-225` | `REPORTS_NAME`, `spec.overrideVar` (**nome**), `spec.sourceVar` (**nome**), `REPORTS_DRIVER_VAR` (**nome**) | **Seguro.** O `url` resolvido só viaja no ramo `ok(url)` (`:226`), nunca na mensagem. |

### Inventário dos `stderr.write` de `server.ts`

| Linha | Conteúdo | Veredito |
| ----- | -------- | -------- |
| `server.ts:118` | `server: ${message}` sobre `drivers.error` | **Seguro** — consome só as mensagens #1/#2/#3/#6 acima. |
| `server.ts:122` | `server: ${warning}` sobre `drivers.value.warnings` | **Seguro** — só #4/#5. |
| `server.ts:139` | erros de `readEmailLinkBaseUrls` | Pré-existente, fora do diff. Ecoa o **valor** de base URL inválida (`email-link-base-urls.ts:47`) — base URL pública, não credencial. Sem finding. |
| `server.ts:147` | `rbacBypassBanner(NODE_ENV)` | Pré-existente, fora do diff. Ecoa só `NODE_ENV`. |
| `server.ts:168-170` | `programs read port indisponível (${portR.error})` | **Seguro** — `portR.error` é união literal fechada (`ProgramsMysqlDriverError`, `programs/adapters/persistence/drivers/mysql-driver.ts:34-38`): 4 tags kebab-case, sem endereço. Condição de disparo **idêntica** à de antes (o `driver === 'mysql'` da união já implica endereço não-vazio). |
| `server.ts:429` | `Fatal ao iniciar: ${String(err)}` | Pré-existente. Os `throw` de composição usam tags (`composition.ts:124,137,149,163,177`), e `buildPoolOptions` retorna `PoolConfigError` literal (`mysql-pool-config.ts:25-28`). Sem eco de URL. |

### Fluxo do valor sensível

O endereço só existe em três lugares, todos verificados: (a) `process.env`, (b) o campo `connectionString`/`*Url` da união discriminada, (c) o `uri` do pool (`mysql-pool-config.ts:57`). **Não há** `JSON.stringify(config)`, `console.log(modules)` nem serialização do objeto de configuração em nenhum ponto do diff (grep em `src/` por `JSON.stringify(config|opts|deps)`: zero ocorrências). O objeto `modules` é destruturado campo a campo em `server.ts:150-259` e nunca logado.

---

## Achados

### Média

#### S1 — Eco irrestrito do valor de `*_DRIVER` pode carregar credencial para o log — `src/shared/persistence/module-driver-config.ts:158` e `:172`

- **CWE-532** (_Insertion of Sensitive Information into Log File_) · **OWASP A09:2021** (Security Logging and Monitoring Failures) · **Regra**: `data-model.md:47` (_"Nenhuma mensagem … pode ecoar o valor de um endereço de conexão"_).
- **Evidência**:
  ```ts
  `${spec.name}: ${spec.driverVar} com valor invalido "${value}" — ` + `valores aceitos: ${ACCEPTED_DRIVERS_TEXT}`
  ```
  `value` vem de `readDriver(env, spec.driverVar)` (`:140-146`) — cru, sem limite de tamanho e sem sanitização.
- **Impacto**: o par de variáveis de cada módulo é `AUTH_DRIVER` / `AUTH_DATABASE_URL`. Um operador que cole a connection string na variável errada (ou um mapeamento de secret com a chave trocada no taskdef/compose) produz `auth: AUTH_DRIVER com valor invalido "mysql://user:senha@rds…"` **em stderr** → coletor de log → armazenamento com audiência mais ampla e retenção maior que a do secret store, exigindo rotação de credencial. O risco é maior no QA, cujo compose é editado à mão no host (drift conhecido) — e o caminho de aviso (`:172`) dispara **fora** de produção, onde a higiene de log é menor.
- **Fix mínimo (1 linha, sem mudar teste)**: truncar e neutralizar antes de interpolar, ex. `const shown = value.replaceAll(/[^\w.-]/g, '?').slice(0, 32)`. O caso 3 do W0 (`tests/…/module-driver-config.test.ts:109-121`) só exige `/mysqll/` no texto — continua verde. Alternativa mais forte: só ecoar o valor quando ele casar com `/^[a-z0-9_-]{1,16}$/`, senão dizer `valor invalido (nao exibido)`.
- **Falso-positivo se**: houver uma política aceita de que `*_DRIVER` nunca recebe segredo. Não encontrei tal registro; e a defesa não custa nada.

#### S2 — `memory` explícito em produção não emite sinal nenhum: regressão de observabilidade frente ao PR #488 — `src/shared/persistence/module-driver-config.ts:189-191` (e `:255-256`)

- **CWE-778** (_Insufficient Logging_) · **OWASP A09:2021** · **Regra**: FR-006/FR-007 (spec `:105-106`), Assumptions da spec (`:155`: _"quem escreve explicitamente 'usar memória' assume o risco **de forma auditável**"_).
- **Evidência**: `case 'memory': return { config: MEMORY, ...NO_DIAGNOSTICS };` — zero erro, zero aviso, em qualquer ambiente. O `server.ts` removeu, no mesmo diff, o alarme do PR #488 (antigo `server.ts:245-252`), que gritava para `budget-plans` em memória **em produção**.
- **Impacto**: quem tem escrita em variável de ambiente (deploy, taskdef, compose do host) faz a API de produção servir de um store volátil com **aparência de normalidade absoluta** — HTTP 200, `/health` ok, zero linha de log. É exatamente o quadro clínico do #374/#444, agora acessível por uma via declarada. Não é escalação de privilégio (o store de `auth` em memória nasce vazio — `auth/adapters/http/composition.ts:288-304`, sem seed default; ninguém loga, falha ruidosa), mas para `financial`/`budget-plans`/`contracts` é **perda de integridade silenciosa**. A auditabilidade prometida pela spec `:155` não existe em lugar nenhum do runtime — só no arquivo de configuração, que é justamente o que ninguém lê depois do incidente.
- **Fix mínimo (mitigação barata que NÃO contraria FR-007)**: emitir **aviso** (canal `warnings`, que já existe) quando `driver === 'memory'` **e** `isProduction` — não falha o boot e não exige configuração adicional, que é tudo o que o FR-007 obriga. Verificado: **nenhum dos 14 testes do W0 quebra** — o caso 8 (`:282-295`) assere só `ok` + drivers, e o único `assert.deepEqual(warnings, [])` (caso 4, `:142`) roda sobre `PROD_ALL_MYSQL`, sem `memory`.
- **Falso-positivo se**: a P.O. decidir que o silêncio é o comportamento desejado. Nesse caso, registrar a decisão na spec — hoje ela diz o contrário ("de forma auditável"). O próprio W1 marcou isto como decisão a avaliar (`003-impl/REPORT.md:55`).

#### S3 — Diagnóstico do fail-closed pode ser perdido: `process.exit()` logo após escrita assíncrona em pipe — `src/server.ts:118-119`

- **CWE-778** (_Insufficient Logging_) · **Regra**: FR-005 (spec `:104`, "reportar **todos** os problemas de uma vez") e FR-010 (`:109`); `handbook/reference/nodejs/Process.md:4156` e `:4163`.
- **Evidência**: citação literal do handbook —
  > `Process.md:4156`: _"Pipes (and sockets): _synchronous_ on Windows, _asynchronous_ on POSIX"_
  > `Process.md:4163`: _"…or not written at all if `process.exit()` is called before an asynchronous write completes."_

  Em container Linux (ECS/Docker), stderr é um **pipe** para o log driver — caminho assíncrono por documentação. O código escreve até 8 linhas e chama `process.exit(78)` na linha seguinte.
- **Impacto**: quando ocorre, o operador recebe um `exit 78` **mudo**. O fail-closed só é aceitável porque vem com diagnóstico; sem ele, o caminho mais rápido para restaurar serviço é adivinhar — e o palpite mais provável (`X_DRIVER=memory`, aceito em produção sem qualquer sinal por S2) reintroduz exatamente o #374. Probabilidade prática baixa (`uv_try_write` costuma completar escritas pequenas de primeira), impacto alto quando materializa.
- **Fix mínimo**: trocar `process.exit(78)` por `process.exitCode = 78; return;` — o event loop está vazio nesse ponto (nenhum pool, nenhum listener, nenhum handle aberto), então o processo encerra com o código certo e a escrita drena. É o padrão **já adotado e documentado no próprio repo**: `src/jobs/auth/sync-permissions/run.ts:7-8` — _"`process.exitCode` (não `process.exit`) para deixar o event loop esvaziar"_ —, também usado em `src/workers/*/run.ts`. Alternativa: `writeSync(2, …)` de `node:fs`.
- **Nota**: o mesmo padrão existe em `server.ts:140` (email links, pré-existente). Corrigir os dois juntos é coerente; corrigir só o novo também resolve o achado.
- **Falso-positivo se**: houver medição de que em ECS/Fargate a saída nunca trunca. Não há; o handbook documenta o contrário.

#### S4 — A guarda só arma com `NODE_ENV=production`, e o `compose.yaml` (fonte dos taskdefs de prod) declara `development` — `src/shared/persistence/module-driver-config.ts:282` × `compose.yaml:283`

- **OWASP A05:2021** (Security Misconfiguration) · **CWE-1188** · **Regra**: FR-002/FR-003 (spec `:101-102`), condicionados a produção.
- **Evidência**: `const isProduction = env['NODE_ENV'] === 'production';` (`:282`). No repo, a **única** ocorrência de `NODE_ENV` em compose é `compose.yaml:283 → NODE_ENV: development`, dentro do bloco `environment:` do serviço `http` — o mesmo bloco que declara os 7 `*_DRIVER` (`:284-292`).
- **Impacto**: se o taskdef de produção herdar esse bloco, a feature **nasce inerte**: os 7 módulos caem em memória com 7 linhas de aviso e HTTP 200 — o cenário #374 intacto, agora com a falsa sensação de estar protegido. O mesmo vale para o alarme do PR #488 (removido) e para a obrigatoriedade das base URLs de e-mail (#331/#332).
- **Estado**: **parcialmente endereçado** por `001-rollout-check.md:29-38`, que traz duas evidências literais em contrário (`Dockerfile:96 → ENV NODE_ENV=production`; `compose.yaml:2-11` declara o compose como dev/homolog local). Confirmei ambas. **Residual**: (a) o taskdef de PROD é derivado do `compose.yaml` — precisa ser confirmado que a derivação **não** carrega `NODE_ENV: development`; (b) o QA roda compose não-versionado no host, `NODE_ENV` efetivo **desconhecido** (`001-rollout-check.md:40-47`), e essa verificação está registrada como "ação para o humano **antes do merge**" e **não foi feita**.
- **Fix mínimo**: (1) verificar o `NODE_ENV` efetivo em PROD e QA (`tr '\0' '\n' < /proc/1/environ`) antes do merge — já é ação registrada; (2) mitigação de código barata e sem impacto em teste: uma linha em `server.ts` (fora da função pura) declarando o modo resolvido, ex. `server: guarda de persistencia — modo <producao|permissivo> (NODE_ENV=<v>)`, para que a inércia da guarda seja **visível no log** em vez de inferida.
- **Falso-positivo se**: o taskdef de prod definir `NODE_ENV=production` explicitamente. Provável — mas é exatamente o que precisa ser provado, não presumido.

### Baixa

#### S5 — Log injection: valor de `*_DRIVER` com `\n` forja linhas de log — `src/shared/persistence/module-driver-config.ts:158`/`:172` + `src/server.ts:118`/`:122`

- **CWE-117** (_Improper Output Neutralization for Logs_) · **OWASP A09:2021**.
- **Evidência**: `process.stderr.write(\`server: ${message}\n\`)` sobre mensagem que contém `value` cru. `AUTH_DRIVER=$'x\nserver: tudo certo'` produz duas linhas indistinguíveis de diagnóstico legítimo.
- **Impacto**: forja de trilha de auditoria/diagnóstico. Requer controle de variável de ambiente (nível de privilégio já alto), então o valor de exploração é baixo; o valor real é confundir a análise de um incidente.
- **Fix mínimo**: o mesmo saneamento de S1 (`replaceAll(/[^\w.-]/g, '?')`) resolve S1 e S5 de uma vez.

#### S6 — `reports` perdeu a checagem de string vazia: invariante só em tempo de compilação — `src/modules/reports/adapters/http/composition.ts:118`

- **CWE-20** (_Improper Input Validation_) — defesa em profundidade · **Regra**: `.claude/rules/adapters.md` ("adapter converte para `Result` na borda").
- **Evidência**: os 4 `if (config.xUrl === undefined || config.xUrl.length === 0) throw …` foram substituídos por `const { partnersUrl, financialUrl, contractsUrl, budgetPlansUrl } = config;`. A união exige o campo, mas **não** exige não-vazio: `{ driver: 'mysql', partnersUrl: '' }` type-checka.
- **Impacto**: nulo hoje — o único chamador de produção é `server.ts:259`, e a guarda trata `''` como ausente (`readVar`, `:135-138`). O risco é de regressão futura: um chamador novo (worker, harness, job) que leia env por conta própria passa `''` e chega em `mysql2` com `uri: ''`, com falha confusa em vez de mensagem de configuração.
- **Fix mínimo**: nenhum obrigatório. Se quiser fechar: tipo branded `NonEmptyUrl` ou manter uma checagem barata no adapter. Registre como nota, não como bloqueio.
- **Nota comparativa**: os outros 4 módulos (`auth:309-310`, `contracts:388-389`, `programs:108-109`, `financial`) **mantiveram** suas checagens defensivas — a assimetria é do reports só.

#### S7 — Ação de rollout registrada e não executada bloqueia o merge, não o W2 — `.claude/.pipeline/SHARED-DRIVER-BOOT-GUARD/001-rollout-check.md:47`

- **OWASP A05:2021** · **Regra**: AGENTS.md §"Política de regressão zero" (escalar ao humano é saída aceitável, mas **explícita**).
- **Impacto**: sem a conferência do QA, o merge pode transformar um ambiente que hoje sobe degradado em um ambiente que **não sobe** (novo raio de alcance: uma variável faltante derruba os 7 módulos, não um). Ver §"Postura de falha".
- **Fix**: executar a conferência antes do merge e anexar a saída ao ticket.

### Informativa

#### S8 — Exit code 78 não constitui canal de vazamento de informação

Avaliado conforme pedido. `78` = `EX_CONFIG` (`sysexits.h`), já usado pelo precedente `email-link-base-urls` (`server.ts:140`) e pelos jobs (`src/jobs/auth/sync-permissions/run.ts:12`). Quem observa o código de saída é o orquestrador (ECS/Docker), que já tem privilégio total sobre a task; o código distingue apenas "configuração errada" de "aplicação quebrada" — **nenhum** dado sobre qual módulo, qual variável ou qual valor. `tini` (PID 1 no compose, `compose.yaml:298`) propaga o código do filho sem remapear. Não há superfície remota: o código de saída não é observável por cliente HTTP. **Sem finding** — e o ganho operacional é real: permite ao orquestrador não fazer retry cego de erro de configuração.

#### S9 — Ganhos de segurança entregues por este diff (registrar como crédito)

1. **Fecha o insecure default (CWE-1188)** replicado em 7 pontos. `grep -rn "_DRIVER" src scripts --include='*.ts'` fora da guarda: **zero ocorrências** — FR-001 verificado mecanicamente.
2. **Fail-closed em secret file ausente**: `compose.yaml:300-305` injeta via `export X="$(cat /run/secrets/…)"`. Secret ausente ⇒ string vazia; a guarda uniformiza `'' ≡ ausente` (`readVar`, `:135-138`) ⇒ em produção o boot falha em vez de servir memória. Antes, `budget-plans` aceitava `''` como endereço válido (`003-impl/REPORT.md:62`).
3. **`AUTH_DRIVER` ausente em produção deixa de ser possível**: antes, o store de identidade inteiro (usuários, roles, refresh tokens, tokens de reset) caía em memória em silêncio. Não era escalação (nasce vazio), mas era indisponibilidade total de autenticação após restart, sem log.
4. **Ordem de operações correta**: a guarda roda em `server.ts:116`, antes de qualquer pool. O único código anterior é `readHttpConfig` (`:109`), documentado como _"Sem I/O, sem deps externas"_ (`src/shared/http/config.ts:1-3`). FR-004 ("MUST NOT abrir porta") satisfeito — `app.listen` só em `:424`.
5. **Sem dependência nova**: `package.json` intocado no diff; a função usa só `#src/shared/primitives/result.ts`. ADR-0011/0012 preservados.
6. **Sem TOCTOU**: `readModuleDriverConfigs` é totalmente síncrona (nenhum `await`), então as leituras repetidas de `env` (`:183` e `:204`) não podem intercalar com mutação. E o valor **validado** é o mesmo **usado** — o `server.ts` não relê `*_DATABASE_URL` de `process.env` para nenhum dos 7 módulos (só as opcionais fora da guarda: `CONTRACTS_READER_URL:176`, `PARTNERS_READER_URL:194`, `PROGRAMS_LOGO_*:218`), o que elimina a divergência "valida um, usa outro".

#### S10 — Eco de erro do driver mysql2 (pré-existente, fora do diff)

`programs/adapters/persistence/drivers/mysql-driver.ts:66` e `:81` escrevem `String(cause)` de erro mysql2 em stderr. Mensagens típicas trazem **usuário e host** (`Access denied for user 'app'@'10.0.0.5' (using password: YES)`) — nunca a senha. Fora do diff e fora do escopo deste ticket (anti-padrão #15); registrar como issue própria se incomodar. Sem ação aqui.

---

## Postura de falha

### Falso-positivo — a guarda derruba produção saudável?

**Não encontrei caminho em que a guarda falhe um ambiente corretamente configurado.** Verificações:

| Cenário | Antes | Depois | Veredito |
| ------- | ----- | ------ | -------- |
| Prod com os 7 drivers + 6 URLs (`compose.yaml:284-305`) | sobe | sobe idêntico | **FR-009 ok.** Confirmado: compose declara os 7 drivers e as 6 URLs; as 4 fontes do `reports` resolvem por cascata a partir delas. |
| Réplica de leitura ausente (ADR-0026) | opcional | opcional — a guarda não conhece `*_READER_URL` (`server.ts:176`, `:194`) | **Sem regressão.** Travado pelo caso 13 do W0 (`:297-310`), que assere que nenhuma mensagem cita `READER_URL` nem com o relatório de erros aberto. |
| Composição de programa indisponível (ADR-0032) | degrada | degrada (`server.ts:164-170`) | **Sem regressão.** Travado pelo caso 14 (`:312-334`). |
| `reports` com fonte faltante | `throw` → `exit 1`, boot já parava | `exit 78` acumulado | **Melhora** — mesma disponibilidade, diagnóstico melhor e código de saída correto (FR-013). |
| Módulo deliberadamente não usado, driver não declarado, em produção | sobe degradado | **boot falha** | **Falso-positivo de forma, verdadeiro de mérito.** É o efeito pretendido (spec Assumptions `:159`). O conserto do operador é declarar `X_DRIVER=memory`. |

**O risco real não é falso-positivo lógico, é raio de alcance.** Antes, uma variável faltante degradava **um** módulo; agora derruba **a API inteira** (os 7 são resolvidos num único `Result`, `:302-303`). Em PROD/ECS isso é benigno (rolling deploy + circuit breaker mantêm a task velha), mas em QA/VPS com `restart: unless-stopped` vira crash-loop com indisponibilidade total. Some-se o drift conhecido do compose do QA (não-versionado, editado à mão) e a conferência pendente de S7: **o gate de merge é conferir as 14 variáveis (7 driver + 6 URL + `NODE_ENV`) em PROD e QA antes de mergear**, não depois.

### Falso-negativo — dado sensível ainda pode ser servido de store volátil sem ninguém perceber?

**Sim, por duas vias — ambas conhecidas e nenhuma introduzida por este diff:**

1. **`X_DRIVER=memory` explícito em produção (S2).** Aceito por decisão de produto (FR-007) e, hoje, **completamente mudo**: nenhum erro, nenhum aviso, HTTP 200. É a única via que preserva integralmente o quadro clínico de #374/#444. Mitigação barata e compatível com FR-007 em S2 (aviso, não erro; zero teste muda). **Recomendo aplicar.**
2. **`NODE_ENV` ≠ `production` no ambiente real (S4).** Se produção rodar como dev, todo o FR-002/FR-003 vira aviso. Evidência atual aponta para `NODE_ENV=production` na imagem (`Dockerfile:96`), mas o taskdef derivado do `compose.yaml` precisa ser confirmado.

Fora dessas duas, a cobertura é completa para os 7 módulos: driver ausente, vazio, com typo, ou `mysql` sem endereço — todos falham fechado em produção, acumulados. **Não há mais nenhum ponto em `src/` ou `scripts/` que leia `*_DRIVER`** (grep: zero fora da guarda), então não sobrou cópia do ternário para reintroduzir o defeito por outro entrypoint. Os workers têm validação própria e ruidosa (ex.: `src/workers/payable-view-projection/run.ts:27`).

**Fora de escopo, registrado**: a chave de assinatura ES256 efêmera (`auth/adapters/http/composition.ts:273-285`) é a **mesma classe de defeito aplicada a um controle criptográfico** — já registrada como #515 pela própria spec (`:117`). Correto não tratar aqui (FR-011 / anti-padrão #15). Vale notar a interação: `AUTH_DRIVER=memory` em produção (S2) + chave efêmera = autenticação inteiramente volátil, sem uma linha de log.

---

## Recomendação ao orquestrador

| Ação | Achado | Bloqueia |
| ---- | ------ | -------- |
| Sanear/truncar o eco de `value` nas duas mensagens de driver inválido | S1, S5 | Não — mas é 1 linha e fecha CWE-532 + CWE-117 |
| Emitir aviso para `memory` explícito em produção | S2 | Não W3; **sim o merge**, ou registrar a decisão contrária na spec |
| Trocar `process.exit(78)` por `process.exitCode = 78; return;` | S3 | Não |
| Conferir `NODE_ENV` + 13 variáveis em PROD e QA | S4, S7 | **Sim o merge** |
| Linha de log declarando o modo resolvido da guarda | S4 | Não |

Nenhum achado exige reabertura do W1 por defeito de implementação. A implementação faz o que a spec pede e não vaza credencial.
