//! Domain entities. Mirrors Maktaba.Core/Entities/*.cs. Row ids are i64 (SQLite INTEGER PRIMARY
//! KEY / AUTOINCREMENT native type); join tables use composite keys exactly as the EF model did.

use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReadingStatus {
    Unread,
    Reading,
    Finished,
}

impl ReadingStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            ReadingStatus::Unread => "Unread",
            ReadingStatus::Reading => "Reading",
            ReadingStatus::Finished => "Finished",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "unread" => Some(ReadingStatus::Unread),
            "reading" => Some(ReadingStatus::Reading),
            "finished" => Some(ReadingStatus::Finished),
            _ => None,
        }
    }

    pub fn all() -> [ReadingStatus; 3] {
        [ReadingStatus::Unread, ReadingStatus::Reading, ReadingStatus::Finished]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BookFormat {
    Epub,
    Pdf,
}

impl BookFormat {
    pub fn as_str(&self) -> &'static str {
        match self {
            BookFormat::Epub => "Epub",
            BookFormat::Pdf => "Pdf",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "epub" => Some(BookFormat::Epub),
            "pdf" => Some(BookFormat::Pdf),
            _ => None,
        }
    }

    pub fn content_type(&self) -> &'static str {
        match self {
            BookFormat::Epub => "application/epub+zip",
            BookFormat::Pdf => "application/pdf",
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            BookFormat::Epub => ".epub",
            BookFormat::Pdf => ".pdf",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Book {
    pub id: i64,
    pub title: String,
    pub sort_title: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub date_published: Option<NaiveDate>,
    pub date_added: NaiveDateTime,
    pub rating: i64,
    pub reading_status: ReadingStatus,
    /// Path to this book's folder, relative to the library root.
    pub folder_path: String,
}

#[derive(Debug, Clone)]
pub struct Author {
    pub id: i64,
    pub name: String,
    pub sort_name: String,
}

#[derive(Debug, Clone)]
pub struct Series {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Tag {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct Collection {
    pub id: i64,
    pub name: String,
}

#[derive(Debug, Clone)]
pub struct BookAuthor {
    pub book_id: i64,
    pub author_id: i64,
    /// Author credit order on the book (0 = first-listed).
    pub order: i64,
}

#[derive(Debug, Clone)]
pub struct BookSeries {
    pub book_id: i64,
    pub series_id: i64,
    pub series_index: f64,
}

#[derive(Debug, Clone)]
pub struct BookTag {
    pub book_id: i64,
    pub tag_id: i64,
}

#[derive(Debug, Clone)]
pub struct BookCollection {
    pub book_id: i64,
    pub collection_id: i64,
}

#[derive(Debug, Clone)]
pub struct BookFile {
    pub id: i64,
    pub book_id: i64,
    pub format: BookFormat,
    /// Path to this file, relative to the library root.
    pub file_path: String,
    pub file_size_bytes: i64,
    /// SHA-256 hash of the file contents, hex-encoded.
    pub content_hash: String,
}

#[derive(Debug, Clone)]
pub struct Identifier {
    pub id: i64,
    pub book_id: i64,
    /// e.g. "isbn", "asin", "doi".
    pub scheme: String,
    pub value: String,
}

#[derive(Debug, Clone)]
pub struct Bookmark {
    pub id: i64,
    pub book_id: i64,
    /// The reader's own client-generated id (crypto.randomUUID()) - distinct from `id`.
    pub client_id: String,
    pub chapter_id: String,
    pub position: f64,
    pub name: String,
    pub created_at: NaiveDateTime,
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Debug, Clone)]
pub struct Note {
    pub id: i64,
    pub book_id: i64,
    pub client_id: String,
    pub chapter_id: String,
    pub start_offset: i64,
    pub end_offset: i64,
    /// The highlighted excerpt of book text this note anchors to.
    pub text: String,
    pub comment: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: Option<NaiveDateTime>,
}

/// One row per book - genuinely 1:1, so book_id is the primary key directly.
#[derive(Debug, Clone)]
pub struct ReadingProgress {
    pub book_id: i64,
    pub current_chapter: i64,
    pub total_chapters: i64,
    pub current_page: i64,
    pub total_pages: i64,
    pub chapter_title: Option<String>,
    pub percentage: f64,
    /// The reader's own resume anchor - null until the reader's progressAdapter has saved once.
    pub chapter_id: Option<String>,
    pub position: Option<f64>,
    pub updated_at: NaiveDateTime,
}

/// A fully-loaded book with its relations - the Rust analogue of EF's `.Include(...)` chains.
#[derive(Debug, Clone, Default)]
pub struct BookWithRelations {
    pub book: Option<Book>,
    pub authors: Vec<(Author, i64)>, // (author, order)
    pub series: Option<(Series, f64)>,
    pub tags: Vec<Tag>,
    pub collections: Vec<Collection>,
    pub files: Vec<BookFile>,
    pub identifiers: Vec<Identifier>,
}
