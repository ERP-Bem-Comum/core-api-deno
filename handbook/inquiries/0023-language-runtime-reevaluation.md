# Inquiry-0023: Reavaliação de runtime/linguagem do core-api (TS → Deno / Dart / linguagem compilada com ADTs)

- **Status:** Open
- **Opened:** 2026-07-09
- **Closed/Decided:** —
- **Opened by:** Gabriel
- **Asked to:** IA externa (Claude Code) + pesquisa web (docs oficiais Deno/Dart, crates.io/docs.rs, opam, nuget/learn.microsoft.com, Maven Central/kotlinlang, JSR/pub.dev)
- **Impact:** estratégica — potencial ADR que `supersedes` [ADR-0002](../architecture/adr/0002-keep-nodejs-runtime.md) e [ADR-0009](../architecture/adr/0009-node-24-typescript-6-with-7-roadmap.md); toca ADR-0011/0012/0013/0020/0025/0027

---

## 1. Contexto

O core-api cresceu para **~77k LOC de produção (817 arquivos `.ts`) + ~90k LOC de testes (627 arquivos)** em 7 módulos (`auth`, `financial`, `contracts`, `partners`, `programs`, `notifications`, `budget-plans`), com arquitetura modular-monolith + ports/adapters (ADR-0006), domínio puro e pipeline fail-first W0→W3.

A dúvida surgiu de uma **percepção do responsável técnico**: a sensação de que o TypeScript estaria "perdendo o controle" do projeto conforme ele cresce. Investigando a fundo, a dor foi refinada para uma causa concreta (não "tamanho" nem "arquitetura" — ambos saudáveis):

> **Cansaço da disciplina manual.** O estilo do projeto — `Result<T,E>` sem `throw`, discriminated unions, exhaustive switch via `const _: never`, branded types, imutabilidade `Readonly<>`, smart constructors — é o estilo de uma **linguagem de tipos algébricos (ML/Rust)**, mas o TS o suporta apenas por **convenção apagável + ESLint + ADRs + code review**. As regras de `.claude/rules/domain.md` são, linha por linha, "como simular F#/Rust em TypeScript". O time gasta energia disciplinar para *simular* garantias que uma linguagem com ADTs dá **nativamente no compilador**.

Critérios de contorno declarados pelo responsável durante a investigação:

1. **Quer algo compilado.**
2. **Não** Java, **não** Go, **não** Gleam / derivados de Erlang (BEAM).
3. **JVM/.NET reabertos** (o veto era à linguagem Java, não ao ecossistema) — Kotlin explicitamente na mesa.
4. **Não quer "sofrer com drivers"** / ecossistema imaturo (motivo pelo qual Swift foi cortado da lista).
5. **MySQL 8.4 mantido** como premissa (ADR-0013/0020), salvo simulação explícita de Postgres.

---

## 2. Pergunta(s) feita(s)

Sequência de perguntas ao longo da investigação:

```
1. Viabilidade/esforço de migrar o projeto para o Deno mais moderno, usando SÓ JSR, sem pnpm/Node.
2. Quais libs no JSR substituem as atuais? Tabela por dependência.
3. O que o próprio Deno recomenda oficialmente (por camada, 2026)?
4. E se para as que têm JSR, por que não usar?
5. Mesma análise para Dart. E para Dart + Postgres. Comparar Deno vs Dart+Postgres.
6. TS parece "escapar" por ficar grande; quero algo compilado, não Java/Go. Procurar a linguagem certa.
7. Análise de camadas de Rust / OCaml / F# / Kotlin. Como seria F#? E Rust?
```

---

## 3. Respostas / Investigação

Cada alvo foi avaliado por **camada** (driver MySQL 8.4 · ORM/migrations · HTTP · validação/OpenAPI · JWT/cripto/argon2 · email · S3 · testes · tooling · fit de linguagem), via agentes de pesquisa sobre fontes oficiais.

### 2026-07-09 — Deno

