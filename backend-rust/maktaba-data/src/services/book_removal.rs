//! Mirrors Maktaba.Data/Services/BookRemovalService.cs.

use maktaba_core::services::BookRemovalResult;
use rusqlite::{Connection, OptionalExtension};

pub fn remove(conn: &Connection, library_root: &str, book_id: i64) -> anyhow::Result<Option<BookRemovalResult>> {
    let folder_path: Option<String> = conn
        .query_row("SELECT folder_path FROM books WHERE id = ?1", [book_id], |r| r.get(0))
        .optional()?;
    let Some(folder_path) = folder_path else { return Ok(None) };

    let absolute_folder_path =
        std::path::Path::new(library_root).join(&folder_path).to_string_lossy().to_string();

    // book_authors/book_series/book_tags/book_files/identifiers/bookmarks/notes/reading_progress
    // rows cascade-delete via their FK to books (ON DELETE CASCADE, PRAGMA foreign_keys = ON).
    conn.execute("DELETE FROM books WHERE id = ?1", [book_id])?;

    Ok(Some(BookRemovalResult { absolute_folder_path }))
}
