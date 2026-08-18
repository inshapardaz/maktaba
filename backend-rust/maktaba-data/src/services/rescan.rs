//! Rebuilds metadata.db from the on-disk library folder. Only recognizes folders following
//! Maktaba's own "{Author}/{Title} ({BookId})" layout. Everything DB-only (rating, reading
//! status, date_added, tags, series, collection membership, bookmarks, notes, reading progress)
//! is snapshotted per book id before the wipe and reapplied to the rebuilt row for any book whose
//! folder (and therefore id) still exists. Mirrors Maktaba.Data/Services/LibraryRescanService.cs.

use std::collections::HashMap;
use std::path::Path;

use chrono::{NaiveDateTime, Utc};
use maktaba_core::entities::ReadingStatus;
use maktaba_core::ids;
use maktaba_core::metadata::BookMetadataExtractor;
use maktaba_core::naming::compute_sort_title;
use rusqlite::Connection;

use crate::file_helpers;
use crate::resolvers;
use crate::rescan_progress::RescanProgressTracker;

struct SeriesInfo {
    name: String,
    index: f64,
}

struct BookmarkInfo {
    client_id: String,
    chapter_id: String,
    position: f64,
    name: String,
    created_at: NaiveDateTime,
    updated_at: Option<NaiveDateTime>,
}

struct NoteInfo {
    client_id: String,
    chapter_id: String,
    start_offset: i64,
    end_offset: i64,
    text: String,
    comment: Option<String>,
    created_at: NaiveDateTime,
    updated_at: Option<NaiveDateTime>,
}

struct ProgressInfo {
    current_chapter: i64,
    total_chapters: i64,
    current_page: i64,
    total_pages: i64,
    chapter_title: Option<String>,
    percentage: f64,
    chapter_id: Option<String>,
    position: Option<f64>,
    updated_at: NaiveDateTime,
}

#[derive(Default)]
struct PreviousBookState {
    rating: Option<i64>,
    reading_status: Option<ReadingStatus>,
    date_added: Option<NaiveDateTime>,
    tag_names: Vec<String>,
    series: Option<SeriesInfo>,
    collection_ids: Vec<i64>,
    bookmarks: Vec<BookmarkInfo>,
    notes: Vec<NoteInfo>,
    progress: Option<ProgressInfo>,
}

pub fn rescan(
    conn: &mut Connection,
    library_root: &str,
    extractors: &[Box<dyn BookMetadataExtractor>],
    progress: &RescanProgressTracker,
) -> anyhow::Result<i64> {
    let result = rescan_inner(conn, library_root, extractors, progress);
    // Always clears is_running, success or failure, so a poller never gets stuck believing a
    // rescan that errored out is still going.
    progress.complete();
    result
}

fn rescan_inner(
    conn: &mut Connection,
    library_root: &str,
    extractors: &[Box<dyn BookMetadataExtractor>],
    progress: &RescanProgressTracker,
) -> anyhow::Result<i64> {
    let mut book_dirs = Vec::new();
    for author_entry in std::fs::read_dir(library_root)?.flatten() {
        if !author_entry.file_type()?.is_dir() {
            continue;
        }
        for book_entry in std::fs::read_dir(author_entry.path())?.flatten() {
            if book_entry.file_type()?.is_dir() {
                book_dirs.push(book_entry.path());
            }
        }
    }

    progress.start(book_dirs.len() as i64);

    // Everything below - the wipe and the rebuild - runs inside one transaction. If the scan
    // fails partway, the transaction is rolled back on drop without a commit, leaving the
    // previous index intact instead of stuck half-wiped.
    let tx = conn.transaction()?;

    let previous_states = load_previous_book_states(&tx)?;

    // Wipe the index (children before parents - though ON DELETE CASCADE from books also covers
    // this). Collections themselves are user-authored and survive a rescan; per-book membership
    // does not - it's re-set explicitly from previous_states below, same as ratings, reading
    // status, tags, series, and date_added.
    tx.execute_batch(
        "DELETE FROM book_authors; DELETE FROM book_series; DELETE FROM book_tags;
         DELETE FROM book_collections; DELETE FROM identifiers; DELETE FROM book_files;
         DELETE FROM bookmarks; DELETE FROM notes; DELETE FROM reading_progress;
         DELETE FROM books; DELETE FROM authors; DELETE FROM series; DELETE FROM tags;",
    )?;

    let mut imported_count = 0i64;

    for (i, book_dir) in book_dirs.iter().enumerate() {
        let outcome = try_index_book_folder(&tx, library_root, book_dir, &previous_states, extractors);
        match outcome {
            Ok(true) => imported_count += 1,
            // A single unreadable book folder must not block every other book in the library from
            // being correctly re-indexed, nor block books that really were deleted from being
            // pruned - so only this one book's attempt is skipped, not the whole scan.
            Ok(false) | Err(_) => {}
        }

        let name = book_dir.file_name().and_then(|n| n.to_str()).map(|s| s.to_string());
        progress.report(i as i64 + 1, name);
    }

    tx.commit()?;

    Ok(imported_count)
}

