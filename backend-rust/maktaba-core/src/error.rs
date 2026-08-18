//! Mirrors LibraryNotOpenException and DuplicateBookDetectedException.

use thiserror::Error;

use crate::services::DuplicateBookInfo;

#[derive(Debug, Error)]
#[error("No library is open.")]
pub struct LibraryNotOpenError;

#[derive(Debug, Error)]
pub enum ImportError {
    #[error("A matching book already exists: \"{}\"", info.existing_title)]
    DuplicateDetected { info: DuplicateBookInfo },

    #[error("Unsupported ebook file type: {0}")]
    UnsupportedFileType(String),

    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl From<rusqlite::Error> for ImportError {
    fn from(err: rusqlite::Error) -> Self {
        ImportError::Other(err.into())
    }
}