- **Viabilidade alta como *port* (não rewrite):** o código já é ESM puro, roda `.ts` direto via `--experimental-strip-types` (Deno roda TS nativo), imports relativos já com extensão `.ts` (Deno exige), Web Standards já em uso (`AbortController`, `fetch`, Web Crypto), capabilities de runtime já isoladas em adapters. Domínio+aplicação portam quase intactos.
- **"Só JSR" é inviável hoje e contraria o próprio Deno:** das ~30 dependências, **só `zod` (`@zod/zod`) e `jose` (`@panva/jose`) publicam oficialmente no JSR**. Drizzle, mysql2, Fastify, `@aws-sdk/*`, nodemailer/resend são npm-only. O tutorial oficial do Deno recomenda **`npm:mysql2`** para MySQL (`docs.deno.com/examples/mysql2_tutorial/`) e **`npm:drizzle-orm` + `npm:drizzle-kit`** para ORM (`deno.com/blog/build-database-app-drizzle`), com `--node-modules-dir`. Ou seja, **o `npm:` specifier é cidadão de primeira classe no Deno**, inclusive na recomendação oficial.
- **Regra emergente de specifier:** `jsr:` para o que tem dono oficial no JSR (`@zod/zod`, `@panva/jose`, `@hono/hono`, `@std/*`) — inclusive por **proveniência Sigstore** (alinhado ao ADR-0011); `npm:` para o resto (Drizzle, mysql2, AWS SDK, resend). **Nunca** `jsr:` de mirror de terceiro (ex.: `@cayter/drizzle-orm`), que *pioraria* o supply-chain. Cuidado real: conflito de instância se uma dep transitiva puxar a versão npm da mesma lib (Zod duplicado) — resolver via dedupe no import map.
- **Única troca estrutural que o Deno empurra:** borda HTTP Fastify → **Hono** (`jsr:@hono/hono`, aposta first-party). OpenAPI, testes (`node:test` é first-class no Deno), tooling (`deno fmt/lint/check`) são opcionais/compatíveis.

### 2026-07-09 — Dart e Dart + Postgres

- **Dart é rewrite de linguagem** (TS→Dart, ~167k LOC), sem escape hatch tipo `npm:` (só pub.dev). **Fit de domínio bom** (Dart 3: `sealed class`, patterns, exhaustividade, null-safety; `Result` via `result_dart`/`fpdart`; `freezed`) e **tooling unificado** (`dart` CLI) — melhores que TS. Testes (`package:test`+`mocktail`) em paridade.
- **Gargalo com MySQL:** ecossistema Dart server-side é **Postgres-first**. Driver MySQL (`mysql_dart`) é mantenedor-solo; **não há ORM tipado nem migrations para MySQL** (Drift/Serverpod/Stormberry são Postgres/SQLite). Borda HTTP: shelf (oficial, maduro, primitiva) / dart_frog (governança community-led frágil desde 2025) / Serverpod (Postgres-only, RPC-first, SSPL, colide com ADR-0006/0027). S3 sem SDK oficial; sem Zod-equivalente na borda.
- **Com Postgres, o Dart destrava** parcialmente: driver `postgres` v3 (isoos) é **maduro** (verified publisher, ~253k downloads/mês; pool/prepared/tx/TLS/SCRAM; `numeric`→String→VO Money; LISTEN/NOTIFY como bônus de wake-up sobre o outbox ADR-0015). **Mas** não há Drizzle+drizzle-kit num pacote só — monta-se de peças (Drift tipado + migrations por fora, ou Stormberry bus-factor-1). **Reviravolta:** o mesmo Postgres que sobe o Dart de "inviável" para "viável" sobe o Node/Deno de "ótimo com mysql2" para "ótimo mantendo Drizzle inteiro" (dialeto `pg` first-class) — o delta relativo Dart×Node não fecha.

### 2026-07-09 — Linguagens compiladas com ADTs (Rust / OCaml / F# / Kotlin)

Filtro aplicado: compilada · ADTs/sum types + `match` exaustivo + `Result`/`Option` + imutabilidade **nativos** · não-Java/Go/Gleam/BEAM · viável para backend transacional MySQL 8.4.

