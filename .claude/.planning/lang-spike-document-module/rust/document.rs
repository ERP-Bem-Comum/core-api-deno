//! Document — agregado + máquina de estados.
//! Espelha `financial/domain/document/{types,document,errors}.ts`.

use crate::money::Money;

/// DocumentStatus — DU nativa (espelha o string-literal-union + `const _: never` do TS).
/// `match` sobre isto é exaustivo POR PADRÃO: adicionar variante quebra a compilação em todo `match`.
/// Sem flag de projeto (o F# precisa de `FS0025-as-error`; Rust não).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentStatus {
    Draft,
    Open,
    Approved,
    Transmitted,
    Refused,
    Paid,
    PartiallyReconciled,
    Reconciled,
}

/// Erros do agregado — enum (espelha o string-literal-union de erros do TS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentError {
    NotDraft,
    NetValueRequired,
}

impl DocumentError {
    /// Código EN kebab-case para a borda HTTP (espelha o dicionário de erros do projeto).
    pub fn code(self) -> &'static str {
        match self {
            DocumentError::NotDraft => "document-not-draft",
            DocumentError::NetValueRequired => "document-net-value-required",
        }
    }
}

/// Recorte fiel do agregado (subset — o real tem ~20 campos em `DocumentCore`).
#[derive(Debug, Clone)]
pub struct Document {
    pub id: String, // DocumentId (newtype no real)
    pub document_number: String,
    pub status: DocumentStatus,
    pub gross_value: Money,
    pub net_value: Option<Money>, // `netValue: Money | null` → Option nativo
    pub version: i64,
}

impl Document {
    /// Submete Draft → Open (espelha a transição `submit` do agregado).
    /// Imutável: retorna uma CÓPIA nova via struct update (equivale ao `{ ...prev, status: 'Open' }`).
    pub fn submit(&self) -> Result<Document, DocumentError> {
        if self.status != DocumentStatus::Draft {
            return Err(DocumentError::NotDraft);
        }
        if self.net_value.is_none() {
            return Err(DocumentError::NetValueRequired);
        }
        Ok(Document {
            status: DocumentStatus::Open,
            version: self.version + 1,
            ..self.clone()
        })
    }
}
