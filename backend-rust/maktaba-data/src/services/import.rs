//! Mirrors Maktaba.Data/Services/ImportService.cs.

use std::path::Path;

use chrono::Utc;
use maktaba_core::entities::{Book, BookFormat, ReadingStatus};
use maktaba_core::error::ImportError;
use maktaba_core::ids;
use maktaba_core::metadata::BookMetadataExtractor;
use maktaba_core::naming::{compute_sort_title, sanitize_path_segment};
use maktaba_core::services::{DuplicateBookInfo, ImportDuplicateResolution};
use rusqlite::{Connection, OptionalExtension};

use crate::file_helpers;
use crate::resolvers;

pub fn import_file(
    conn: &mut Connection,
    library_root: &str,
    extractors: &[Box<dyn BookMetadataExtractor>],
    source_file_path: &str,
    resolution: ImportDuplicateResolution,
) -> Result<Book, ImportError> {
    let path = Path::new(source_file_path);

    let extractor = extractors
        .iter()
        .find(|e| e.can_handle(path))
        .ok_or_else(|| {
            ImportError::UnsupportedFileType(
                path.extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default(),
            )
        })?;

    let metadata = extractor.extract(path)?;
    let content_hash = file_helpers::compute_sha256(path)?;
    let format = file_helpers::detect_format(path)?;

    if resolution != ImportDuplicateResolution::KeepBoth {
        if let Some((existing_book_id, existing_title, existing_authors, same_content_hash)) =
            find_duplicate(conn, &metadata.title, &metadata.authors, &content_hash)?
        {
            match resolution {
                ImportDuplicateResolution::Auto => {
                    return Err(ImportError::DuplicateDetected {
                        info: DuplicateBookInfo {
                            existing_book_id,
                            existing_title,
                            existing_authors,
                            same_content_hash,
                        },
                    });
                }
                ImportDuplicateResolution::Skip => {
                    return Ok(load_book(conn, existing_book_id)?.expect("just found by id"));
                }
                ImportDuplicateResolution::Merge => {
                    return Ok(merge_file_into_existing_book(
                        conn,
                        library_root,
                        existing_book_id,
                        source_file_path,
                        format,
                        &content_hash,
                    )?);
                }
                ImportDuplicateResolution::KeepBoth => unreachable!(),
            }
        }
    }

    let sort_title = compute_sort_title(&metadata.title);
    let tx = conn.transaction()?;

    let authors = resolvers::resolve_authors(&tx, &metadata.authors)?;

    let date_added = Utc::now().naive_utc();
    tx.execute(
        "INSERT INTO books(title, sort_title, description, language, publisher, date_published,
                            date_added, rating, reading_status, folder_path)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, '')",
        rusqlite::params![
            metadata.title,
            sort_title,
            metadata.description,
            metadata.language,
            metadata.publisher,
            metadata.published_date,
            date_added,
            ReadingStatus::Unread.as_str(),
        ],
    )?;
    let book_id = tx.last_insert_rowid();

    for (order, author) in authors.iter().enumerate() {
        tx.execute(
            "INSERT INTO book_authors(book_id, author_id, \"order\") VALUES (?1, ?2, ?3)",
            rusqlite::params![book_id, author.id, order as i64],
        )?;
    }

    for identifier in &metadata.identifiers {
        tx.execute(
            "INSERT INTO identifiers(book_id, scheme, value) VALUES (?1, ?2, ?3)",
            rusqlite::params![book_id, identifier.scheme, identifier.value],
        )?;
    }

    // The on-disk folder name embeds this book's id (as a sqid, so a rescan can recover it), which
    // means the id has to exist before the folder can be created - hence the insert above, with
    // the folder/file/folder_path filled in below inside the same transaction, rolled back on error.
    let author_folder_segment = sanitize_path_segment(
        authors.first().map(|a| a.sort_name.as_str()).unwrap_or("Unknown Author"),
    );
    let book_folder_segment =
        sanitize_path_segment(&format!("{} ({})", metadata.title, ids::encode(book_id)));
    let relative_folder = format!("{author_folder_segment}/{book_folder_segment}");
    let absolute_folder = Path::new(library_root).join(&relative_folder);

    let result = (|| -> anyhow::Result<()> {
        std::fs::create_dir_all(&absolute_folder)?;

        let dest_file_name = format!(
            "{}{}",
            sanitize_path_segment(&metadata.title),
            path.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default()
        );
        let dest_file_path = absolute_folder.join(&dest_file_name);
        std::fs::copy(path, &dest_file_path)?;

        if let Some(cover_bytes) = &metadata.cover_image_bytes {
            if !cover_bytes.is_empty() {
                let cover_extension = file_helpers::cover_extension_for(metadata.cover_content_type.as_deref());
                std::fs::write(absolute_folder.join(format!("cover.{cover_extension}")), cover_bytes)?;
            }
        }

        let file_size = std::fs::metadata(&dest_file_path)?.len() as i64;
        let relative_file_path = format!("{relative_folder}/{dest_file_name}");

        tx.execute("UPDATE books SET folder_path = ?1 WHERE id = ?2", rusqlite::params![relative_folder, book_id])?;
        tx.execute(
            "INSERT INTO book_files(book_id, format, file_path, file_size_bytes, content_hash)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![book_id, format.as_str(), relative_file_path, file_size, content_hash],
        )?;

        Ok(())
    })();

    match result {
        Ok(()) => {
            tx.commit()?;
            Ok(load_book(conn, book_id)?.expect("just inserted"))
        }
        Err(err) => {
            // Transaction rolls back (undoing the book insert) on drop since it was never committed.
            let _ = std::fs::remove_dir_all(&absolute_folder);
            Err(ImportError::Other(err))
        }
    }
}

