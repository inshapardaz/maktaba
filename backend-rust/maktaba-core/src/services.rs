//! Request/result shapes shared between maktaba-data's service functions and maktaba-api's
//! endpoint handlers. Mirrors the various Maktaba.Core/Services/I*.cs interfaces - Rust doesn't
//! need DI interfaces for what were single-implementation abstractions in C#, so those became
//! plain functions in maktaba-data; only the shared data shapes survive here.

use chrono::NaiveDate;

use crate::entities::{Book, BookFile};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ImportDuplicateResolution {
    /// Detect duplicates and return `Err(ImportError::DuplicateDetected(..))` if one is found.
    Auto,
    /// A duplicate was found and the caller wants to leave the existing book untouched.
    Skip,
    /// Import as a brand-new, separate book regardless of any match.
    KeepBoth,
    /// Add this file to the existing matched book instead of creating a new one.
    Merge,
}

impl ImportDuplicateResolution {
    pub fn parse(action: Option<&str>) -> Self {
        match action {
            Some("skip") => Self::Skip,
            Some("keep-both") => Self::KeepBoth,
            Some("merge") => Self::Merge,
            _ => Self::Auto,
        }
    }
}

#[derive(Debug, Clone)]
pub struct DuplicateBookInfo {
    pub existing_book_id: i64,
    pub existing_title: String,
    pub existing_authors: Vec<String>,
    /// True if the exact file content already exists (byte-identical); false if it's a
    /// title/author match.
    pub same_content_hash: bool,
}

pub struct BookEditRequest {
    pub title: String,
    pub authors: Vec<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub published_date: Option<NaiveDate>,
    pub description: Option<String>,
    pub rating: i64,
    pub series_name: Option<String>,
    pub series_index: Option<f64>,
    pub tags: Vec<String>,
    pub collection_ids: Vec<i64>,
}

pub struct BookRemovalResult {
    pub absolute_folder_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BookConversionOutcome {
    Converted,
    BookNotFound,
    AlreadyHasFormat,
    CalibreUnavailable,
}

pub struct BookConversionResult {
    pub outcome: BookConversionOutcome,
    pub file: Option<BookFile>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthorRenameOutcome {
    Renamed,
    AuthorNotFound,
    /// Another author already has this name (case-insensitive). Deliberately rejected rather
    /// than merged - silently combining two authors' book lists isn't something to do without
    /// the user confirming that's actually what they want.
    NameConflict,
}

pub struct AuthorRenameResult {
    pub outcome: AuthorRenameOutcome,
    pub author_id: Option<i64>,
    pub author_name: Option<String>,
    pub affected_book_count: i64,
}

#[derive(Debug, Clone)]
pub struct LibraryRegistryEntry {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// Point-in-time snapshot of an in-progress (or just-finished) library rescan.
#[derive(Debug, Clone)]
pub struct RescanProgressSnapshot {
    pub is_running: bool,
    pub processed: i64,
    pub total: i64,
    pub current_book: Option<String>,
}

impl RescanProgressSnapshot {
    pub fn idle() -> Self {
        Self { is_running: false, processed: 0, total: 0, current_book: None }
    }
}

pub struct ImportedBook {
    pub book: Book,
}
