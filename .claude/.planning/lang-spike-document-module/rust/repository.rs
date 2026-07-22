//! DocumentRepository — port (trait) + adapter MySQL (sqlx). Espelha `document/repository.ts`.

use crate::document::Document;
use async_trait::async_trait;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentRepositoryError {
    NotFound,
    Failure,
    VersionConflict,
}

/// Port — o domínio depende desta abstração, não do driver (ADR-0006).
/// `Send + Sync` são exigidos porque o adapter é async (custo do async Rust: os bounds propagam).
#[async_trait]
pub trait DocumentRepository: Send + Sync {
    /// `expected_version` None → INSERT; Some(v) → UPDATE ... WHERE version = v (optimistic lock).
    async fn save(
        &self,
        document: &Document,
        expected_version: Option<i64>,
    ) -> Result<(), DocumentRepositoryError>;

    async fn find_by_id(&self, id: &str) -> Result<Document, DocumentRepositoryError>;
}

// ── Adapter (fora do domínio) ─────────────────────────────────────────────────
// Comentado: `sqlx::query!` valida a SQL em COMPILE-TIME contra o schema real, então exige
// um MySQL vivo (ou `cargo sqlx prepare` para o cache offline `.sqlx/`). Nenhuma exceção do
// driver cruza a borda — tudo vira `Result` (regra do domínio).
//
// use sqlx::MySqlPool;
//
// pub struct MysqlDocumentRepository {
//     pub pool: MySqlPool,
// }
//
// #[async_trait]
// impl DocumentRepository for MysqlDocumentRepository {
//     async fn find_by_id(&self, id: &str) -> Result<Document, DocumentRepositoryError> {
//         let row = sqlx::query!(
//             "SELECT id, document_number, status, gross_cents, net_cents, version \
//              FROM fin_document WHERE id = ?",
//             id
//         )
//         .fetch_optional(&self.pool)
//         .await
//         .map_err(|_| DocumentRepositoryError::Failure)?;
//
//         row.map(row_to_document)
//             .ok_or(DocumentRepositoryError::NotFound)
//     }
//
//     async fn save(
//         &self,
//         document: &Document,
//         expected_version: Option<i64>,
//     ) -> Result<(), DocumentRepositoryError> {
//         // UPDATE ... WHERE version = expected_version; affected_rows == 0 -> VersionConflict.
//         todo!()
//     }
// }