fn find_duplicate(
    conn: &Connection,
    title: &str,
    author_names: &[String],
    content_hash: &str,
) -> anyhow::Result<Option<(i64, String, Vec<String>, bool)>> {
    let hash_match: Option<i64> = conn
        .query_row("SELECT book_id FROM book_files WHERE content_hash = ?1 LIMIT 1", [content_hash], |r| r.get(0))
        .optional()?;

    if let Some(book_id) = hash_match {
        let title: String = conn.query_row("SELECT title FROM books WHERE id = ?1", [book_id], |r| r.get(0))?;
        let authors = load_author_names(conn, book_id)?;
        return Ok(Some((book_id, title, authors, true)));
    }

    let normalized_title = title.trim().to_lowercase();
    let normalized_authors: std::collections::HashSet<String> =
        author_names.iter().map(|a| a.trim().to_lowercase()).collect();

    let mut stmt = conn.prepare("SELECT id, title FROM books WHERE LOWER(title) = ?1")?;
    let candidates: Vec<(i64, String)> = stmt
        .query_map([&normalized_title], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<Result<_, _>>()?;

    for (book_id, book_title) in candidates {
        let authors = load_author_names(conn, book_id)?;
        if authors.iter().any(|a| normalized_authors.contains(&a.to_lowercase())) {
            return Ok(Some((book_id, book_title, authors, false)));
        }
    }

    Ok(None)
}

fn load_author_names(conn: &Connection, book_id: i64) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id = ?1 ORDER BY ba.\"order\"",
    )?;
    let names = stmt.query_map([book_id], |r| r.get::<_, String>(0))?.collect::<Result<_, _>>()?;
    Ok(names)
}

fn load_book(conn: &Connection, book_id: i64) -> anyhow::Result<Option<Book>> {
    conn.query_row(
        "SELECT id, title, sort_title, description, language, publisher, date_published,
                date_added, rating, reading_status, folder_path
         FROM books WHERE id = ?1",
        [book_id],
        |row| {
            Ok(Book {
                id: row.get(0)?,
                title: row.get(1)?,
                sort_title: row.get(2)?,
                description: row.get(3)?,
                language: row.get(4)?,
                publisher: row.get(5)?,
                date_published: row.get(6)?,
                date_added: row.get(7)?,
                rating: row.get(8)?,
                reading_status: ReadingStatus::parse(&row.get::<_, String>(9)?).unwrap_or(ReadingStatus::Unread),
                folder_path: row.get(10)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

fn merge_file_into_existing_book(
    conn: &mut Connection,
    library_root: &str,
    existing_book_id: i64,
    source_file_path: &str,
    format: BookFormat,
    content_hash: &str,
) -> anyhow::Result<Book> {
    let (title, folder_path): (String, String) =
        conn.query_row("SELECT title, folder_path FROM books WHERE id = ?1", [existing_book_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?;

    let folder_absolute = Path::new(library_root).join(&folder_path);
    std::fs::create_dir_all(&folder_absolute)?;

    let source_path = Path::new(source_file_path);
    let extension = source_path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_lowercase()))
        .unwrap_or_default();
    let base_file_name = format!("{}{extension}", sanitize_path_segment(&title));
    let dest_file_path = file_helpers::get_unique_file_path(&folder_absolute, &base_file_name);
    std::fs::copy(source_path, &dest_file_path)?;

    let file_size = std::fs::metadata(&dest_file_path)?.len() as i64;
    let dest_file_name = dest_file_path.file_name().and_then(|n| n.to_str()).unwrap_or(&base_file_name);
    let relative_file_path = format!("{folder_path}/{dest_file_name}");

    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO book_files(book_id, format, file_path, file_size_bytes, content_hash)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![existing_book_id, format.as_str(), relative_file_path, file_size, content_hash],
    )?;
    tx.commit()?;

    Ok(load_book(conn, existing_book_id)?.expect("just merged into"))
}