- **Rust** — fit de linguagem máximo (`Result`/`Option`/`enum`/`match` nativos; exaustivo **por padrão, sem furo de guard**; operador `?`; newtype; imutável default; binário nativo real). `sqlx` fala MySQL 8.4 (`caching_sha2_password`+TLS) e **valida SQL em compile-time contra o schema**; axum maduro; RustCrypto/argon2/lettre/aws-sdk-s3 sólidos; tooling excelente (`cargo`/`clippy`/`nextest`). **Atritos:** MySQL é **second-class** no Rust (Postgres-first; `bool`→`i8`, menos metadata); OpenAPI só **code-first** (regride ADR-0027); **async Rust + borrow checker** (curva real); **tempo de compilação** pesado — agravado na máquina do dev (M2, 8 GB RAM).
- **OCaml** — fit de linguagem 10/10 (a origem do paradigma); cripto (MirageOS) e tooling (`dune`) excelentes. **Mas a camada de dados é o calcanhar de Aquiles e bate na restrição MySQL:** Caqti+mariadb conecta via `libmariadb` (auth/TLS out-of-band, não documentado), **sem ORM real** (petrol 1-mantenedor), migrations caseiras; HTTP Dream em **alpha perpétuo**; S3/email imaturos; **contratação minúscula**. Sofreria do mesmo mal que fez cortar o Swift. **Cortado pelo próprio critério do responsável.**
- **F#** — **sweet-spot da dor:** ML nativo (DU, `Result`, exaustividade → erro via `--warnaserror:25`, records imutáveis, sem null) **sobre ecossistema .NET maduro** (MySqlConnector com `caching_sha2`+TLS; Pomelo/EF Core testado contra 8.4; SqlHydra type-safe DB-first ≈ Drizzle; MailKit; AWSSDK.S3; `decimal` 128-bit nativo para dinheiro). Testes (Expecto/FsCheck) e cripto (`System.Security.Cryptography`) fortes. **Atritos:** migrations em F# são 2ª classe (usar DbUp/SQL puro + SqlHydra); OpenAPI code-first (sem 1:1 do zod-openapi/ADR-0027); **NativeAOT-web F# não é caminho liso** ("compilado + self-contained/R2R" sim, machine-code puro não); cola OO na interop C#; hiring F# menor; **ordem de compilação no `.fsproj`**; guards derrotam exaustividade.
- **Kotlin** — **meio-termo pragmático:** ADT ~80–85% de Rust/F# (`sealed` + `when` exaustivo, agora obrigatório em statements; null-safety nativo; **`Result` idiomático exige Arrow-kt** — `Either`/`Raise`), mas **esmaga todos em ecossistema de dados** (Connector/J 1st-party Oracle + HikariCP + **jOOQ** — *mais* type-safe que Drizzle, valida contra o schema real — / Exposed 1.0 estável jan/2026 + **Flyway/Liquibase** + **Testcontainers**) e em **ergonomia (TS-like) e contratação (JVM)**. **Atritos:** ADT menos puro (matching sem destructuring rico, `copy` raso, platform types furam null); **Gradle** é a fricção de tooling; "compilado" = bytecode JVM+JIT (GraalVM native viável mas dispensável p/ servidor 24/7).

---

## 4. Análise interna

### 4.1 Reenquadramento da dor

A percepção "TS grande demais" foi **descartada**: 77k LOC não é grande, e a arquitetura (modular monolith, ports/adapters, ADRs, W0→W3) está saudável. A dor real é **garantias de compilador** — o type system do TS é apagável/estrutural, e o estilo escolhido quer um compilador com ADTs nativos. Isso é **legítimo** e é exatamente o que Rust/OCaml/F#/Kotlin melhoram. Mitigação barata *antes* de rewrite: esgotar o TS (TS 7/`tsgo` para velocidade — já no ADR-0009; `ts-pattern` para match exaustivo real).

### 4.2 Matriz — rotas de runtime (código existente)

| Rota | Natureza | Reaproveitamento | Persistência MySQL 8.4 | Fit domínio | Veredito |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Deno** | Port de runtime | ~90% | Mantém Drizzle+mysql2 (`npm:`, **recomendado pelo Deno**) | = TS | ✅ Upgrade incremental de baixo risco |
| **Node/Deno + Postgres** | Migração de banco | ~90% | **Drizzle pg first-class** | = TS | ✅ Se Postgres for desejado por si só |
| **Dart + MySQL** | Rewrite | ~0% | 🔴 inviável (sem ORM/migrations) | Melhor | ❌ Bate no ponto fraco do Dart |
| **Dart + Postgres** | Rewrite | ~0% | 🟡 viável (de peças) | Melhor | ⚠️ Só greenfield/front-Flutter |

