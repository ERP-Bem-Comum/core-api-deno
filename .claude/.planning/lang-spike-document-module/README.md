# Spike de referência — `financial/domain/document` em Rust e F#

> Material de **exploração** ligado ao [Inquiry-0023](../../../handbook/inquiries/0023-language-runtime-reevaluation.md).
> **Não é código de produção** e **não compila** como está (os adapters de banco estão comentados —
> `sqlx::query!` exige um MySQL vivo em compile-time; o adapter F# depende de pacotes NuGet).
> O objetivo é **sentir os dois finalistas na prática**, traduzindo padrões reais do domínio TS.

## O que foi traduzido (fiel ao TS real)

| Padrão do core-api (arquivo TS de origem) | Rust | F# |
| :--- | :--- | :--- |
| `Result<T,E>` (`shared/primitives/result.ts`) | nativo (`Result`, `?`) | nativo (`Result`) |
| VO `Money` (`shared/kernel/money.ts`) | [`rust/money.rs`](./rust/money.rs) | [`fsharp/Money.fs`](./fsharp/Money.fs) |
| `DocumentStatus` + agregado (`document/types.ts`, `document.ts`, `errors.ts`) | [`rust/document.rs`](./rust/document.rs) | [`fsharp/Document.fs`](./fsharp/Document.fs) |
| `approval-policy.ts` (checkApprover + escalate, #289) | [`rust/approval_policy.rs`](./rust/approval_policy.rs) | [`fsharp/ApprovalPolicy.fs`](./fsharp/ApprovalPolicy.fs) |
| Port + adapter (`document/repository.ts`) | [`rust/repository.rs`](./rust/repository.rs) | [`fsharp/Repository.fs`](./fsharp/Repository.fs) |
| Teste do approval-policy | inline em `approval_policy.rs` (`#[cfg(test)]`) | [`fsharp/Tests.fs`](./fsharp/Tests.fs) (Expecto) |

## O que "sentir" ao ler

1. **A disciplina manual do TS vira lei do compilador.** O `const _: never` some (exaustividade nativa),
   o `as Money`/`as Email` some (construtor privado do newtype/single-case DU), o `Readonly<>` some
   (imutável por padrão), o `| null` vira `Option`/`Option<T>` que o compilador obriga a tratar. As
   string-literal-union de erro viram DUs exaustivas.
2. **Rust** — exaustividade **por padrão e sem furo de guard**; operador `?` propaga erro sem boilerplate;
   `..self.clone()` (struct update) espelha o `{ ...prev, status }`. Custo escondido: o adapter é **async**
   (`async_trait`, `Send + Sync`), e `sqlx::query!` valida a SQL contra o schema real (superpoder), mas
   MySQL é second-class no Rust.
3. **F#** — `{ doc with Status = Open }` é o `{ ...prev }` nativo; `match ... with` sobre DU + record;
   exaustividade vira erro com `<WarningsAsErrors>FS0025</WarningsAsErrors>` no `.fsproj` (**ligar isso é
   obrigatório**). Cuidado: guards (`when` no `checkApprover`) **derrotam** a checagem de exaustividade —
   onde possível, estruturar o `match` sem guard. Adapter usa MySqlConnector + Dapper.FSharp (ecossistema
   .NET maduro).

## O que este recorte NÃO cobre (para não explodir o spike)

- Os ~20 campos reais de `DocumentCore` (aqui: subset representativo).
- Serialização DU→JSON (Rust: `serde` + `#[serde(tag = "...")]`; F#: `FSharp.SystemTextJson`) — reproduz o
  discriminant `{ kind: ... }` do TS, mas é config extra.
- Borda HTTP (Rust: axum; F#: Giraffe/Falco) — esboçada só como assinatura no Inquiry.
- Migrations (Rust: `sqlx migrate`/SQL; F#: DbUp/SQL puro — ambos SQL manual, sem `drizzle-kit generate`).

## Como rodaria de verdade (fora do spike)

- **Rust:** `cargo test` (roda o `#[cfg(test)]` do approval_policy sem banco); adapters exigem
  `DATABASE_URL` + `cargo sqlx prepare` para o modo offline.
- **F#:** `dotnet test` com Expecto; adapters exigem os pacotes `MySqlConnector` + `Dapper.FSharp`.
