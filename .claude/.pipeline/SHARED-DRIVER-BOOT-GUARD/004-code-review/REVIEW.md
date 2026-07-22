# Code Review — SHARED-DRIVER-BOOT-GUARD — Round 1

**Veredito:** **REJECTED**

- **Reviewer:** `code-reviewer` (W2, read-only)
- **Data:** 2026-07-22
- **Issue:** #456 · **Spec:** `specs/037-persistence-driver-boot-guard/` · **Incidentes:** #374, #444
- **Worktree:** `.claude/worktrees/456-driver-boot-guard` (branch `fix/456-driver-boot-guard`)

**Contagem:** 1 🔴 Blocker · 4 🟡 Importante · 8 🔵 Sugestão

> O código em si está bom — provavelmente o melhor diff de composition root que passou por aqui.
> O bloqueio **não é do código**: é de uma verificação prevista no próprio plano (T006) que não foi
> feita, e sem a qual não se sabe se a guarda vai sequer disparar no ambiente para o qual ela foi
> escrita. Ver B1.

## Escopo revisado

| Arquivo                                            | Como foi lido                                     |
| -------------------------------------------------- | ------------------------------------------------- |
| `src/shared/persistence/module-driver-config.ts`   | integral (318 linhas)                             |
| `src/server.ts`                                    | integral + `git diff` contra `HEAD`               |
| `src/modules/reports/adapters/http/composition.ts` | `git diff` + leitura do bloco `mysql` (`:94-230`) |
| `tests/shared/persistence/module-driver-config.test.ts` | integral (14 casos) + execução isolada       |
| Contexto                                           | `000-request.md`, `002-tests/REPORT.md`, `003-impl/REPORT.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/env-matrix.md`, `tasks.md`, ADR-0026, ADR-0032, `AGENTS.md`, `.claude/rules/adapters.md`, `.claude/rules/testing.md` |
| Verificações cruzadas                              | `compose.yaml`, `Dockerfile`, `scripts/e2e/*.sh`, `README.md`, `src/shared/http/email-link-base-urls.ts`, `src/modules/auth/adapters/http/composition.ts` |

**Comandos rodados (read-only, de dentro do worktree):**

```
node --test --experimental-strip-types --no-warnings tests/shared/persistence/module-driver-config.test.ts
  → tests 14 · pass 14 · fail 0

pnpm run typecheck
  → tsc --noEmit · exit 0

grep -n "_DRIVER" src/server.ts        → zero ocorrências  (FR-001 cumprido)
grep -rn "reports-composition" tests/  → zero ocorrências  (T030 cumprida)
```

---

## Issues encontradas

### 🔴 Crítica (bloqueia approval)

#### B1 — `compose.yaml:283` fixa `NODE_ENV: development` no serviço que roda `src/server.ts`; a guarda pode nascer **inerte em produção**, e a T006 que decidiria isso não foi feita

**Categoria:** bug funcional confirmado / entrega falso-verde
**Arquivos:** `compose.yaml:283` · `Dockerfile:96` · `.env.example:108` · `src/shared/persistence/module-driver-config.ts:282`

Toda a feature pende de um booleano:

```ts
// src/shared/persistence/module-driver-config.ts:282
const isProduction = env['NODE_ENV'] === 'production';
```

O repositório contradiz a si mesmo sobre o valor dessa variável em produção:

| Fonte                | Diz                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `Dockerfile:96`      | `ENV NODE_ENV=production`                                                                        |
| `.env.example:108`   | _"NODE_ENV: != production EXPÕE /docs e /docs/json (OpenAPI). Em prod = production"_              |
| `compose.yaml:283`   | `NODE_ENV: development` — **no serviço `http`**, que é o único que roda `node src/server.ts`      |

O `compose.yaml` **sobrescreve** o `Dockerfile`. E é justamente o serviço `http` que carrega, logo
acima, o comentário que amarra este ticket ao incidente (`compose.yaml:279-281`):