### 4.3 Matriz — linguagens compiladas com ADTs (o núcleo da dor)

| Dimensão (peso do responsável) | 🦀 Rust | 🐫 OCaml | 🎯 F# | 🟪 Kotlin |
| :--- | :--- | :--- | :--- | :--- |
| ADT/Result/exaustividade nativo | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ (Arrow) |
| Driver MySQL 8.4 | ⭐⭐⭐⭐ (2ª classe) | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| ORM tipado ≈ Drizzle | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ (jOOQ) |
| Migrations | ⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ (Flyway) |
| HTTP | ⭐⭐⭐⭐ (axum) | ⭐⭐⭐ (Dream alpha) | ⭐⭐⭐⭐⭐ (Giraffe/Falco) | ⭐⭐⭐⭐⭐ (Ktor/Spring) |
| OpenAPI contract-first (ADR-0027) | ⭐⭐ | ⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| Compilado (o que entrega) | binário nativo real | binário nativo real | IL/JIT + self-contained | bytecode JVM+JIT |
| Ergonomia vindo de TS | ⭐⭐ (borrow+async) | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Contratação / bus-factor | ⭐⭐⭐ | ⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| "Vai sofrer com drivers?" | Médio | **Sim** (corta) | Não | Não (o melhor) |

**Perda universal:** o contract-first do zod-openapi (ADR-0027 — um schema que valida na borda **e** emite o OpenAPI) **não tem equivalente 1:1** em nenhuma das quatro (todas code-first). É o "imposto de saída" do TS/zod.

### Alternativas avaliadas

| Alternativa | Prós | Contras | Veredito |
| :--- | :--- | :--- | :--- |
| Manter TS + esgotar (tsgo/TS7 + ts-pattern) | Custo mínimo; resolve velocidade; endurece exaustividade | Não muda o fato de o type system ser apagável (a dor-raiz persiste) | 🔵 Fazer primeiro (barato, reversível) |
| Deno (mantendo Drizzle/MySQL) | Baixo risco; TS nativo; permissions; JSR/Sigstore | Não resolve a dor-raiz (é o mesmo TS) | ✅ Bom p/ modernização; ❌ não p/ a dor de ADT |
| Dart / Dart+Postgres | Fit melhor; tooling unificado | Rewrite; MySQL fraco (ou trocar p/ Postgres); ecossistema server nicho | ❌ Só greenfield/front-Flutter |
| **Rust** | Fit máximo; binário nativo real; `sqlx` compile-time; exaustivo sem furo | MySQL 2ª classe; async+borrow; build pesado (máquina 8 GB) | 🟡 Finalista — se binário-nativo/pureza > conforto |
| OCaml | Fit 10/10; cripto/tooling ótimos | Camada de dados = calcanhar; MySQL Postgres-first; HTTP alpha; hiring | ❌ Cortado pelo critério "não sofrer com drivers" |
| **F#** | ML nativo + ecossistema .NET maduro; `decimal` nativo; não sofre com drivers | Migrations 2ª classe; OpenAPI code-first; AOT-web não; hiring menor | 🟡 Finalista — melhor casamento dos 2 critérios |
| Kotlin | Melhor ecossistema de dados; ergonomia/hiring máximos | ADT menos puro (Result via Arrow); Gradle; "compilado"=JVM | 🟡 Hedge de menor risco |

### 4.4 Achado central

Os quatro **resolvem igualmente bem a dor declarada** (cansaço da disciplina manual). O diferenciador é o **preço** cruzado com o critério "não sofrer":

- **OCaml sai** — fit perfeito, mas o ecossistema de dados sob MySQL é o mesmo "sofrimento" que cortou o Swift.
- **Rust** dá o fit mais puro + o único binário nativo real, mas cobra o **maior imposto operacional** (async + MySQL-2ª-classe + build pesado) — justo nos eixos do "não quero sofrer".
- **F#** entrega ~95% do fit com **fração do atrito** (ML nativo sobre .NET maduro), trocando "nativo puro" por "CLR/self-contained" e por bordas OO.
- **Kotlin** é o **menor risco** (ecossistema + hiring), ao custo de ADT menos puro (Result via Arrow).

---

## 5. Decisão final

**PENDENTE — não decidir no papel.** Recomendação de encaminhamento:

