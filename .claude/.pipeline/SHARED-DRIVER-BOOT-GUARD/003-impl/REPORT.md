# W1 — Implementação (GREEN)

**Ticket**: SHARED-DRIVER-BOOT-GUARD · **Issue**: #456 · **Data**: 2026-07-22
**Executores**: `typescript-language-expert` (parte 1 — função pura) · `nodejs-runtime-expert` (parte 2 — composition root)

## Resultado

**GREEN.** 4322 testes · 4303 pass · **0 fail** · 19 skipped. Baseline era 4308 ⇒ +14, exatamente os casos do W0. Nenhum teste existente foi alterado, afrouxado ou removido.

## Diff

| Arquivo | Mudança |
| --- | --- |
| `src/shared/persistence/module-driver-config.ts` | **NOVO** — a função única (~290 linhas) |
| `src/server.ts` | −8 leituras de `*_DRIVER`, −5 de `*_DATABASE_URL`, −cascata do reports, −aviso do PR #488 |
| `src/modules/reports/adapters/http/composition.ts` | −4 `throw`, config vira união discriminada |
| `tests/shared/persistence/module-driver-config.test.ts` | do W0, intocado |

`69 insertions(+), 99 deletions(-)` nos arquivos alterados. **Leituras de `*_DRIVER` restantes em `server.ts`: 0.**

## Desenho entregue

```ts
readModuleDriverConfigs(env): Result<ModuleDriverConfigs, readonly string[]>

ModuleDriverConfig = { driver: 'memory' } | { driver: 'mysql'; connectionString: string }
ReportsDriverConfig = { driver: 'memory' } | { driver: 'mysql'; partnersUrl; financialUrl; contractsUrl; budgetPlansUrl }
ModuleDriverConfigs = { modules: ModuleDriverMap; warnings: readonly string[] }
```

**O estado inválido é irrepresentável, não checado.** A variante `mysql` carrega o endereço como campo obrigatório; o literal só é construído dentro do ramo onde `undefined` já foi descartado (narrowing, zero `as`). Consequência no `server.ts`: os spreads condicionais (`...(x !== undefined ? { writerUrl: x } : {})`) viraram campo direto — o compilador passou a garantir o que antes era convenção.

Uma união intermediária `DriverDeclaration` (`mysql | memory | absent | invalid`) separa "ausente/vazio" de "valor inválido" **na leitura**, não no julgamento. É o que promove `memory` a valor de primeira classe (T039) em vez de "qualquer coisa != mysql", e o que faz `X_DRIVER=''` ≡ omitida sair de graça. Dois `switch` exaustivos sobre ela, sem `default`.

## Verificação manual (quickstart.md) — saídas reais

| CA | Comando | Resultado |
| --- | --- | --- |
| CA1 | `NODE_ENV=production node src/server.ts` | **exit=78**, 7 mensagens nomeando módulo + variável |
| CA2 | `+ AUTH_DRIVER=mysql` | exit=78, `auth: AUTH_DATABASE_URL nao configurada — obrigatoria quando AUTH_DRIVER e "mysql"` + os outros 6 |
| CA3 | `+ AUTH_DRIVER=mysqll` | exit=78, `AUTH_DRIVER com valor invalido "mysqll" — valores aceitos: "mysql" ou "memory"` |
| CA4 | 2 módulos quebrados | **8 linhas** no mesmo relatório — não parou no primeiro |
| CA5 | 7× `memory` explícito em produção | sobe, `GET /health` 200, **zero** avisos, exit=0 |
| CA6 | sem env alguma | sobe + 7 avisos `usando memory (dado volatil, perdido no restart)` |

## FR-008 — as duas degradações com ADR seguem intactas

Este era o **risco nº 1** do ticket.

