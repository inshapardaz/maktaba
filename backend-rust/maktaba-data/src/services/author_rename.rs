//! Mirrors Maktaba.Data/Services/AuthorRenameService.cs.

use maktaba_core::naming::compute_author_sort_name;
use maktaba_core::services::{AuthorRenameOutcome, AuthorRenameResult};
use rusqlite::{Connection, OptionalExtension};

pub fn rename(conn: &mut Connection, library_root: &str, author_id: i64, new_name: &str) -> anyhow::Result<AuthorRenameResult> {
    let trimmed = new_name.trim();

    let author_name: Option<String> = conn
        .query_row("SELECT name FROM authors WHERE id = ?1", [author_id], |r| r.get(0))
        .optional()?;
    if author_name.is_none() {
        return Ok(AuthorRenameResult {
            outcome: AuthorRenameOutcome::AuthorNotFound,
            author_id: None,
            author_name: None,
            affected_book_count: 0,
        });
    }

    // Excludes the author's own row, so renaming to a different case/whitespace variant of their
    // own existing name (a "fix the casing" rename) isn't treated as a collision.
    let collision: bool = conn.query_row(
        "SELECT 1 FROM authors WHERE id != ?1 AND LOWER(name) = LOWER(?2)",
        rusqlite::params![author_id, trimmed],
        |_| Ok(true),
    ).optional()?.unwrap_or(false);

    if collision {
        return Ok(AuthorRenameResult {
            outcome: AuthorRenameOutcome::NameConflict,
            author_id: None,
            author_name: None,
            affected_book_count: 0,
        });
    }

    struct AffectedBook {
        id: i64,
        title: String,
        folder_path: String,
        is_primary_author: bool,
        files: Vec<(i64, String)>,
    }

    let mut books: Vec<AffectedBook> = {
        let mut stmt = conn.prepare(
            "SELECT b.id, b.title, b.folder_path,
                    (SELECT ba2.author_id FROM book_authors ba2 WHERE ba2.book_id = b.id ORDER BY ba2.\"order\" LIMIT 1) = ?1
             FROM books b
             WHERE EXISTS (SELECT 1 FROM book_authors ba WHERE ba.book_id = b.id AND ba.author_id = ?1)",
        )?;
        let rows = stmt
            .query_map([author_id], |row| {
                Ok(AffectedBook {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    folder_path: row.get(2)?,
                    is_primary_author: row.get(3)?,
                    files: Vec::new(),
                })
            })?
            .collect::<Result<_, _>>()?;
        rows
    };

    for book in &mut books {
        let mut stmt = conn.prepare("SELECT id, file_path FROM book_files WHERE book_id = ?1")?;
        book.files = stmt.query_map([book.id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    }

    let sort_name = compute_author_sort_name(trimmed);
    let affected_book_count = books.len() as i64;

    let tx = conn.transaction()?;

    tx.execute(
        "UPDATE authors SET name = ?1, sort_name = ?2 WHERE id = ?3",
        rusqlite::params![trimmed, sort_name, author_id],
    )?;

    let mut moves = Vec::new();

    // Only books where this author is the primary (order 0) author move folders - a secondary
    // co-author's rename doesn't change where the book lives.
    for book in books.iter().filter(|b| b.is_primary_author) {
        let relocation = crate::folder_relocator::relocate_if_needed(
            std::path::Path::new(library_root),
            book.id,
            &book.title,
            &sort_name,
            &book.folder_path,
            &book.files,
        );
        let relocation = match relocation {
            Ok(r) => r,
            Err(err) => {
                rollback_moves(&moves);
                return Err(err);
            }
        };

        if let Some(m) = relocation.folder_move {
            moves.push(m);
        }

        tx.execute(
            "UPDATE books SET folder_path = ?1 WHERE id = ?2",
            rusqlite::params![relocation.new_folder_relative, book.id],
        )?;
        for (file_id, new_path) in &relocation.updated_files {
            tx.execute("UPDATE book_files SET file_path = ?1 WHERE id = ?2", rusqlite::params![new_path, file_id])?;
        }
    }

    match tx.commit() {
        Ok(()) => Ok(AuthorRenameResult {
            outcome: AuthorRenameOutcome::Renamed,
            author_id: Some(author_id),
            author_name: Some(trimmed.to_string()),
            affected_book_count,
        }),
        Err(err) => {
            // Best-effort rollback of every folder move already performed, so disk and DB don't
            // diverge if a later book's move fails partway through.
            rollback_moves(&moves);
            Err(err.into())
        }
    }
}

fn rollback_moves(moves: &[crate::folder_relocator::FolderMove]) {
    for m in moves {
        if m.new_absolute.exists() && !m.old_absolute.exists() {
            let _ = std::fs::rename(&m.new_absolute, &m.old_absolute);
        }
    }
}
