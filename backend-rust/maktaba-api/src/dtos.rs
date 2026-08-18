//! Wire DTOs. Mirrors Maktaba.Api/Dtos/BookDtos.cs and ReaderDataDtos.cs field-for-field
//! (camelCase on the wire, matching System.Text.Json's default). Every id below is a sqids.org-
//! encoded string (see maktaba_core::ids), not the database's internal integer primary key.

use chrono::{NaiveDate, NaiveDateTime};
use serde::{Deserialize, Serialize};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookSummaryDto {
    pub id: String,
    pub title: String,
    pub sort_title: String,
    pub authors: Vec<String>,
    pub rating: i64,
    #[serde(with = "crate::chrono_utc")]
    pub date_added: NaiveDateTime,
    pub has_cover: bool,
    pub reading_status: String,
    pub series_index: Option<f64>,
    #[serde(with = "crate::chrono_utc::opt")]
    pub last_read_at: Option<NaiveDateTime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContinueReadingBookDto {
    pub id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub has_cover: bool,
    pub reading_status: String,
    pub format: String,
    pub absolute_path: String,
    pub percentage: f64,
    #[serde(with = "crate::chrono_utc")]
    pub updated_at: NaiveDateTime,
}

#[derive(Serialize)]
pub struct IdentifierDto {
    pub scheme: String,
    pub value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookFileDto {
    pub format: String,
    pub file_size_bytes: i64,
    pub absolute_path: String,
}

#[derive(Serialize)]
pub struct BookCollectionDto {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookDetailDto {
    pub id: String,
    pub title: String,
    pub sort_title: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub date_published: Option<NaiveDate>,
    pub rating: i64,
    #[serde(with = "crate::chrono_utc")]
    pub date_added: NaiveDateTime,
    pub authors: Vec<String>,
    pub series_name: Option<String>,
    pub series_index: Option<f64>,
    pub tags: Vec<String>,
    pub identifiers: Vec<IdentifierDto>,
    pub files: Vec<BookFileDto>,
    pub has_cover: bool,
    pub reading_status: String,
    pub collections: Vec<BookCollectionDto>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBookRequest {
    pub file_path: String,
    pub duplicate_action: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateBookDto {
    pub existing_book_id: String,
    pub existing_title: String,
    pub existing_authors: Vec<String>,
    pub same_content_hash: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookEditRequestDto {
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
    pub collection_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateBookStatusRequestDto {
    pub reading_status: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertBookRequestDto {
    pub target_format: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemCapabilitiesDto {
    pub calibre_available: bool,
}

#[derive(Deserialize)]
pub struct OpenLibraryRequest {
    pub path: String,
}

#[derive(Serialize)]
pub struct LibraryDto {
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntryDto {
    pub id: String,
    pub name: String,
    pub path: String,
    pub is_active: bool,
}

#[derive(Deserialize)]
pub struct RenameLibraryRequestDto {
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub struct RelocateLibraryRequestDto {
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanProgressDto {
    pub is_running: bool,
    pub processed: i64,
    pub total: i64,
    pub current_book: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowseGroupDto {
    pub id: String,
    pub name: String,
    pub book_count: i64,
}

#[derive(Deserialize)]
pub struct CreateCollectionRequestDto {
    pub name: Option<String>,
}

#[derive(Serialize)]
pub struct ReadingStatusCountDto {
    pub status: String,
    pub count: i64,
}

#[derive(Deserialize)]
pub struct RenameAuthorRequestDto {
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub struct RenameTagRequestDto {
    pub name: Option<String>,
}

#[derive(Deserialize)]
pub struct RenameSeriesRequestDto {
    pub name: Option<String>,
}

// --- Reader data ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkDto {
    pub id: String,
    pub chapter_id: String,
    pub position: f64,
    pub name: String,
    #[serde(with = "crate::chrono_utc")]
    pub created_at: NaiveDateTime,
    #[serde(with = "crate::chrono_utc::opt")]
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveBookmarkRequestDto {
    pub chapter_id: String,
    pub position: f64,
    pub name: String,
    #[serde(with = "crate::chrono_utc")]
    pub created_at: NaiveDateTime,
    #[serde(with = "crate::chrono_utc::opt", default)]
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteDto {
    pub id: String,
    pub chapter_id: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub text: String,
    pub comment: Option<String>,
    #[serde(with = "crate::chrono_utc")]
    pub created_at: NaiveDateTime,
    #[serde(with = "crate::chrono_utc::opt")]
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteRequestDto {
    pub chapter_id: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub text: String,
    pub comment: Option<String>,
    #[serde(with = "crate::chrono_utc")]
    pub created_at: NaiveDateTime,
    #[serde(with = "crate::chrono_utc::opt", default)]
    pub updated_at: Option<NaiveDateTime>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgressDto {
    pub current_chapter: i64,
    pub total_chapters: i64,
    pub current_page: i64,
    pub total_pages: i64,
    pub chapter_title: Option<String>,
    pub percentage: f64,
    pub chapter_id: Option<String>,
    pub position: Option<f64>,
    #[serde(with = "crate::chrono_utc")]
    pub updated_at: NaiveDateTime,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SaveReadingProgressRequestDto {
    pub current_chapter: Option<i64>,
    pub total_chapters: Option<i64>,
    pub current_page: Option<i64>,
    pub total_pages: Option<i64>,
    pub chapter_title: Option<String>,
    pub percentage: Option<f64>,
    pub chapter_id: Option<String>,
    pub position: Option<f64>,
}