- **ADR-0026** — `CONTRACTS_READER_URL`/`PARTNERS_READER_URL` continuam lidos direto do ambiente (`server.ts:176,194`), com spread condicional. A guarda não conhece essas variáveis. **Prova de execução**: produção + `CONTRACTS_DRIVER=mysql` + endereço inacessível + **sem** reader ⇒ nenhuma mensagem `server:` de configuração; a falha veio do pool real (`ECONNREFUSED`), com o exit 1 pré-existente.
- **ADR-0032** — read port de programs manteve `if (portR.ok) … else stderr('bloco program degradado')`. **Prova de execução**: `PROGRAMS_DRIVER=mysql` com endereço inacessível ⇒ `programs read port indisponível (…) — bloco program degradado` e o boot seguiu.

## Decisões tomadas onde o W0 deixou liberdade

1. **`memory` explícito não gera aviso**, em ambiente nenhum. FR-007 trata isso como intenção declarada; o aviso é sobre queda silenciosa. **Consequência que o W2 deve avaliar**: quem declarar `BUDGET_PLANS_DRIVER=memory` em produção não recebe mais o alarme que o PR #488 dava. Reverter é uma linha, e nenhum dos 14 testes muda.
2. **Erro do reports nomeia as duas variáveis** — o override e a fonte da cascata: `reports: REPORTS_FINANCIAL_DATABASE_URL nao configurada (nem FINANCIAL_DATABASE_URL, usada por cascata)`. Mais acionável para quem opera.
3. **Driver inválido só cobra endereço em produção.** Fora de produção degrada para `memory` com aviso citando o valor — cobrar URL em ambiente permissivo reintroduziria o risco R2 (quebrar `pnpm test`/dev).
4. **Ordem estável de erros** (auth → … → reports) e **PT sem acentuação** em stderr, seguindo literalmente o molde `email-link-base-urls.ts:42` e o antigo `server.ts:251`.

## Mudança de comportamento intencional

`budget-plans` era o único módulo que aceitava `BUDGET_PLANS_DATABASE_URL=''` como endereço válido (`!== undefined` sem checar vazio, antigo `server.ts:245`). A guarda uniformiza "vazio ≡ ausente" para os 7. Coberto pelo caso 9 do W0 e pelo Edge Case da spec.

## Gates (rodados de DENTRO do worktree)

```
typecheck     → exit 0
format:check  → All matched files use Prettier code style!
lint          → exit 0
test          → tests 4322 · pass 4303 · fail 0 · skipped 19
```

⚠️ **Armadilha registrada**: `pnpm exec eslint` rodado da **raiz do repo principal** contra um caminho em `.claude/worktrees/` sai exit 0 **sem lintar nada** — o flat config tem `.claude/**` em `ignores`. Falso-verde. Os gates acima foram rodados com cwd dentro do worktree e confirmados.

## Para o W2 olhar

1. A decisão 1 acima (`memory` explícito sem aviso) — é escolha de produto disfarçada de detalhe técnico.
2. **Não há teste** para "mensagem nunca ecoa connection string" (`data-model.md` exige). O W0 não cobriu; verificar por leitura.
3. `PROGRAMS_DRIVER` tinha **3** leituras (`:153` e `:212`), não 2 — conferir que a `:153` (read port de contracts) foi migrada corretamente.

---

# Round 2 — correções do W2

**Data**: 2026-07-22 · **Origem**: `004-code-review/REVIEW.md` (REJECTED, round 1) + `004-code-review/SECURITY-REVIEW.md` (aprovado com ressalvas).
**Escopo recebido**: 4 correções (C1–C4). **Fora do escopo por instrução explícita**: o Blocker B1 (`NODE_ENV` efetivo de PROD/QA) — é ação de infraestrutura para o humano, nenhuma linha de código; e qualquer toque em `*_READER_URL` (ADR-0026) ou na composição de programa (ADR-0032).

## C1 — `process.exit(78)` podia engolir o diagnóstico