fn load_previous_book_states(conn: &Connection) -> anyhow::Result<HashMap<i64, PreviousBookState>> {
    let mut states: HashMap<i64, PreviousBookState> = HashMap::new();

    {
        let mut stmt =
            conn.prepare("SELECT id, rating, reading_status, date_added FROM books")?;
        let rows = stmt.query_map([], |row| {
            let id: i64 = row.get(0)?;
            let rating: i64 = row.get(1)?;
            let status: String = row.get(2)?;
            let date_added: NaiveDateTime = row.get(3)?;
            Ok((id, rating, status, date_added))
        })?;
        for row in rows {
            let (id, rating, status, date_added) = row?;
            let entry = states.entry(id).or_default();
            entry.rating = Some(rating);
            entry.reading_status = Some(ReadingStatus::parse(&status).unwrap_or(ReadingStatus::Unread));
            entry.date_added = Some(date_added);
        }
    }

    {
        let mut stmt = conn.prepare(
            "SELECT bt.book_id, t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
        for row in rows {
            let (book_id, tag_name) = row?;
            states.entry(book_id).or_default().tag_names.push(tag_name);
        }
    }

    {
        let mut stmt = conn.prepare(
            "SELECT bs.book_id, s.name, bs.series_index FROM book_series bs JOIN series s ON s.id = bs.series_id",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
        })?;
        for row in rows {
            let (book_id, name, index) = row?;
            states.entry(book_id).or_default().series = Some(SeriesInfo { name, index });
        }
    }

    {
        let mut stmt = conn.prepare("SELECT book_id, collection_id FROM book_collections")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;
        for row in rows {
            let (book_id, collection_id) = row?;
            states.entry(book_id).or_default().collection_ids.push(collection_id);
        }
    }

    {
        let mut stmt = conn.prepare(
            "SELECT book_id, client_id, chapter_id, position, name, created_at, updated_at FROM bookmarks",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                BookmarkInfo {
                    client_id: row.get(1)?,
                    chapter_id: row.get(2)?,
                    position: row.get(3)?,
                    name: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                },
            ))
        })?;
        for row in rows {
            let (book_id, info) = row?;
            states.entry(book_id).or_default().bookmarks.push(info);
        }
    }

    {
        let mut stmt = conn.prepare(
            "SELECT book_id, client_id, chapter_id, start_offset, end_offset, text, comment, created_at, updated_at
             FROM notes",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                NoteInfo {
                    client_id: row.get(1)?,
                    chapter_id: row.get(2)?,
                    start_offset: row.get(3)?,
                    end_offset: row.get(4)?,
                    text: row.get(5)?,
                    comment: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                },
            ))
        })?;
        for row in rows {
            let (book_id, info) = row?;
            states.entry(book_id).or_default().notes.push(info);
        }
    }

    {
        let mut stmt = conn.prepare(
            "SELECT book_id, current_chapter, total_chapters, current_page, total_pages,
                    chapter_title, percentage, chapter_id, position, updated_at
             FROM reading_progress",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                ProgressInfo {
                    current_chapter: row.get(1)?,
                    total_chapters: row.get(2)?,
                    current_page: row.get(3)?,
                    total_pages: row.get(4)?,
                    chapter_title: row.get(5)?,
                    percentage: row.get(6)?,
                    chapter_id: row.get(7)?,
                    position: row.get(8)?,
                    updated_at: row.get(9)?,
                },
            ))
        })?;
        for row in rows {
            let (book_id, info) = row?;
            states.entry(book_id).or_default().progress = Some(info);
        }
    }

    Ok(states)
}

/// Matches "{title} ({sqid})" - the trailing "(...)" is expected to be a sqid (see maktaba_core::ids);
/// actual validity is checked by trying to decode it.
fn parse_book_folder_name(name: &str) -> Option<(&str, i64)> {
    let open = name.rfind(" (")?;
    if !name.ends_with(')') {
        return None;
    }
    let title = &name[..open];
    let id_part = &name[open + 2..name.len() - 1];
    if id_part.contains(['(', ')']) {
        return None;
    }
    let id = ids::try_decode(id_part)?;
    Some((title, id))
}