> ⚠️ TODO módulo registrado no server.ts precisa do seu `*_DRIVER` AQUI. O server degrada para
> in-memory EM SILÊNCIO quando o driver falta (…) — foi o que deixou budget-plans (#374) e reports
> (#444) mudos **em produção**. Ver #456 (fail-fast no boot).

Ou seja: a definição versionada do serviço que rodou em produção quando #374/#444 aconteceram declara
`NODE_ENV: development`. Se for essa a marcação efetiva de PROD, então **depois deste diff a produção
continua degradando** — só que agora com um aviso em stderr. FR-002/FR-003/FR-004/FR-005 não
disparam, **SC-002 ("detectada em 100% dos casos no boot") vira 0%**, e #456 fecha sem remover a causa
de #374/#444. É o pior desfecho possível: o defeito vivo atrás de um check verde — o mesmo padrão de
falso-verde já registrado no projeto (rota ausente contada como sucesso, #454).

Isto não é achado de oportunidade: **o próprio plano previu a tarefa e ela não foi executada.**

- `tasks.md:46` — _"T006 Conferir a configuração real de QA e de produção contra a matriz e **registrar** quais variáveis faltam hoje em cada ambiente (risco R3 — é o que dirá se algum ambiente vai parar de subir)"_
- `tasks.md:196` — _"A T006 é a tarefa que decide se este deploy é tranquilo ou traumático."_
- `research.md` R3 — _"Derrubar o boot de um ambiente que hoje depende do fallback silencioso… Antes do deploy, conferir a configuração de QA e produção contra `contracts/env-matrix.md`"_
- `contracts/env-matrix.md:56` — _"Conferir esta matriz contra a configuração real de cada ambiente **antes** de subir a versão com a guarda ativa"_

O `003-impl/REPORT.md` documenta CA1–CA6 rodados **na máquina local**; não há nenhuma linha sobre a
configuração real de QA ou de produção. O risco R3 está aberto nas duas direções ao mesmo tempo:
ou a guarda não dispara (inerte), ou dispara e derruba um ambiente que hoje depende do fallback.
Não sabemos qual, e é exatamente o que a T006 existiria para responder.

**Correção exigida (nada disso é mudar a guarda — a guarda está certa):**

1. Apurar o `NODE_ENV` **efetivo** de QA e de PROD e registrar a resposta no ticket e no corpo do PR.
2. Conferir, ambiente a ambiente, as 7 variáveis de driver + as 6 URLs contra `contracts/env-matrix.md`,
   registrando o que falta hoje (é a T006 literal).
3. Se PROD rodar com `NODE_ENV != production`: **não** consertar aqui (anti-padrão #15). Registrar via
   skill `issue-report` e declarar no PR, em letras grandes, que #456 só fecha a classe de defeito
   depois dessa issue — ou obter decisão do P.O. para ajustar o ambiente no mesmo deploy.

**Achado colateral (registrar como issue própria, fora deste ticket):** se PROD de fato roda com
`NODE_ENV != production`, dois controles já mergeados também estão inertes lá — `readEmailLinkBaseUrls`
(#331/#332, `src/server.ts:137-141`) e o gate do Swagger (`/docs` e `/docs/json` **expostos**, conforme
`.env.example:108` e `tests/shared/http/swagger-guard.test.ts:22-30`). O segundo é exposição de
superfície de API em produção.

---

### 🟡 Importante (não bloqueia, mas precisa de decisão registrada)

#### M1 — `memory` explícito em produção fica 100% mudo: regride o sinal do PR #488 e contraria o precedente do ADR-0052

**Categoria:** decisão de produto embutida como detalhe técnico (é o ponto 1 que o W1 pediu para julgar)
**Arquivos:** `src/shared/persistence/module-driver-config.ts:189-191` e `:255-256` · `src/server.ts` (bloco removido do antigo `:246-254`)

```ts
// module-driver-config.ts:189-191
case 'memory':
  // Intencao declarada (FR-007): vale em qualquer ambiente, sem erro e sem aviso.
  return { config: MEMORY, ...NO_DIAGNOSTICS };
```

O bloco removido do `server.ts` (PR #488) gritava quando `budget-plans` caía em memória com
`NODE_ENV=production`. Depois deste diff, `BUDGET_PLANS_DRIVER=memory` em produção não produz **erro
nem aviso** — silêncio absoluto, que é precisamente o vocabulário que a spec usa para descrever o
defeito (`spec.md:15`: _"Não há erro, não há log, não há sinal."_).

O argumento do W1 ("intenção declarada ≠ queda silenciosa") é válido e a spec o autoriza. Mas o
projeto **já decidiu essa mesma classe de questão em outro lugar**, e decidiu no sentido oposto —
`src/server.ts:143-148`, ADR-0052:

> ADR-0052 — modo do RBAC. `bypass` desliga a autorização por permissão (todo autenticado é
> super-usuário). **NÃO pode ser silencioso: um banner gritante no boot torna o estado inconfundível.**

Persistência volátil em produção é estritamente mais destrutiva que RBAC desligado: uma perde
autorização, a outra perde **o trabalho do usuário**. Se o projeto grita por uma, tem de gritar pela
outra. Além disso, "declarado" é auditável no taskdef, não na cabeça de quem lê o log às 3h da manhã
tentando entender por que a tela está vazia — que é o cenário literal de #374 e #444.

Nenhuma regra impede o aviso: FR-007 exige apenas _"sem falhar e sem exigir configuração adicional"_,
e SC-001 fala em _"declarado explicitamente"_ — ambos continuam satisfeitos com um aviso. O W0 deixou
o espaço aberto de propósito (`002-tests/REPORT.md`, premissa 3: _"o caso 8 **não** assere sobre
`warnings`, de propósito, para não impedir o W1 de avisar também nesse cenário"_).

**Recomendação:** avisar quando `driver === 'memory'` **e** `isProduction`, com texto que distinga
*declarado* de *degradado* (ex.: `auth: AUTH_DRIVER=memory DECLARADO em producao — dado volatil,
perdido no restart`). Custo: um `case` e um teste novo. **Zero** dos 14 testes atuais muda.
Se a decisão for manter o silêncio, ela precisa subir para o P.O. e virar linha na spec — não pode
ficar só num parágrafo do REPORT do W1.

---

#### M2 — `mysql` sem endereço derruba o boot em **qualquer** ambiente, e nenhum teste fixa isso

**Categoria:** cobertura ausente sobre mudança de comportamento
**Arquivo:** `src/shared/persistence/module-driver-config.ts:182-188`

```ts
case 'mysql': {
  const url = readVar(env, spec.urlVar);
  // Endereco obrigatorio em QUALQUER ambiente quando o driver e "mysql" (matriz, OBR-M).
  return url === undefined
    ? { config: MEMORY, errors: [missingUrlError(spec)], warnings: [] }
    : ...
```

A escolha está **certa** e ancorada no contrato — `contracts/env-matrix.md:12`: _"**OBR-M** Obrigatória
**se** o driver do módulo for `mysql`, em qualquer ambiente"_. Mas ela é a leitura oposta à literal do
FR-001..FR-013: FR-003 escopa a falha a produção (_"**Em produção**, o sistema MUST falhar o boot
quando um módulo estiver declarado como 'banco real' sem o endereço"_), e FR-006 promete que fora de
produção o sistema _"MUST subir com armazenamento em memória"_. Um leitor da spec sozinha conclui o
contrário do que o código faz.

E a suíte só cobre o lado produção (caso 2, `:99-107`). **Não há caso para `X_DRIVER=mysql` sem URL
fora de produção** — o cenário que muda a vida de quem desenvolve: antes degradava/estourava dentro
da composição do módulo, agora mata o boot com 78 na máquina do dev. Um refactor futuro que
"consertasse" isso para degradar fora de produção passaria no gate inteiro sem acender nada.

**Recomendação:** (a) caso 15 — `readModuleDriverConfigs({ AUTH_DRIVER: 'mysql' })` (sem `NODE_ENV`)
deve sair `ok === false`; (b) alinhar a redação de FR-003/FR-006 com OBR-M na spec, ou registrar a
divergência explicitamente nas Assumptions.

---

#### M3 — Falta o teste da invariante de credencial exigida por `data-model.md`, e existe um vetor de vazamento residual

**Categoria:** segurança (log de segredo) + cobertura ausente — é o ponto 2 que o W1 pediu para julgar
**Arquivos:** `src/shared/persistence/module-driver-config.ts:154-159` e `:168-173`

**A garantia literal se sustenta.** Auditei as **sete** funções formadoras de mensagem
(`:150-173` e `:221-225`) uma a uma. Nenhuma interpola `readVar(env, spec.urlVar)` nem qualquer valor
de `*_DATABASE_URL`; todas citam apenas **nome de módulo** e **nome de variável**. `missingUrlError`
(`:161-162`), que é a única com acesso natural ao valor da URL, não o toca. `resolveReportsSource`
(`:221-225`) nomeia as duas variáveis (override e fonte da cascata) e nenhum valor. Conclusão:
a exigência de `data-model.md` ("_Nenhuma mensagem de erro desta feature pode ecoar o valor de um
endereço de conexão — só o **nome** da variável ausente_") está **cumprida por construção**.

**O resíduo.** `invalidDriverError` e `invalidDriverWarning` interpolam **cru** o valor de `X_DRIVER`:

```ts
`${spec.name}: ${spec.driverVar} com valor invalido "${value}" — valores aceitos: …`
```

O erro de digitação mais plausível de quem monta env de deploy não é `mysqll` — é **colar a URL na
variável errada**: `AUTH_DRIVER=mysql://core_app:SENHA@rds…/core`. Nesse caminho a guarda escreve a
credencial em stderr, direto para o coletor de log. O precedente faz igual
(`email-link-base-urls.ts:47`: `valor atual: "${value}"`), então não é regressão — mas lá o valor é
uma base URL pública e aqui pode ser segredo de banco. Lembrar também que este repositório é
**público** (o log não, mas o hábito de ecoar valor cru é o que vaza).

**Recomendação:** (a) limitar o eco (ex.: primeiros ~16 caracteres) e redigir tudo a partir de `://`;
(b) teste dedicado, que é o item que o W0 delegou explicitamente ao W2 (`002-tests/REPORT.md`,
premissa 9): montar um env em que **todas** as URLs contenham `SENHA_SECRETA`, provocar erro em todos
os módulos, e assertar que nenhum item de `error` nem de `warnings` contém essa substring — incluindo
o caso do driver com URL colada.

---

#### M4 — `README.md:120` passa a afirmar exatamente o contrário do código

**Categoria:** documentação contradiz comportamento (FR-010)
**Arquivos:** `README.md:120` · `.claude/rules/adapters.md` · `compose.yaml:279-281`

Texto literal de `README.md:120`, hoje:

> Drivers `memory` | `mysql` por módulo via env (`<MÓDULO>_DRIVER`); ausência de config degrada para
> in-memory (boot não cai).

Depois deste diff isso é **falso em produção** (o boot cai, com 78) e incompleto fora dela (cai em
memory **com aviso**). FR-010 é sobre quem opera o deploy entender o contrato _"sem ler o código"_ —
e o README é o primeiro lugar onde essa pessoa olha. Deixar a afirmação antiga é pior do que não ter
documentação: ela ativamente ensina o comportamento que o ticket acabou de remover.

Mesma drift, de menor alcance:

- `.claude/rules/adapters.md` — tabela de drivers com _"`memory` (default)"_. Não é mais default em produção.
- `compose.yaml:279-281` — o ⚠️ TODO que diz _"O server degrada para in-memory EM SILÊNCIO quando o
  driver falta (…) Ver #456 (fail-fast no boot)"_ fica obsoleto no mesmo commit que resolve o #456.

Somado a isso, a **T045** (_"Documentar a matriz de variáveis no runbook de deploy, para que a
conferência de T006 não dependa de alguém lembrar"_) segue aberta, e é a que dá sobrevida à
verificação exigida em B1.

---

### 🔵 Sugestão

**S1 — Dois relatórios de configuração, dois `exit(78)` distintos.**
`server.ts:116-120` (drivers) encerra **antes** de `server.ts:137-141` (links de e-mail). Um ambiente
com os dois quebrados exige dois deploys para descobrir os dois problemas — exatamente o ciclo que a
US2 existe para eliminar (_"transforma uma sessão de N deploys falhos em uma correção só"_). Custa
pouco unificar: rodar os dois `read*`, concatenar os canais de erro, sair uma vez só.

**S2 — `process.stderr.write` seguido de `process.exit()` no mesmo tick pode truncar em macOS.**
Nos docs do Node (`process.stdout`, "A note on process I/O"), escrita em **pipe** é síncrona em Linux
e **assíncrona em macOS**. Com 7+ linhas de relatório, o dev que rodar `node src/server.ts 2>&1 | tee`
no Mac pode perder o final — justamente a informação que a feature existe para entregar. Em
Linux/ECS não há risco. `process.exitCode = 78` + `return`, ou `fs.writeSync(2, …)`, elimina o caso.
Padrão herdado do precedente; não é regressão.

**S3 — Caso 13 só inspeciona o canal de erro.**
`assert.equal(errorText(broken).includes('READER_URL'), false)` (`:307-309`) não impede uma
implementação futura de **avisar** sobre réplica ausente — o que também seria endurecimento indevido
do ADR-0026 (poluiria o boot de todo single-node com um aviso sobre algo que é opcional por decisão).
Assertar o mesmo sobre `r.value.warnings` custa uma linha e fecha o flanco.

**S4 — Caso 14 nomeia ADR-0032 mas exercita só a pureza da guarda.**
A degradação real vive em `server.ts:164-171` (`buildProgramsReadPort` falha → stderr + segue o boot)
e não tem cobertura automatizada, nem antes nem depois. O W0 explica a limitação com honestidade
(`002-tests/REPORT.md`, §"Por que os casos 13 e 14 estão escritos assim") e o W1 provou por execução
manual. Vale registrar como candidato a 1 teste de fumaça de boot, fora desta fatia.

**S5 — Assimetria residual entre `reports` e os outros seis.**
`reports` virou união discriminada, mas `auth/adapters/http/composition.ts:109` mantém
`connectionString?: string` e `:309-310` mantém `throw new Error('auth-composition: driver mysql exige
connectionString')` — hoje inalcançável a partir do `server.ts` (a guarda torna o estado
irrepresentável), porém ainda saindo com exit **1** se alguma outra composição chamar. Coerente com o
escopo; anotar como próximo passo natural, não consertar aqui (anti-padrão #15).

**S6 — `ReportsDriver` virou tipo órfão.**
`src/modules/reports/adapters/http/composition.ts:57` exporta `type ReportsDriver = 'memory' | 'mysql'`,
reexportado em `public-api/http.ts:20`, e nenhum consumidor o usa desde que a config virou união.
Candidato a remoção no mesmo diff.

**S7 — A cascata do `reports` lê o env cru do módulo-fonte, não a decisão já resolvida.**
Com `FINANCIAL_DRIVER=memory` e um `FINANCIAL_DATABASE_URL` sobrando no ambiente, `reports` sobe em
`mysql` lendo `fin_*` **real** enquanto o módulo `financial` serve memória — dois retratos diferentes
do mesmo dado na mesma API. Preserva o comportamento de hoje (o que FR-009 exige) e o W0 fixou como
premissa 5; registro só como observação de coerência para uma fatia futura.

**S8 — Divergência não testada em `REPORTS_*_DATABASE_URL=''`.**
Antes, `process.env['REPORTS_CONTRACTS_DATABASE_URL'] ?? contractsWriterUrl` — o `??` só cai em
`null`/`undefined`, então `''` **vencia** a cascata e estourava lá na composição. Agora `readVar`
(`:135-138`) trata `''` como ausente e a cascata resolve. É estritamente melhor e coerente com o
Edge Case da spec, mas o caso 9 só exercita `AUTH_*`; a variante do `reports` não tem asserção.

---

## Resposta aos 3 pontos que o W1 levantou

### 1. `memory` explícito não gera aviso em ambiente nenhum — deve ser assim?

**Não. Recomendo reverter para "avisa em produção".** Detalhamento completo em **M1**. Resumo do
julgamento:

- A leitura do W1 (FR-007 = intenção declarada, aviso é sobre queda silenciosa) é **defensável** e a
  spec a autoriza. Não é violação de requisito.
- Mas o projeto já resolveu essa exata classe — "estado declarado, porém perigoso" — no ADR-0052, e
  resolveu **gritando** (`server.ts:143-148`). Persistência volátil perde mais que RBAC desligado.
- Nada impede o aviso: FR-007 pede "sem falhar", não "sem avisar"; SC-001 pede "declarado
  explicitamente", que o aviso não contradiz; e o caso 8 do W0 foi escrito de propósito sem asserção
  sobre `warnings` para deixar a porta aberta.
- Custo de mudar: um `case` + um teste. Nenhum dos 14 testes muda. Custo de não mudar: quem operar o
  próximo incidente não terá sinal nenhum no log, que é o sintoma exato de #374 e #444.
- **Se a decisão for manter o silêncio**, ela é do P.O. e tem de virar linha na spec — não pode ficar
  apenas num parágrafo do REPORT do W1.

### 2. Nenhuma mensagem ecoa o valor de uma connection string? (verificação por leitura)

**A garantia se sustenta para as variáveis de endereço; há um resíduo na variável de driver.**
Detalhamento em **M3**. Auditei as sete formadoras de mensagem:

| Função (linha)                         | O que interpola                       | Ecoa URL? |
| -------------------------------------- | ------------------------------------- | --------- |
| `missingDriverError` (`:150-152`)      | nome do módulo, `driverVar`, aceitos  | não       |
| `invalidDriverError` (`:154-159`)      | nome, `driverVar`, **valor do driver**, aceitos | não* |
| `missingUrlError` (`:161-162`)         | nome, `urlVar`, `driverVar`           | **não**   |
| `missingDriverWarning` (`:164-166`)    | nome, `driverVar`                     | não       |
| `invalidDriverWarning` (`:168-173`)    | nome, `driverVar`, **valor do driver**, aceitos | não* |
| `resolveReportsSource` err (`:221-225`)| `overrideVar`, `sourceVar`, `REPORTS_DRIVER` | **não** |
| `server.ts:118` / `:122`               | prefixo `server: ` + a mensagem       | não       |

`missingUrlError` é a função com acesso natural ao valor da URL e **não o toca** — é o ponto que
importava e está certo.

\* O resíduo: `X_DRIVER` **pode conter** uma connection string, se quem montou o ambiente colar a URL
na variável errada — erro banal e frequente. Aí a credencial vai para o stderr. Recomendo truncar/
redigir o eco e adicionar o teste que o W0 delegou (premissa 9): env com `SENHA_SECRETA` em todas as
URLs, nenhuma mensagem pode conter a substring.

### 3. `PROGRAMS_DRIVER` tinha 3 leituras — a `:153` foi migrada corretamente?

**Sim, e a migração corrigiu de quebra uma divergência entre as duas leituras.** Confirmei as três
ocorrências no `HEAD` (`git show HEAD:src/server.ts`): `:150` (`PROGRAMS_DATABASE_URL`), `:153`
(guarda do read port de contracts) e `:212` (o módulo `programs`).

**Equivalência da `:153`.** Antes:

```ts
if (process.env['PROGRAMS_DRIVER'] === 'mysql'
    && programsWriterUrl !== undefined
    && programsWriterUrl.length > 0) { … }
```

Depois (`server.ts:162-165`): `if (programs.driver === 'mysql')`. A tripla condição está **inteira**
dentro da variante: `readVar` (`:135-138`) devolve `undefined` para vazio, e o ramo `mysql`
(`:182-188`) só constrói a variante `mysql` quando `url !== undefined`. Logo
`programs.driver === 'mysql'` ⟺ `PROGRAMS_DRIVER === 'mysql'` **E** URL presente **E** não-vazia.
Semântica idêntica.

**Diferença deliberada, e é melhoria:** em produção, `PROGRAMS_DRIVER=mysql` sem URL agora nem chega
aqui (o boot já caiu com 78) em vez de pular o read port e degradar o bloco `program` calado. Não fere
ADR-0032, que trata da composição **indisponível** (pool que não abre), não da configuração ausente.

**Bônus — bug latente fechado:** `:153` e `:212` **discordavam entre si**. A `:212` testava só
`PROGRAMS_DRIVER === 'mysql'` e passava `writerUrl` por spread condicional. Com
`PROGRAMS_DATABASE_URL=''`, a `:153` pulava o read port (por causa do `length > 0`) enquanto a `:212`
montava o módulo `programs` em mysql com `writerUrl: ''`. Duas leituras da mesma variável, dois
resultados. Agora as duas partem de `modules.programs` e concordam por construção. Vale citar isso no
corpo do PR.

---

## Confirmação explícita — FR-008: os dois ADR que não podiam ser atropelados

### ADR-0026 (réplica de leitura) — **PRESERVADO** ✅

Citação literal, `handbook/architecture/adr/0026-mysql-read-write-split-connection.md:38-40`:

> ### Single node hoje, réplica depois
>
> Enquanto houver uma só instância, **ambos os pools apontam para o mesmo host** — comportamento
> idêntico ao atual. Ao introduzir a réplica, o pool de leitura passa a apontar para o
> `reader endpoint`. **Zero mudança de código** — só a connection string injetada no composition root
> muda.

Tornar `CONTRACTS_READER_URL`/`PARTNERS_READER_URL` obrigatórias contradiria "single node hoje" e
"zero mudança de código". **Não aconteceu.** Provas:

1. **A guarda não conhece as variáveis.** `MODULE_SPECS` (`module-driver-config.ts:85-104`) declara
   apenas `driverVar`/`urlVar` por módulo. Busca no arquivo inteiro: `READER_URL` não aparece
   nenhuma vez. A guarda é literalmente incapaz de cobrá-las.
2. **Continuam lidas direto do ambiente, com spread condicional**, exatamente como antes —
   `server.ts:176` (`const contractsReaderUrl = process.env['CONTRACTS_READER_URL']`) e `:194`
   (partners), consumidas em `:182` e `:200` por `...(x !== undefined ? { readerUrl: x } : {})`.
   O `git diff` mostra que essas linhas não mudaram de forma, só de vizinhança.
3. **Caso 13 verde**, com `PROD_ALL_MYSQL` deliberadamente sem as duas variáveis: `ok === true`, e com
   o relatório de erros aberto por outro motivo nenhuma mensagem cita `READER_URL`.
4. `scripts/e2e/bruno-all.sh:64-65` (que declara `CONTRACTS_READER_URL`/`PARTNERS_READER_URL`) e
   `scripts/e2e/contracts.sh:46-49` (que **não** declara) continuam ambos válidos.

Ressalva registrada em **S3**: a prova cobre o canal de erro; o canal de `warnings` não é asserido.

### ADR-0032 (composição de programa degradável) — **PRESERVADO** ✅

Citação literal, `handbook/architecture/adr/0032-transient-http-composition-read-until-bff.md:40`:

> 4. **As duas opções coexistem por design.** Como a composição está na **borda** (não no núcleo),
>    trocar "API compõe" por "BFF compõe" não toca `domain`/`application`. Hoje a API compõe; amanhã o
>    BFF assume a mesma orquestração e a rota gorda é removida — sem refactor de núcleo.

E `:39`: _"**Transitoriedade declarada.** A rota composta nasce marcada como provisória (…)
**Condição de remoção explícita: quando o BFF v2 assumir a composição.**"_ — uma composição
provisória e removível não pode virar pré-requisito de boot.

**A degradação continua idêntica.** `server.ts:162-171`:

```ts
const programs = modules.programs;
let programsReadPort: ProgramsReadPort | undefined = undefined;
if (programs.driver === 'mysql') {
  const portR = await buildProgramsReadPort({ connectionString: programs.connectionString });
  if (portR.ok) programsReadPort = portR.value;
  else
    process.stderr.write(
      `server: programs read port indisponível (${portR.error}) — bloco program degradado\n`,
    );
}
```

O `else` continua **stderr + segue o boot** — não virou `err`, não virou `exit`, não entrou no
relatório da guarda. E os dois consumidores em `:183` e `:187` seguem com spread condicional
(`...(programsReadPort !== undefined ? { programReadPort: programsReadPort } : {})`), ou seja, o
`contracts` sobe com **e** sem o bloco `program`. Caso 14 verde confirma o lado da guarda
(`programs=memory` + `contracts=mysql` → `ok`), e o W1 provou o lado do runtime por execução manual
(endereço inacessível → mensagem de degradação + boot seguiu).

**Nenhum dos dois foi endurecido. FR-008 cumprido.**

---

## FR-009 — regressão no `server.ts`? (varredura linha a linha do diff)

| Ponto verificado                             | Antes                                                                 | Depois                                                | Veredito |
| -------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | -------- |
| Ordem: guarda antes de qualquer pool          | —                                                                     | `:116` guarda → `:149` `buildAuthHttpDeps` (1º pool)  | ✅ T020 cumprida |
| Ordem: guarda antes de `app.listen`           | —                                                                     | `:424`                                                | ✅ |
| `readHttpConfig` continua primeiro            | `:109`                                                                | `:109`                                                | ✅ inalterado |
| `authConnString` passado mesmo com driver `memory` | sim (`...(authConnString !== undefined ? … : {})`, sem olhar o driver) | só no ramo `mysql` (`:152`)                     | ✅ inócuo — `auth/…/composition.ts` retorna do ramo memory (`:~306`) **antes** de tocar `config.connectionString` (`:309`) |
| `programs` read port (`:153`)                 | tripla condição                                                       | `programs.driver === 'mysql'`                         | ✅ equivalente (ver ponto 3 acima) |
| `programs` módulo (`:212`)                    | só o driver + spread condicional                                      | mesma variante do read port                           | ✅ corrige divergência latente |
| `contracts`/`partners`/`financial` `writerUrl`| spread condicional                                                    | campo direto                                          | ✅ garantido pelo tipo |
| `budget-plans` aceitava URL `''`              | `!== undefined` sem checar vazio                                      | vazio ≡ ausente                                       | ⚠️ mudança **intencional**, documentada (caso 9 + Edge Case) |
| Cascata do `reports`                          | `??` no `server.ts`                                                   | resolvida na guarda, override vence                   | ✅ caso 11 prova; ver **S8** para o `''` |
| Graceful shutdown / `main().catch`            | —                                                                     | inalterado                                            | ✅ |
| Consumidores externos da config do `reports`  | 7 testes chamam `buildReportsHttpDeps({ driver: 'memory' })`          | continuam válidos na união                            | ✅ |
| `scripts/e2e/*.sh`                            | 4 scripts, todos pareiam `X_DRIVER=mysql` com a URL                   | nenhum quebra                                         | ✅ conferido um a um |
| `compose.yaml` (`http`)                       | 7 drivers + 6 URLs exportadas, cascata do reports resolve             | boot idêntico                                         | ✅ (mas ver **B1** sobre `NODE_ENV`) |

**Nenhuma regressão sutil encontrada no caminho feliz.** As duas únicas mudanças de comportamento em
ambiente correto são intencionais e documentadas (URL vazia ≡ ausente; `mysql` sem URL falha em
qualquer ambiente — esta última é a **M2**).

## Conformidade com as regras invariantes

| Regra                                                        | Resultado |
| ------------------------------------------------------------ | --------- |
| Zero `class`, zero `this`, zero `extends Error`              | ✅ |
| Zero `any`, zero `as` (nem em smart constructor — não há)    | ✅ |
| Zero `throw` na guarda (D2: quem encerra é o `server.ts`)    | ✅ |
| Anti-padrão #7 (`throw` no `default` de switch exaustivo)    | ✅ nenhum `default`; os dois switches (`:181`, `:248`) retornam de todo `case` e a exaustividade é provada por `tsc` (`noImplicitReturns`) + `@typescript-eslint/switch-exhaustiveness-check` (`eslint.config.js:132`) |
| Imports com extensão `.ts` + `#src/*`                        | ✅ (`:23`, `server.ts:13`) |
| `import type` / `type X` inline (`verbatimModuleSyntax`)     | ✅ (`import { combine, err, ok, type Result }`) |
| Idioma: identificadores EN                                   | ✅ `readModuleDriverConfigs`, `ModuleDriverConfig`, `resolveReportsSource`, `warnings` |
| Idioma: mensagens ao humano em PT                            | ✅ (sem acentuação, justificado no cabeçalho `:18-20` — coerente com o molde) |
| Discriminador em EN (`driver`, `kind`)                       | ✅ |
| `Readonly<>` nos tipos de configuração e nos arrays          | ✅ |
| Comentários: só o "porquê" não-óbvio                         | ✅ nenhum decorativo — ver §"O que está bom" |
| Ticket em `.claude/.pipeline/` antes de tocar `src/`         | ✅ |
| Módulo isolado (ADR-0014): nada cruza fronteira              | ✅ vive em `shared/`, fora de todo bounded context |

---

## O que está bom

Registro sem economia, porque é bastante:

1. **FR-001 cumprido de fato, não no papel.** `grep -n "_DRIVER" src/server.ts` → **zero ocorrências**.
   As 8 leituras viraram 1 chamada. SC-004 ("a regra existe em um só lugar") é verificável por comando.
2. **O estado impossível ficou irrepresentável, não "checado de novo".** A união discriminada faz o
   compilador garantir o que antes era convenção: os spreads
   `...(x !== undefined ? { writerUrl: x } : {})` viraram campo direto em 4 módulos, e os **4 `throw`**
   de `reports/composition.ts:106-119` sumiram sem nenhum `if` os substituindo. É a leitura correta do
   `data-model.md:17`, aplicada até o fim.
3. **`DriverDeclaration` (`:74-78`) é a boa ideia do diff.** Separar `absent` de `invalid` **na
   leitura** promove `memory` a valor de primeira classe e faz `X_DRIVER=''` ≡ omitida sair de graça
   — o caso 9 prova por `deepEqual` entre os dois relatórios, que é a forma certa de testar isso
   (sem prescrever texto).
4. **A cascata do `reports` foi resolvida no lugar certo** (endereço **efetivo**, D4), e o caso 11 usa
   URLs distintas por módulo para provar que cada fonte cai no módulo **certo** — não numa URL
   qualquer. É a diferença entre um teste que passa e um teste que prova.
5. **Higiene do refactor:** T030 conferida (`grep -rn "reports-composition" tests/` → 0), nenhum teste
   existente alterado/afrouxado/removido, `+69/−99` linhas (o diff **encolhe** a base).
6. **Comentários exemplares.** `:125-129` (por que `MEMORY` existe no ramo de erro — antecipa
   exatamente a suspeita que um revisor teria), `:196-198` (por que o typo também cobra a URL),
   `:230-233` (por que `combine` precisa de argumentos de tipo explícitos), `:218` (por que se valida
   o endereço efetivo). Todos "porquê", nenhum "o quê".
7. **O REPORT do W1 entregou os três pontos difíceis para o revisor de bandeja**, inclusive o que
   enfraquece a própria entrega (o `memory` silencioso) e o que não tem teste (a invariante de
   credencial). Isso é o oposto de esconder — e encurtou esta review de forma real.
8. **A armadilha do `eslint` na worktree** (`003-impl/REPORT.md:73`) é achado de valor permanente:
   rodar da raiz contra `.claude/worktrees/` sai exit 0 **sem lintar nada**, porque o flat config
   ignora `.claude/**`. Merece virar linha no cheatsheet.

---

## Próximo passo

**REJECTED → volta para W1 (round 2).** O que fecha o round:

1. **B1 (obrigatório):** executar a T006 — apurar e registrar o `NODE_ENV` efetivo + a configuração de
   driver real de QA e PROD contra `contracts/env-matrix.md`; decidir/registrar o encaminhamento
   (issue própria ou ajuste no mesmo deploy, com o P.O.). Sem isso não se sabe se a guarda dispara
   onde precisa.
2. **M1:** decidir com o P.O. se `memory` explícito em produção avisa. Recomendo que sim; se ficar
   como está, registrar a decisão na spec.
3. **M2:** caso 15 (`mysql` sem URL fora de produção) + alinhar FR-003/FR-006 com OBR-M.
4. **M3:** teste da invariante de credencial + truncar o eco do valor de `X_DRIVER`.
5. **M4:** `README.md:120`, `.claude/rules/adapters.md`, comentário de `compose.yaml:279-281` e a T045.
6. **🔵 S1–S8:** julgamento do W1 — nenhuma bloqueia; S1, S3 e S6 são baratas e valem no mesmo round.

Round atual: **1 de 3**.

---
---

# Code Review — SHARED-DRIVER-BOOT-GUARD — Round 2

**Veredito:** **APPROVED**

- **Reviewer:** `code-reviewer` (W2, read-only)
- **Data:** 2026-07-22
- **Delta revisado:** C1–C4 do `003-impl/REPORT.md` §"Round 2 — correções do W2" + `001-rollout-check.md` (novo)
- **Round:** 2 de 3

> O round 1 fica preservado acima como histórico auditável. Esta seção registra o estado de **cada**
> achado, as verificações que rodei **por execução** (não por leitura do REPORT) e os dois julgamentos
> que o coordenador pediu explicitamente.

## Gates que rodei nesta worktree (round 2)

```
node --test … tests/shared/persistence/module-driver-config.test.ts  → tests 14 · pass 14 · fail 0
pnpm run typecheck                                                    → exit 0
pnpm run lint                                                         → exit 0
pnpm test                                                             → tests 4322 · pass 4303 · fail 0 · skipped 19
```

Contagem idêntica à do round 1 (4322): nenhum teste adicionado, alterado ou removido — como declarado.

---

## Estado de cada achado do round 1

| #      | Achado                                             | Estado                                                                                       |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **B1** | `NODE_ENV` de PROD/QA — guarda podia nascer inerte | **Premissa refutada por evidência literal** + residual escalado como gate de merge (§B1)       |
| **M1** | `memory` explícito mudo em produção                | ✅ **Corrigido** (C2) — verificado por execução                                                 |
| **M2** | `mysql` sem URL fora de produção: sem teste        | 🟡 **Aberto** — aceito como follow-up (§"Os testes que faltam")                                 |
| **M3** | Eco de credencial + teste da invariante            | ✅ **Vulnerabilidade fechada** (C3, verificada por execução) · 🟡 **teste ainda ausente**        |
| **M4** | `README.md:120` afirma o contrário do código       | 🟡 **Aberto** — discordo parcialmente da triagem (§"Triagem do W1")                             |
| **S1** | Dois relatórios de config, dois `exit` distintos   | 🔵 Aberto, aceito — concordo com o adiamento                                                    |
| **S2** | `process.exit` podia truncar o diagnóstico         | ✅ **Corrigido** (C1) — verificado por execução nos **dois** blocos                              |
| **S3** | Caso 13 não assere sobre `warnings`                | 🔵 Aberto — e agora **mais relevante**, porque o C2 criou avisos novos (§N3)                    |
| **S4** | Degradação do ADR-0032 sem teste de fumaça         | 🔵 Aberto, aceito                                                                               |
| **S5** | Assimetria `reports` × outros composition roots    | ✅ **Resolvido em espírito pelo C4** — hoje os 6 são simétricos (verifiquei)                     |
| **S6** | `ReportsDriver` órfão                              | 🔵 Aberto, aceito (mudança de superfície pública)                                               |
| **S7** | Cascata lê env cru do módulo-fonte                 | Observação — inalterada por desenho (FR-009)                                                    |
| **S8** | `REPORTS_*_DATABASE_URL=''` sem teste              | 🔵 Aberto — garantia agora **documentada no código** (`:254-257`) e provada por execução         |

---

## Verificação das 4 correções (por execução, não por leitura)

### C1 — `process.exitCode = 78; return;` ✅

Rodei os **dois** blocos com stderr **em pipe** (o caminho assíncrono do POSIX, onde o defeito mora).
O REPORT do W1 só provou o primeiro:

```
===== (1) GUARDA DE DRIVERS — producao sem nada, stderr EM PIPE =====
server: auth: AUTH_DRIVER nao configurada — obrigatoria em producao (valores aceitos: "mysql" ou "memory")
… (7 linhas)
--- exit=78

===== (2) GUARDA DE E-MAIL (bloco pre-existente) — drivers OK, links ausentes, EM PIPE =====
server: auth: AUTH_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil, perdido no restart)
… (7 avisos)
server: AUTH_RESET_BASE_URL nao configurada (obrigatoria em producao para o link de e-mail)
server: AUTH_ACTIVATION_BASE_URL nao configurada (obrigatoria em producao para o link de e-mail)
server: PARTNERS_SELF_REGISTRATION_BASE_URL nao configurada (obrigatoria em producao para o link de e-mail)
--- exit=78
```

**(a) O `return` impede o boot de prosseguir em todos os caminhos?** **Sim.** Três verificações:

1. **Estático:** `main()` é `async` e é chamada uma única vez, em `main().catch(...)` (`:449`). Um
   `return` resolve a promise; não há `finally`, não há chamador que continue. Os dois blocos ficam
   **antes** de todo `await` de composição (`buildAuthHttpDeps` é o primeiro, `:172`), antes de
   `installLastResortHandlers` e antes de `app.listen`. Nenhum `process.on` foi registrado ainda.
2. **Empírico:** os dois casos acima **terminaram** (não penduraram) e com o código 78 — ou seja, o
   event loop de fato esvaziou, que era a única dúvida real do `exitCode` + `return`.
3. **Ordem preservada:** no caso (2) os 7 avisos **e** os 3 erros saíram, provando que o `return` do
   bloco de e-mail não engole o que o bloco anterior escreveu.

**(b) Tocar o bloco pré-existente foi scope-creep?** **Não — foi correto.** Julgamento independente:

- O anti-padrão #15 / ADR-0040 existe contra **perda de foco** e **crescimento indefinido de diff**.
  Aqui são **2 linhas**, na **mesma função**, no **mesmo arquivo** já sob edição, corrigindo o
  **mesmo defeito** que a review acabou de apontar no código novo. Nem perda de foco, nem diff
  inflado: o `server.ts` cresceu 13 linhas contra o round 1, quase todas comentário.
- **É in-scope por FR-013**, não apenas adjacente. FR-013 é literal: _"**Toda** falha de configuração
  de persistência MUST usar o **mesmo** código de saída, distinto do código de falha genérica"_. Um
  `exit 78` que chega mudo ao coletor de log **não é** um código de saída utilizável para
  diagnóstico: a plataforma vê 78 e o humano não vê nada. Deixar um dos dois `exit 78` do mesmo
  arquivo confiável e o outro não produz exatamente a ambiguidade que o FR-013 quer eliminar — o
  operador vê 78 mudo e não sabe qual das duas guardas falou.
- O argumento "metade certa é pior" se sustenta e é **verificável**: no caso (2) acima, os dois
  relatórios saem no mesmo boot. Se só o bloco novo tivesse sido corrigido, esse mesmo cenário
  poderia entregar os 7 avisos e **perder** os 3 erros de e-mail — pior que antes da feature.
- **Ressalva de higiene (não bloqueia):** a mudança em código pré-existente **precisa** aparecer no
  corpo do PR. Quem revisar um PR intitulado "guarda de driver de persistência" não espera encontrar
  a guarda de e-mail (#331/#332) alterada. Uma linha na descrição resolve.

### C2 — aviso de `memory` declarado em produção ✅

Verificado por execução (caso 2 do C1): os 7 módulos emitem aviso, **nenhum erro**, e o boot **segue**
(o processo só encerrou por causa do bloco de e-mail; com as base URLs presentes, sobe).

- **FR-007 honrado.** `module-driver-config.ts:221-225`: o ramo `memory` devolve `errors: []` nos dois
  ambientes; só o canal de `warnings` muda. FR-007 exige _"sem falhar e sem exigir configuração
  adicional"_ — continua valendo ao pé da letra.
- **"Declarado" × "degradado" distinguidos**, como M1 pedia. Os dois textos não se confundem:
  - declarado: `AUTH_DRIVER=memory DECLARADO em producao — a API NAO le o MySQL (dado volatil…)`
  - degradado: `AUTH_DRIVER nao configurada — usando memory (dado volatil, perdido no restart)`
- **Fora de produção segue silencioso** (`:225`), o que é o certo: memória é o normal em dev e em
  `pnpm test`; avisar ali viraria ruído e mataria o sinal.
- **Não contamina os 14 casos**, e conferi o porquê em cada um: caso 4 (`deepEqual(warnings, [])`)
  roda sobre `PROD_ALL_MYSQL`, sem nenhum `memory`; caso 7 (`warnings.length === 7`) não tem
  `NODE_ENV`; caso 8 (`PROD_ALL_MEMORY`) assere só `ok` + drivers. Suíte verde confirma.
- Recupera o alarme do PR #488 e o **generaliza de 1 para 7** módulos — exatamente o que a R4 do
  `research.md` pedia ao mandar absorver o aviso pontual na regra compartilhada.

### C3 — filtro do eco do valor de driver ✅

Rodei os quatro cenários que importam:

```
(a) URL colada + "\n" de log injection (88 chars)
    server: auth: AUTH_DRIVER com valor invalido (nao exibido — 88 caracteres fora do formato de driver) …
    → sem SENHA_SECRETA, sem core_app, sem host, e a "linha forjada" NAO apareceu

(b) typo plausivel  → server: auth: AUTH_DRIVER com valor invalido "mysqll" …   (caso 3 do W0 coberto)
(c) "mysql+ssl"     → (nao exibido — 9 caracteres fora do formato de driver)
(d) "AKIAIOSFODNN7EXAMPLE" (20 chars, [\w]) → ecoado inteiro                     (residual, ver N2)
```

**O regex fecha o vetor de verdade** — análise, não só empiria:

- `DRIVER_VALUE_ECHO_SHAPE = /^[\w.-]{1,20}$/` — a classe é `[A-Za-z0-9_.-]`, que **exclui** `:`, `/`,
  `@`, `%` e espaço. Uma connection string é estruturalmente incapaz de casar: precisa de `://`. O
  vazamento por variável trocada (**CWE-532**) está fechado por **forma**, não por tamanho — e a lição
  registrada pelo W1 (truncar em 20 ainda entregava os 3 primeiros caracteres da senha, porque o
  prefixo de uma URL é justamente onde moram usuário e início de senha) está correta.
- **CWE-117 (log injection) fechado no mesmo movimento, e sem depender do `$`:** `\n` e `\r` não estão
  na classe, então um valor com quebra de linha não casa em posição nenhuma. Vale registrar que a
  defesa **não** depende da semântica do `$` — em JavaScript, ao contrário de Python/Perl, `$` sem
  flag `m` casa só no fim absoluto da entrada e **não** antes de um `\n` final. Duas barreiras
  independentes.
- **O caso 3 do W0 continua coberto** (`/mysqll/` casa) e o caso 6 idem — suíte verde.

### C4 — simetria da checagem de vazio ✅ (com ressalvas — ver o julgamento pedido)

Parte 1 (normalização na guarda), verificada por execução: `REPORTS_DRIVER=mysql` +
`PARTNERS_DATABASE_URL=''` → erro nomeando a variável, exit 78. `''` ≡ ausente nos **dois** degraus da
cascata, o que é estritamente melhor que o `??` de antes (onde um override vazio **vencia** a cascata
e chegava vazio no pool). A garantia está documentada no ponto onde é feita (`:254-257`).

Parte 2 (checagem defensiva no adapter): julgamento na seção seguinte.

---

## Julgamento pedido — a checagem defensiva em `reports/composition.ts`

**Veredito: justificada. Manter. Não é código morto nem contradiz a T028** — com duas ressalvas
registradas como follow-up.

**A favor (o que verifiquei, não o que o REPORT afirma):**

1. **A simetria é real — conferi os cinco.** Todos os outros composition roots mantêm a checagem
   idêntica, mesma forma e mesma família de mensagem:

   ```
   auth/adapters/http/composition.ts:309       config.connectionString … length === 0 → throw 'auth-composition: driver mysql exige connectionString'
   contracts/adapters/http/composition.ts:388  config.writerUrl … length === 0        → throw 'contracts-composition: driver mysql exige writerUrl'
   partners/adapters/http/composition.ts:481   idem
   programs/adapters/http/composition.ts:108   idem
   financial/adapters/http/composition.ts:785  idem
   ```

   Sem o C4, o `reports` seria o **único** dos seis sem defesa de conteúdo. Removê-la teria sido uma
   assimetria **introduzida** por este ticket, não uma limpeza.
2. **O tipo garante presença, não conteúdo, e o TypeScript não tem como expressar a diferença.**
   `{ driver: 'mysql', partnersUrl: '' }` type-checka. Não existe `NonEmptyString` sem branded type.
   A checagem cobre exatamente o delta entre o que o tipo prova e o que o adapter precisa.
3. **Não é o que a T028 removeu.** A T028 tirou **validação de ambiente**: quatro `throw` que
   nomeavam env, interrompiam o boot **uma fonte por vez** e saíam com exit 1 — o defeito que o FR-012
   descreve. O que voltou é **uma** assertiva de invariante de contrato, sem nome de env, cobrindo as
   quatro de uma vez, inalcançável a partir do `server.ts`. A distinção está escrita no comentário e
   se sustenta.

**Ressalvas (🔵, follow-up, não bloqueiam):**

- **Tensão com o princípio que o próprio diff enuncia.** `module-driver-config.ts:28-29` diz literal:
  _"o estado `mysql` sem `connectionString` e irrepresentavel, e por isso **nao precisa ser checado de
  novo adiante**"_. O C4 checa de novo adiante. A resolução limpa não é remover a checagem — é a
  guarda produzir um branded `NonEmptyConnectionString`, o que tornaria a invariante *type-level* e
  a checagem literalmente desnecessária nos **seis** composition roots. Vale ticket próprio, não este.
- **Se disparar, sai com exit 1, não 78** (propaga para `main().catch` → `process.exit(1)`) —
  precisamente a confusão "config errada × app quebrada" que o FR-013 quer eliminar. Hoje é
  inalcançável pelo boot, então não fere o FR-013 na prática; mas o "chamador futuro" invocado como
  justificativa é justamente quem cairia no código de saída errado.
- **Perda de diagnosticabilidade contra as quatro que substituiu:** `'exige as 4 connection strings
  nao-vazias'` não diz **qual** está vazia. Para o chamador futuro que é a razão de ser da checagem,
  isso é pior que a mensagem antiga. Nomear o campo custa uma linha (filtrar sobre pares
  `[nome, url]`) e é a melhoria que eu faria.

---

## Achados novos do round 2

Nenhum 🔴, nenhum 🟡. Três 🔵:

**N1 — `exitCode` + `return` troca um modo de falha por outro, mais raro e mais grave.**
`server.ts:126` e `:153`. O `exit 78` truncava a mensagem; o `exitCode` + `return` depende de o event
loop **esvaziar**. Hoje esvazia (provei: os dois casos terminaram com 78). Mas isso passa a depender
de uma propriedade global e não testada: **nenhum módulo importado por `server.ts` pode registrar um
handle em escopo de módulo**. No dia em que alguém adicionar um `setInterval` ou um keep-alive em
escopo de import, a guarda deixa de sair 78 e passa a **pendurar** — container em boot-loop mudo, pior
que a truncagem original, e nenhum teste pegaria. O padrão é o mesmo dos jobs e dos 5 workers
(precedente citado corretamente), então não peço mudança; registro para que a escolha seja consciente.
Mitigação barata, se um dia doer: um `setTimeout(...).unref()` de watchdog, ou um teste de fumaça que
afirme o exit code.

**N2 — o filtro do C3 tem três efeitos colaterais aceitos, todos verificados.**
(a) Um segredo curto de `[\w.-]` **ainda é ecoado** — provei com `AKIAIOSFODNN7EXAMPLE` (20 chars,
ecoado inteiro). Implausível numa variável de driver, e a alternativa (nunca ecoar) mataria o
diagnóstico de typo que o FR-010 exige; aceito. (b) Typos com caractere fora da classe (`mysql+ssl`,
`my sql`) somem atrás de `(nao exibido — N caracteres…)`, menos útil para quem digitou errado; aceito,
a mensagem ainda lista os valores aceitos. (c) `String(value.length)` revela o comprimento do valor
colado — contra um leitor de log que conheça o template da URL, isso limita superiormente o tamanho da
senha. Valor de diagnóstico baixo; é a única informação que dá para remover sem custo se incomodar.

**N3 — o C2 tornou o S3 mais relevante do que era.**
O caso 13 (o teste que protege o ADR-0026) só assere sobre o **canal de erro**:
`assert.equal(errorText(broken).includes('READER_URL'), false)`. Antes do C2, o canal de `warnings` em
produção estava praticamente vazio; agora é populado de rotina (todo `memory` declarado avisa). Uma
implementação futura que resolvesse "avisar sobre réplica ausente" passaria pelo caso 13 sem acender
nada — e poluiria o boot de todo single-node com um aviso sobre algo que é **opcional por ADR**. A
asserção espelhada em `warnings` custa uma linha e vale mais agora do que valia no round 1.

---

## Os testes que faltam — é bloqueante?

**Não é bloqueante. Mas os três não são equivalentes, e um deles precisa de dono explícito.**

| Teste ausente                                                    | Peso                                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| **M3 — nenhuma mensagem ecoa credencial**                          | **O mais importante do ticket** — ver argumento abaixo                                    |
| **M2 — `mysql` sem URL fora de produção (OBR-M)**                  | Médio: fixa uma regra deliberada que hoje só existe no código e na matriz, não na spec    |
| **S3 — caso 13 sobre `warnings`** · **S8 — override `''`**         | Baixo: uma linha cada, fecham flancos estreitos                                           |

**Por que o M3 pesa mais que os outros:** o próprio W1 documentou que a **primeira** versão do
controle parecia certa e **ainda vazava** os 3 primeiros caracteres da senha. Isso é evidência direta
de que este controle específico é fácil de errar e difícil de conferir a olho. Um controle de
segurança que (a) é fácil de errar, (b) já foi errado uma vez **neste mesmo ticket** e (c) não tem
nenhuma cobertura automatizada é um controle com validade indeterminada: a próxima pessoa que mexer em
`echoableDriverValue` — ou que adicionar uma oitava mensagem ao módulo — reabre o vazamento com o gate
100% verde. O teste é barato (um env com `SENHA_SECRETA` em todas as URLs **e** no `X_DRIVER`,
assertando que a substring não aparece nem em `error` nem em `warnings`) e é o único que protege
código já comprovadamente escorregadio.

**Por que ainda assim aprovo:** o comportamento de hoje está **verificado por execução** nos quatro
cenários que importam; o congelamento da contagem foi restrição do coordenador para este round; e um
round 3 gastaria um ciclo inteiro para adicionar quatro asserções — o lugar certo é o polish do W3 ou
uma issue linkada ao PR. **Recomendo fortemente que o M3 entre neste mesmo PR**; se não entrar, que
saia como issue criada **antes** do merge, não depois.

---

## Triagem do W1 — concordo?

**Concordo com 5 das 6 linhas.** Divergência parcial em uma:

| Item                       | Concordo?      | Observação                                                                                                        |
| -------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| B1 (infra, humano)         | ✅             | Correto — e o `001-rollout-check.md` foi além do que eu pedi (§B1)                                                  |
| M2 (teste novo, contagem)  | ✅             | Aceito. Ressalva: _"a redação da spec é que precisa alinhar"_ é verdade e **também** ficou por fazer — mesmo follow-up |
| **M4 (documentação)**      | ⚠️ **parcial** | Ver abaixo                                                                                                          |
| S1 (unificar relatórios)   | ✅             | Integralmente: é UX de operação, e mexer na ordem do relatório neste round teria risco sem retorno                  |
| S3/S4/S6/S7/S8             | ✅             | Aceito. Só o S3 subiu de peso por causa do C2 (§N3)                                                                 |
| S10 (eco do mysql2)        | ✅             | Fora do diff — anti-padrão #15 aplicado corretamente                                                                |

**Sobre o M4.** O W1 classificou como _"documentação fora do escopo das 4 correções recebidas"_ e
reconheceu que é _"real e pertinente — o README hoje afirma o contrário do código"_. A classificação
está formalmente certa (não estava nas 4 correções) e materialmente incompleta: `README.md:120` não é
documentação *adjacente* — é a descrição do **exato comportamento que este PR muda**, e passa a
ensinar o oposto do que o código faz (_"ausência de config degrada para in-memory (boot não cai)"_).
Corrigir a frase que o próprio diff invalida não é scope-creep: é manter o repositório verdadeiro
sobre a mudança que o PR entrega. São 3 linhas somando `README.md`, `.claude/rules/adapters.md` e o
comentário obsoleto de `compose.yaml:279-281`. **Recomendo incluir no PR.** Não aprovo condicionado a
isso, mas registro que sair sem essa correção deixa o repo se contradizendo no dia do merge.

---

## ADR-0026 e ADR-0032 — continuam intactos após o round 2? ✅ Sim

Reconferi do zero, não por herança do round 1 — o C2 mexeu justamente nos dois `case 'memory'`, que é
onde um deslize atingiria o FR-008.

**ADR-0026** — `grep -n "READER_URL" src/shared/persistence/module-driver-config.ts` devolve **uma**
ocorrência, e é o **comentário** de cabeçalho (`:15`) que declara a exclusão:

> _"Fora desta guarda por decisao registrada (FR-008): endereco de replica de leitura
> (`*_READER_URL`, ADR-0026) e composicao de programa em contratos (ADR-0032)"_

Zero ocorrências em código. As leituras seguem diretas no `server.ts:187` e `:205`, consumidas por
spread condicional em `:200` e `:218`. Caso 13 verde. A citação normativa continua honrada —
`0026-mysql-read-write-split-connection.md:38-40`: _"Enquanto houver uma só instância, **ambos os
pools apontam para o mesmo host** (…) **Zero mudança de código**"_.

**ADR-0032** — o bloco `server.ts:170-181` está **byte a byte** como no round 1: `if (portR.ok) … else
process.stderr.write('… bloco program degradado')`, sem erro, sem exit, fora do relatório da guarda.
Caso 14 verde. Honra `0032-…:40`: _"**As duas opções coexistem por design.** Como a composição está na
**borda** (não no núcleo)…"_ — uma composição provisória e removível não pode virar pré-requisito de
boot, e não virou.

**Nenhum dos dois foi tocado pelo round 2. FR-008 segue cumprido.**

---

## §B1 — o Blocker do round 1, revisitado

**Minha premissa estava errada, e o `001-rollout-check.md` a refuta com citação literal.** Registro
sem rodeios, porque é lição de método: inferi _"o `compose.yaml` é a fonte de verdade de PROD"_ a
partir de conhecimento prévio e **não abri o cabeçalho do arquivo que eu mesmo estava citando**. O
cabeçalho diz o contrário (`compose.yaml:2` e `:10-11`):

> _"Docker Compose — ambiente de **DESENVOLVIMENTO/HOMOLOGAÇÃO local** (…) **Em produção este compose
> NÃO sobe** — endpoints viram managed services (AWS S3, AWS RDS/Cloud SQL) com secrets vindo do
> Secrets Manager."_

E `Dockerfile:96` — `ENV NODE_ENV=production` — é a imagem que roda em produção. O `NODE_ENV:
development` de `compose.yaml:283` é deliberado para o compose local e não alcança PROD. É o
anti-padrão #12 ("citar de memória em vez de abrir o arquivo") aplicado a mim: o achado era legítimo
como **dúvida**, mas eu o classifiquei como Blocker sobre uma premissa que 10 linhas de leitura teriam
derrubado. Reclassificado.

**O que sobra, e sobra de verdade:**

- **QA** roda com compose não-versionado, editado à mão no host (drift conhecido). Se `NODE_ENV !=
  production` lá, a guarda **não** falha o boot e o QA segue podendo servir memória em silêncio — o
  cenário do #374. Se `NODE_ENV = production` e o host não declarar os 7 drivers, o próximo deploy
  **para de subir**.
- Estritamente, o taskdef de ECS vive no **ERP-INFRA**, fora deste repositório, e não é verificável
  daqui — a evidência do `Dockerfile` é forte, mas não prova que o taskdef não reinjeta `NODE_ENV`.

**Registro, conforme pedido:** é **condição de merge**, não pendência de código.

> **Gate de merge (humano, infra — não bloqueia o código):** antes do merge, conferir no host do QA o
> `NODE_ENV` efetivo e a lista de `*_DRIVER` declarados — `tr '\0' '\n' < /proc/1/environ`, porque
> `docker exec env` **não** mostra as `*_DATABASE_URL` injetadas em runtime. Idem para o `NODE_ENV`
> do taskdef de PROD no ERP-INFRA. Registrado em `001-rollout-check.md` §T006 e §QA.

O `001-rollout-check.md` executa a T005 e a T006 do `tasks.md` — que era literalmente o que faltava no
round 1 — e ainda tabela o risco R3 nas duas direções por ambiente. É o artefato certo, no lugar certo.

---

## Por que APPROVED (e por que não um round 3)

O veredito sobre o **código** é incondicional:

1. As quatro correções estão certas e **cada uma foi verificada por execução por mim**, não aceita do
   REPORT — inclusive o caminho que o W1 não tinha provado (o bloco de e-mail do C1) e o vetor que ele
   descreveu mas eu quis ver com meus olhos (a URL colada + `\n` do C3).
2. O Blocker do round 1 caiu por evidência literal, e o residual é infra, com dono humano e gate
   registrado.
3. Os dois ADR de risco continuam intactos, reconferidos do zero depois de o C2 mexer justamente nos
   ramos `memory`.
4. Gates verdes na worktree: `typecheck` 0, `lint` 0, `test` 4322 · fail 0 · contagem idêntica.
5. O que resta são **quatro testes ausentes, três correções de documentação e cinco sugestões** —
   nenhum é defeito no comportamento entregue, todos estão nomeados aqui com arquivo e linha, e um
   round 3 gastaria um ciclo inteiro sem mudar uma linha de comportamento.

**Não aprovo "se mudar X".** Aprovo o código como está. O que segue é follow-up priorizado, não
condição:

1. **M3 (teste de credencial)** — neste PR, se possível; se não, issue **antes** do merge. É o que
   protege o único controle deste diff que já nasceu errado uma vez.
2. **M4 (`README.md` + `.claude/rules/adapters.md` + comentário do `compose.yaml`)** — 3 linhas; sair
   sem isso deixa o repo se contradizendo no dia do merge.
3. **M2, S3, S8** — testes de uma linha cada; polish do W3 ou issue única.
4. **N1, N2(c), ressalvas do C4, S1, S6** — registrar; nenhum tem urgência.

**Próximo passo:** W3 (`ts-quality-checker`) — gate final. E o gate de merge de infra do §B1, que é do
humano.

Round: **2 de 3** · **APPROVED**.
