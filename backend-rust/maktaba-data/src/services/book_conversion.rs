//! Mirrors Maktaba.Data/Services/BookConversionService.cs.

use maktaba_core::entities::{BookFile, BookFormat};
use maktaba_core::naming::sanitize_path_segment;
use maktaba_core::services::{BookConversionOutcome, BookConversionResult};
use rusqlite::{Connection, OptionalExtension};

use crate::file_helpers;
use crate::services::calibre::CalibreConverter;

pub fn convert(
    conn: &Connection,
    library_root: &str,
    converter: &CalibreConverter,
    book_id: i64,
    target_format: BookFormat,
) -> anyhow::Result<BookConversionResult> {
    let book: Option<(String, String)> = conn
        .query_row("SELECT title, folder_path FROM books WHERE id = ?1", [book_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .optional()?;
    let Some((title, folder_path)) = book else {
        return Ok(BookConversionResult { outcome: BookConversionOutcome::BookNotFound, file: None });
    };

    let files: Vec<(i64, String, String)> = {
        let mut stmt = conn.prepare("SELECT id, format, file_path FROM book_files WHERE book_id = ?1")?;
        let rows = stmt.query_map([book_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
        rows
    };

    if files.iter().any(|(_, format, _)| *format == target_format.as_str()) {
        return Ok(BookConversionResult { outcome: BookConversionOutcome::AlreadyHasFormat, file: None });
    }

    if !converter.is_available() {
        return Ok(BookConversionResult { outcome: BookConversionOutcome::CalibreUnavailable, file: None });
    }

    let folder_absolute = std::path::Path::new(library_root).join(&folder_path);

    // Any existing file works as a source - Calibre reads whatever format it is and produces the
    // target format, so it doesn't matter which of the book's current files gets picked.
    let (_, _, source_relative) = files.first().ok_or_else(|| anyhow::anyhow!("book has no files"))?;
    let source_absolute = std::path::Path::new(library_root).join(source_relative);

    let dest_file_name = format!("{}{}", sanitize_path_segment(&title), target_format.extension());
    let dest_absolute = file_helpers::get_unique_file_path(&folder_absolute, &dest_file_name);

    converter.convert(&source_absolute.to_string_lossy(), &dest_absolute.to_string_lossy())?;

    let content_hash = file_helpers::compute_sha256(&dest_absolute)?;
    let file_size = std::fs::metadata(&dest_absolute)?.len() as i64;
    let dest_file_name_actual =
        dest_absolute.file_name().and_then(|n| n.to_str()).unwrap_or(&dest_file_name);
    let relative_path = format!("{folder_path}/{dest_file_name_actual}");

    conn.execute(
        "INSERT INTO book_files(book_id, format, file_path, file_size_bytes, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![book_id, target_format.as_str(), relative_path, file_size, content_hash],
    )?;
    let file_id = conn.last_insert_rowid();

    Ok(BookConversionResult {
        outcome: BookConversionOutcome::Converted,
        file: Some(BookFile {
            id: file_id,
            book_id,
            format: target_format,
            file_path: relative_path,
            file_size_bytes: file_size,
            content_hash,
        }),
    })
}