fn try_index_book_folder(
    conn: &Connection,
    library_root: &str,
    book_dir: &Path,
    previous_states: &HashMap<i64, PreviousBookState>,
    extractors: &[Box<dyn BookMetadataExtractor>],
) -> anyhow::Result<bool> {
    let folder_name = book_dir.file_name().and_then(|n| n.to_str()).unwrap_or_default();
    let Some((_title_from_folder, book_id)) = parse_book_folder_name(folder_name) else {
        return Ok(false);
    };

    let ebook_files: Vec<_> = std::fs::read_dir(book_dir)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file() && extractors.iter().any(|ex| ex.can_handle(p)))
        .collect();

    if ebook_files.is_empty() {
        return Ok(false);
    }

    let relative_folder = pathdiff_relative(library_root, book_dir);

    let mut book_created = false;

    for file_path in &ebook_files {
        let extractor = extractors.iter().find(|e| e.can_handle(file_path)).unwrap();
        let metadata = extractor.extract(file_path)?;
        let hash = file_helpers::compute_sha256(file_path)?;
        let format = file_helpers::detect_format(file_path)?;

        if !book_created {
            let authors = resolvers::resolve_authors(conn, &metadata.authors)?;

            let previous = previous_states.get(&book_id);
            let date_added = previous
                .and_then(|p| p.date_added)
                .unwrap_or_else(|| Utc::now().naive_utc());
            let rating = previous.and_then(|p| p.rating).unwrap_or(0);
            let reading_status = previous.and_then(|p| p.reading_status).unwrap_or(ReadingStatus::Unread);

            conn.execute(
                "INSERT INTO books(id, title, sort_title, description, language, publisher,
                                    date_published, date_added, rating, reading_status, folder_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                rusqlite::params![
                    book_id,
                    metadata.title,
                    compute_sort_title(&metadata.title),
                    metadata.description,
                    metadata.language,
                    metadata.publisher,
                    metadata.published_date,
                    date_added,
                    rating,
                    reading_status.as_str(),
                    relative_folder,
                ],
            )?;

            for (order, author) in authors.iter().enumerate() {
                conn.execute(
                    "INSERT INTO book_authors(book_id, author_id, \"order\") VALUES (?1, ?2, ?3)",
                    rusqlite::params![book_id, author.id, order as i64],
                )?;
            }

            for identifier in &metadata.identifiers {
                conn.execute(
                    "INSERT INTO identifiers(book_id, scheme, value) VALUES (?1, ?2, ?3)",
                    rusqlite::params![book_id, identifier.scheme, identifier.value],
                )?;
            }

            if let Some(previous) = previous {
                let tags = resolvers::resolve_tags(conn, &previous.tag_names)?;
                for tag in &tags {
                    conn.execute(
                        "INSERT INTO book_tags(book_id, tag_id) VALUES (?1, ?2)",
                        rusqlite::params![book_id, tag.id],
                    )?;
                }

                if let Some(previous_series) = &previous.series {
                    if let Some(series) = resolvers::resolve_series(conn, Some(&previous_series.name))? {
                        conn.execute(
                            "INSERT INTO book_series(book_id, series_id, series_index) VALUES (?1, ?2, ?3)",
                            rusqlite::params![book_id, series.id, previous_series.index],
                        )?;
                    }
                }

                for collection_id in &previous.collection_ids {
                    // A collection previously linked to this book may itself have been deleted
                    // since the last rescan - skip membership rows that would now dangle.
                    let exists: bool = conn
                        .query_row("SELECT 1 FROM collections WHERE id = ?1", [collection_id], |_| Ok(true))
                        .unwrap_or(false);
                    if exists {
                        conn.execute(
                            "INSERT INTO book_collections(book_id, collection_id) VALUES (?1, ?2)",
                            rusqlite::params![book_id, collection_id],
                        )?;
                    }
                }

                for bookmark in &previous.bookmarks {
                    conn.execute(
                        "INSERT INTO bookmarks(book_id, client_id, chapter_id, position, name, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                        rusqlite::params![
                            book_id, bookmark.client_id, bookmark.chapter_id, bookmark.position,
                            bookmark.name, bookmark.created_at, bookmark.updated_at,
                        ],
                    )?;
                }

                for note in &previous.notes {
                    conn.execute(
                        "INSERT INTO notes(book_id, client_id, chapter_id, start_offset, end_offset, text, comment, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                        rusqlite::params![
                            book_id, note.client_id, note.chapter_id, note.start_offset, note.end_offset,
                            note.text, note.comment, note.created_at, note.updated_at,
                        ],
                    )?;
                }

                if let Some(progress) = &previous.progress {
                    conn.execute(
                        "INSERT INTO reading_progress(book_id, current_chapter, total_chapters, current_page,
                                                        total_pages, chapter_title, percentage, chapter_id, position, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                        rusqlite::params![
                            book_id, progress.current_chapter, progress.total_chapters, progress.current_page,
                            progress.total_pages, progress.chapter_title, progress.percentage,
                            progress.chapter_id, progress.position, progress.updated_at,
                        ],
                    )?;
                }
            }

            book_created = true;
        }

        let relative_file_path = format!(
            "{relative_folder}/{}",
            file_path.file_name().and_then(|n| n.to_str()).unwrap_or_default()
        );
        let file_size = std::fs::metadata(file_path)?.len() as i64;

        conn.execute(
            "INSERT INTO book_files(book_id, format, file_path, file_size_bytes, content_hash)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![book_id, format.as_str(), relative_file_path, file_size, hash],
        )?;
    }

    Ok(true)
}

fn pathdiff_relative(root: &str, path: &Path) -> String {
    let root = Path::new(root);
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}