1. **Curto prazo (barato, reversível):** esgotar o TS — antecipar `tsgo`/TS 7 (ADR-0009) para a dor de velocidade e adotar `ts-pattern` para exaustividade real na borda. Isto compra parte das garantias sem rewrite.
2. **Finalistas para eventual troca de linguagem:** **F#** (melhor casamento "matar disciplina manual" + "não sofrer com drivers") e **Rust** (se binário nativo real + exaustividade sem-furo + `sqlx` compile-time forem inegociáveis e o time topar borrow/async). **Kotlin** como hedge de menor risco; **OCaml/Dart/Swift** fora.
3. **Prova real, não teórica:** rodar um **spike strangler-fig de UM bounded context isolado** (candidato: `financial/domain/document`, fronteira de eventos/outbox clara) no finalista escolhido, em produção lado a lado com o Node atrás da mesma borda, e **medir**: velocidade do time, dor de MySQL, dor de OpenAPI, densidade de bugs, tempo de CI. Converte uma aposta de 12+ meses numa série de decisões reversíveis.

Qualquer troca de runtime/linguagem exige **novo ADR que `supersedes` ADR-0002 e ADR-0009** — nunca editar os aceitos (anti-padrão #5). ADR-0002 já listava "Migrar para Deno" como alternativa rejeitada, mas seu critério de re-avaliação nº 1 (libs bancárias CNAB/OFX) **não se materializou** (OFX é regex puro; XML via `fast-xml-parser` JS puro; sem remessa CNAB).

---

## 6. Saídas (outputs concretos)

- [ ] ADR novo que `supersedes` [ADR-0002](../architecture/adr/0002-keep-nodejs-runtime.md) + [ADR-0009](../architecture/adr/0009-node-24-typescript-6-with-7-roadmap.md) — **somente após spike + decisão humana**
- [ ] Spike de referência do módulo `financial/domain/document` em Rust e F# — ver [`.claude/.planning/lang-spike-document-module/`](../../.claude/.planning/lang-spike-document-module/README.md)
- [ ] Curto prazo: antecipar avaliação `tsgo`/TS 7 + PoC `ts-pattern` na borda (independe da decisão de linguagem)
- [ ] Próximo passo: responsável escolhe finalista (F# ou Rust) para o spike strangler-fig com métricas de decisão

---

## 7. Referências

- ADRs tocados: [0002](../architecture/adr/0002-keep-nodejs-runtime.md), [0009](../architecture/adr/0009-node-24-typescript-6-with-7-roadmap.md), [0011](../architecture/adr/0011-supply-chain-hardening.md), [0013](../architecture/adr/0013-mysql-database-engine.md), [0020](../architecture/adr/0020-mysql-only-supersedes-dual-dialect.md), [0025](../architecture/adr/0025-http-server-fastify-core-api.md), [0027](../architecture/adr/0027-zod-openapi-contract-first-http-edge.md)
- Regras de domínio que motivam a análise: [`.claude/rules/domain.md`](../../.claude/rules/domain.md)
- Deno oficial: `docs.deno.com/examples/mysql2_tutorial/` · `deno.com/blog/build-database-app-drizzle` · `docs.deno.com/examples/hono/` · `docs.deno.com/runtime/fundamentals/testing/`
- JSR: `jsr.io/@zod/zod` · `jsr.io/@panva/jose` · `jsr.io/@hono/hono` · `jsr.io/@std`
- Rust: `github.com/launchbadge/sqlx` (+ `transact-rs/sqlx`) · `github.com/tokio-rs/axum` · RustCrypto `argon2`
- OCaml: `github.com/paurkedal/ocaml-caqti` · `github.com/camlworks/dream` · `github.com/ulrikstrid/ocaml-jose`
- F#: `github.com/mysql-net/MySqlConnector` · `nuget.org/packages/Pomelo.EntityFrameworkCore.MySql` · `github.com/JordanMarr/SqlHydra` · `fsharp.org/guides/`
- Kotlin: `blog.jetbrains.com/kotlin/2026/01/exposed-1-0-is-now-available/` · `jooq.org` · `arrow-kt.io/learn/typed-errors/` · `ktor.io`
- Spike de código lado a lado: [`.claude/.planning/lang-spike-document-module/`](../../.claude/.planning/lang-spike-document-module/README.md)