**Achado**: REVIEW S2 + SECURITY S3. Em contêiner o stderr é um **pipe**, e `handbook/reference/nodejs/Process.md:4156-4163` é literal: _"Pipes (and sockets): _synchronous_ on Windows, _asynchronous_ on POSIX"_ … _"not written at all if `process.exit()` is called before an asynchronous write completes"_. Um `exit 78` mudo destrói o valor da feature, que é o diagnóstico (FR-005/FR-010), não o código de saída.

**Mudou** (`src/server.ts`): `process.exit(78)` → `process.exitCode = 78; return;` nos **dois** blocos de encerramento por configuração:

| Bloco                        | Linha  | Origem                              |
| ---------------------------- | ------ | ----------------------------------- |
| Guarda de persistência (#456) | `:126` | novo neste ticket                   |
| Links de e-mail (#331/#332)   | `:153` | **pré-existente — corrigido junto** |

O bloco dos links de e-mail **precisava** do mesmo fix: é a mesma linha de código, no mesmo arquivo, com o mesmo modo de falha. Deixar metade certa seria pior — quem investigasse um `exit 78` mudo não saberia de qual das duas guardas veio.

**Por que o `return` basta**: `main()` retorna `Promise<void>` e o `return` sai antes de qualquer pool, `app.listen` ou handler de sinal. Nenhum handle está aberto nesse ponto do boot — o único código anterior é puro (`readHttpConfig`, `parseE2eAuthSeed`, `resolveRbacMode`) —, então o event loop esvazia e o processo encerra com 78. Nenhuma reestruturação de `main()` foi necessária. Padrão idêntico ao dos jobs (`src/jobs/auth/sync-permissions/run.ts:7-8` — _"`process.exitCode` (não `process.exit`) para deixar o event loop esvaziar"_) e dos 5 workers.

**Prova** — com stdio **em pipe** (o caminho assíncrono do POSIX, que é onde o defeito mora), não em TTY:

```
===== C1 — producao sem nada, stderr EM PIPE =====
server: auth: AUTH_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: contracts: CONTRACTS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: partners: PARTNERS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: programs: PROGRAMS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: financial: FINANCIAL_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: budget-plans: BUDGET_PLANS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
server: reports: REPORTS_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
--- exit=78
```

As 7 mensagens **e** o 78 — que é exatamente o par que o achado dizia estar em risco.

## C2 — `memory` explícito em produção deixou de ser mudo

**Achado**: REVIEW M1 + SECURITY S2, convergentes e independentes. O precedente é do próprio repo: ADR-0052 trata "estado declarado porém perigoso" com banner gritante (`server.ts`, RBAC `bypass`: _"NÃO pode ser silencioso"_). Persistência volátil perde mais que autorização desligada — perde o trabalho do usuário.

**Mudou** (`src/shared/persistence/module-driver-config.ts`): novo `declaredMemoryWarning`; os dois `case 'memory'` (o dos 6 módulos, `resolveModule`, e o do `reports`, `resolveReports`) passam a devolver **aviso** quando `isProduction`. Continua **sem erro** — FR-007 exige que suba, e sobe. Fora de produção, `memory` declarado segue sem aviso: só o ausente/degradado avisa.

Isto recupera o alarme do PR #488 que a T042 havia removido, agora para os **7** módulos em vez de só `budget-plans`.

**Testes**: nenhum dos 14 muda — confirmado por leitura antes de editar e por execução depois. O caso 8 (`memory` em produção) assere só `ok` + drivers; o único `assert.deepEqual(warnings, [])` é o caso 4, que roda sobre `PROD_ALL_MYSQL` (nenhum `memory`); o caso 7 conta 7 avisos de driver **ausente**, sem `NODE_ENV`.

**Prova** — os 7 com `memory` declarado em produção, boot segue (exit 0 após SIGTERM):

```
server: auth: AUTH_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil, perdido no restart)
server: contracts: CONTRACTS_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil, perdido no restart)
server: partners: PARTNERS_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil, perdido no restart)
server: programs: PROGRAMS_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil, perdido no restart)
server: financial: FINANCIAL_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil, perdido no restart)
server: budget-plans: BUDGET_PLANS_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil, perdido no restart)
server: reports: REPORTS_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil, perdido no restart)
--- exit=0
```

A palavra `DECLARADO` separa este caso do degradado (`nao configurada — usando memory`), como pedido em M1.

## C3 — eco do valor do driver: de cru a não-exibido

**Achado**: REVIEW M3 + SECURITY S1 (CWE-532) e S5 (CWE-117).

**Mudou** (`module-driver-config.ts`): `echoableDriverValue` filtra o que entra nas duas mensagens de valor inválido (`invalidDriverError`, `invalidDriverWarning`).

**Duas iterações, e a primeira não bastou** — registro porque é o ponto interessante: comecei por truncar em 20 + neutralizar `[^\w.-]`, como sugerido. A prova de execução mostrou `AUTH_DRIVER com valor invalido "mysql???core_app?SEN..."` — ou seja, **os 3 primeiros caracteres da senha ainda vazavam**. Truncar é insuficiente por construção: o prefixo de uma connection string é justamente onde moram usuário e início da senha. A versão final só ecoa quando o valor **tem forma de driver** (`/^[\w.-]{1,20}$/`); qualquer outra coisa vira `(nao exibido — N caracteres fora do formato de driver)`. O tamanho distingue "typo" de "variável trocada" sem revelar nada.

**Prova** — valor com credencial **e** `\n` de log injection (`mysql://core_app:SENHA_SECRETA@rds.interno/core\nserver: linha forjada`):

```
server: auth: AUTH_DRIVER com valor invalido (nao exibido — 69 caracteres fora do formato de driver) — valores aceitos: "mysql" ou "memory"
server: auth: AUTH_DATABASE_URL nao configurada — obrigatoria quando AUTH_DRIVER e "mysql"
--- exit=78
```

Sem `SENHA_SECRETA`, sem `core_app`, sem host, e sem a linha forjada — CWE-532 e CWE-117 fechados juntos. E o typo plausível continua inteiro, que é o que o operador precisa ver:

```
server: auth: AUTH_DRIVER com valor invalido "mysqll" — valores aceitos: "mysql" ou "memory"
```

Caso 3 do W0 (`/mysqll/`) e caso 6 seguem verdes.

## C4 — simetria da checagem de vazio no reports

**Achado**: SECURITY S6.

Duas partes, porque o achado tem duas metades:

1. **A guarda já normalizava** — `resolveReportsSource` usa `readVar` nos **dois** degraus da cascata (override e módulo-fonte), e `readVar` trata `''` como ausente. Isto é estritamente melhor que o `??` do `server.ts` de antes, onde um override vazio **vencia** a cascata e chegava vazio no pool. Documentei a garantia no ponto onde ela é feita e provei por execução (abaixo).
2. **O adapter ficou sem defesa em profundidade** — a união discriminada exige o campo, não o conteúdo: `{ driver: 'mysql', partnersUrl: '' }` type-checka. Restaurei **uma** checagem (não as quatro removidas pela T028), cobrindo as 4 fontes de uma vez, com comentário distinguindo o que ela é do que a T028 tirou: aquela era validação de **ambiente** (nomeava env, derrubava o boot uma fonte por vez, exit 1); esta é assertiva de invariante do contrato do adapter, inalcançável a partir do `server.ts`, para o chamador futuro (worker, harness, job) que leia env por conta própria. Deixa o `reports` simétrico aos outros quatro composition roots, que mantiveram as suas.

**Prova** — produção, `REPORTS_DRIVER=mysql`, `PARTNERS_DATABASE_URL=''`:

```
server: reports: REPORTS_DATABASE_URL nao configurada (nem PARTNERS_DATABASE_URL, usada por cascata) — obrigatoria quando REPORTS_DRIVER e "mysql"
…
--- exit=78
```

Vazio ≡ ausente, com a variável nomeada — igual aos outros seis.

## Achados do W2 deliberadamente NÃO endereçados

Registrado para o round 2 do W2 não reabrir como omissão:

| Achado                                              | Por quê                                                                                                     |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **B1** (`NODE_ENV` efetivo de PROD/QA) · SECURITY S4/S7 | Instrução explícita do coordenador: ação de infraestrutura para o humano, sem mudança de código. Nada tocado em `NODE_ENV`, `compose.yaml` ou taskdef. |
| **M2** (caso 15 — `mysql` sem URL fora de produção) | Exige teste novo; o critério de pronto deste round fixa a contagem em 4322. O comportamento está correto e ancorado em `env-matrix.md:12` (OBR-M); a redação da spec é que precisa alinhar. |
| **M4** (`README.md:120`, `.claude/rules/adapters.md`, comentário do `compose.yaml`, T045) | Documentação fora do escopo das 4 correções recebidas. Real e pertinente — o README hoje afirma o contrário do código. |
| **S1** (unificar os dois relatórios de configuração num só `exit`) | Melhoria de UX de operação, não correção. Mudaria a ordem/forma do relatório, com risco desnecessário neste round. |
| **S3, S4, S6, S7, S8** (sugestões de teste e tipo órfão) | Nenhuma bloqueia; S3/S8 exigiriam teste novo (contagem fixa). `ReportsDriver` (S6) segue exportado no `public-api` — remover é mudança de superfície pública, fora destas 4 correções. |
| **S10** (eco de erro do mysql2, pré-existente)       | Fora do diff e do ticket (anti-padrão #15).                                                                  |

## Gates do round 2 (rodados de DENTRO do worktree)

```
typecheck     → exit 0
lint          → exit 0
format:check  → All matched files use Prettier code style!
test          → tests 4322 · suites 1237 · pass 4303 · fail 0 · skipped 19
```

Contagem **inalterada** (4322): nenhum teste foi adicionado, alterado, afrouxado ou removido. Os 14 casos do W0 rodados isoladamente: `tests 14 · pass 14 · fail 0`.

---

# Round 3 — recomendações acatadas do W2 (APPROVED)

O W2 aprovou no round 2, mas recomendou dois itens "fortemente". Ambos acatados antes do W3.

## M3 — teste do invariante de credencial (3 casos novos)

O revisor argumentou: é o controle mais importante do ticket, **já errou uma vez aqui** (a primeira
versão do C3 truncava em 20 caracteres e ainda imprimia `"mysql://core_app:SEN..."`) e tinha zero
cobertura. Um controle que já falhou precisa de teste.

`tests/shared/persistence/module-driver-config.test.ts` ganhou o describe "invariante de credencial":

| Caso | O que trava | Ancoragem |
| --- | --- | --- |
| 15 | URL colada na variável de DRIVER por engano não vaza senha, usuário nem host | CWE-532 · `data-model.md` |
| 16 | Valor com `\n` não forja linha no stderr | CWE-117 |
| 17 | Nenhum **aviso** ecoa valor de endereço (o caminho degradado gera mais avisos) | CWE-532 |

Contagem: 14 → **17** no arquivo. Todos verdes sem tocar a implementação — o controle do round 2
já estava correto; os testes o travam contra regressão futura.

## M4 — `README.md` ensinava o oposto

`README.md:120` dizia: _"ausência de config degrada para in-memory (boot não cai)"_ — verdadeiro
antes, falso agora em produção. O revisor divergiu (com razão) da triagem do W1, que classificara
isso como doc adjacente: é a descrição do exato comportamento que o ticket muda. Reescrito com os
três ramos (produção falha / fora de produção degrada com aviso / `memory` explícito sempre aceito).
