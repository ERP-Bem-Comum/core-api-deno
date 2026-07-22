/// DocumentRepository — port + adapter MySQL. Espelha `document/repository.ts`.
module Financial.Adapters.DocumentRepository

open System.Threading.Tasks
open Financial.Domain.Document

type DocumentRepositoryError =
    | NotFound
    | Failure
    | VersionConflict

/// Port — record de funções (equivale ao `Readonly<{ save; findById }>` de funções do TS).
/// O domínio depende disto, não do driver (ADR-0006). `Task` = async do .NET (sem os bounds
/// `Send + Sync` que o Rust exige — a plumbing async do .NET é mais leve).
type DocumentRepository =
    { Save: Document -> int64 option -> Task<Result<unit, DocumentRepositoryError>>
      FindById: string -> Task<Result<Document, DocumentRepositoryError>> }

// ── Adapter (fora do domínio) ─────────────────────────────────────────────────
// Comentado: depende dos pacotes NuGet `MySqlConnector` (caching_sha2_password + TLS) e
// `Dapper.FSharp`. Exceção do driver → `Result` na borda (regra do domínio). Migrations ficam
// fora (DbUp/SQL puro + SqlHydra para os tipos) — não há `drizzle-kit generate` em F#.
//
// open MySqlConnector
// open Dapper.FSharp.MySQL
//
// let mysqlRepository (dataSource: MySqlDataSource) : DocumentRepository =
//     { FindById =
//         fun id ->
//             task {
//                 try
//                     use! conn = dataSource.OpenConnectionAsync()
//                     let! rows =
//                         select {
//                             for d in documentTable do
//                                 where (d.Id = id)
//                         }
//                         |> conn.SelectAsync<DocumentRow>
//                     return
//                         rows
//                         |> Seq.tryHead
//                         |> Option.map (rowToDomain >> Ok)
//                         |> Option.defaultValue (Error NotFound)
//                 with _ ->
//                     return Error Failure
//             }
//       Save =
//         fun doc expectedVersion ->
//             task {
//                 // UPDATE ... WHERE version = expectedVersion; rowsAffected = 0 -> VersionConflict.
//                 return Ok()
//             } }
