//! Mirrors Maktaba.Data/Services/BookEditService.cs.

use maktaba_core::naming::compute_sort_title;
use maktaba_core::services::BookEditRequest;
use rusqlite::{Connection, OptionalExtension};

use crate::folder_relocator;
use crate::resolvers;

/// Returns `Ok(false)` if no such book exists.
pub fn update(conn: &mut Connection, library_root: &str, book_id: i64, request: &BookEditRequest) -> anyhow::Result<bool> {
    let old_folder_relative: Option<String> = conn
        .query_row("SELECT folder_path FROM books WHERE id = ?1", [book_id], |r| r.get(0))
        .optional()?;
    let Some(old_folder_relative) = old_folder_relative else { return Ok(false) };

    let files: Vec<(i64, String)> = {
        let mut stmt = conn.prepare("SELECT id, file_path FROM book_files WHERE book_id = ?1")?;
        let rows = stmt.query_map([book_id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
        rows
    };

    let rating = request.rating.clamp(0, 5);
    let sort_title = compute_sort_title(&request.title);

    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE books SET title = ?1, sort_title = ?2, language = ?3, publisher = ?4,
                           date_published = ?5, description = ?6, rating = ?7 WHERE id = ?8",
        rusqlite::params![
            request.title, sort_title, request.language, request.publisher,
            request.published_date, request.description, rating, book_id,
        ],
    )?;

    tx.execute("DELETE FROM book_authors WHERE book_id = ?1", [book_id])?;
    let authors = resolvers::resolve_authors(&tx, &request.authors)?;
    for (order, author) in authors.iter().enumerate() {
        tx.execute(
            "INSERT INTO book_authors(book_id, author_id, \"order\") VALUES (?1, ?2, ?3)",
            rusqlite::params![book_id, author.id, order as i64],
        )?;
    }

    tx.execute("DELETE FROM book_series WHERE book_id = ?1", [book_id])?;
    if let Some(series) = resolvers::resolve_series(&tx, request.series_name.as_deref())? {
        tx.execute(
            "INSERT INTO book_series(book_id, series_id, series_index) VALUES (?1, ?2, ?3)",
            rusqlite::params![book_id, series.id, request.series_index.unwrap_or(0.0)],
        )?;
    }

    tx.execute("DELETE FROM book_tags WHERE book_id = ?1", [book_id])?;
    let tags = resolvers::resolve_tags(&tx, &request.tags)?;
    for tag in &tags {
        tx.execute(
            "INSERT INTO book_tags(book_id, tag_id) VALUES (?1, ?2)",
            rusqlite::params![book_id, tag.id],
        )?;
    }

    tx.execute("DELETE FROM book_collections WHERE book_id = ?1", [book_id])?;
    if !request.collection_ids.is_empty() {
        // Membership is set from *existing* collections only - Collections are user-created via
        // the manager dialog, unlike Authors/Series/Tags which are find-or-created from free text.
        let placeholders = request.collection_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("SELECT id FROM collections WHERE id IN ({placeholders})");
        let mut stmt = tx.prepare(&sql)?;
        let params = rusqlite::params_from_iter(request.collection_ids.iter());
        let existing_ids: Vec<i64> = stmt.query_map(params, |r| r.get(0))?.collect::<Result<_, _>>()?;
        for collection_id in existing_ids {
            tx.execute(
                "INSERT INTO book_collections(book_id, collection_id) VALUES (?1, ?2)",
                rusqlite::params![book_id, collection_id],
            )?;
        }
    }

    let primary_author_sort_name =
        authors.first().map(|a| a.sort_name.as_str()).unwrap_or("Unknown Author");

    let relocation = folder_relocator::relocate_if_needed(
        std::path::Path::new(library_root),
        book_id,
        &request.title,
        primary_author_sort_name,
        &old_folder_relative,
        &files,
    );

    let relocation = match relocation {
        Ok(r) => r,
        Err(err) => {
            // The transaction rolls back on drop (dropping `tx` without commit); nothing to undo
            // on disk since the move itself failed.
            return Err(err);
        }
    };

    tx.execute(
        "UPDATE books SET folder_path = ?1 WHERE id = ?2",
        rusqlite::params![relocation.new_folder_relative, book_id],
    )?;
    for (file_id, new_path) in &relocation.updated_files {
        tx.execute("UPDATE book_files SET file_path = ?1 WHERE id = ?2", rusqlite::params![new_path, file_id])?;
    }

    match tx.commit() {
        Ok(()) => Ok(true),
        Err(err) => {
            // Best-effort rollback so disk and DB don't diverge if the save fails after the move.
            if let Some(m) = &relocation.folder_move {
                if m.new_absolute.exists() && !m.old_absolute.exists() {
                    let _ = std::fs::rename(&m.new_absolute, &m.old_absolute);
                }
            }
            Err(err.into())
        }
    }
}
