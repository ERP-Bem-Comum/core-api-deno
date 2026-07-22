/// Document — agregado + máquina de estados.
/// Espelha `financial/domain/document/{types,document,errors}.ts`.
module Financial.Domain.Document

open Financial.Domain.Money

/// DocumentStatus — DU (espelha o string-literal-union + `const _: never` do TS).
/// Um `match` incompleto gera warning FS0025 → com `<WarningsAsErrors>FS0025</WarningsAsErrors>`
/// no `.fsproj` vira ERRO de compilação (ligar isso é obrigatório para igualar o Rust).
type DocumentStatus =
    | Draft
    | Open
    | Approved
    | Transmitted
    | Refused
    | Paid
    | PartiallyReconciled
    | Reconciled

/// Erros do agregado — DU (espelha o string-literal-union de erros do TS).
type DocumentError =
    | NotDraft
    | NetValueRequired

/// Código EN kebab-case para a borda HTTP (espelha o dicionário de erros do projeto).
let errorCode =
    function
    | NotDraft -> "document-not-draft"
    | NetValueRequired -> "document-net-value-required"

/// Recorte fiel do agregado (subset — o real tem ~20 campos em `DocumentCore`). Record = imutável.
type Document =
    { Id: string
      DocumentNumber: string
      Status: DocumentStatus
      GrossValue: Money
      NetValue: Money option // `netValue: Money | null` → option nativo
      Version: int64 }

/// Submete Draft → Open. Imutável: `{ doc with ... }` é o que o `{ ...prev, status }` do TS imita.
/// Note: este match usa apenas os construtores (sem guard `when`), então a exaustividade é checada.
let submit (doc: Document) : Result<Document, DocumentError> =
    match doc.Status, doc.NetValue with
    | Draft, Some _ -> Ok { doc with Status = Open; Version = doc.Version + 1L }
    | Draft, None -> Error NetValueRequired
    | _ -> Error NotDraft
