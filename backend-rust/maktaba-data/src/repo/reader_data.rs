//! Bookmarks/notes/reading-progress CRUD. Mirrors Maktaba.Api/Endpoints/ReaderDataEndpoints.cs -
//! thin enough that the SQL lives directly behind these functions rather than a separate DTO layer.

use chrono::NaiveDateTime;
use rusqlite::{Connection, OptionalExtension};

pub struct BookmarkRow {
    pub client_id: String,
    pub chapter_id: String,
    pub position: f64,
    pub name: String,
    pub created_at: NaiveDateTime,
    pub updated_at: Option<NaiveDateTime>,
}

pub fn list_bookmarks(conn: &Connection, book_id: i64) -> anyhow::Result<Vec<BookmarkRow>> {
    let mut stmt = conn.prepare(
        "SELECT client_id, chapter_id, position, name, created_at, updated_at FROM bookmarks WHERE book_id = ?1",
    )?;
    let rows = stmt
        .query_map([book_id], |r| {
            Ok(BookmarkRow {
                client_id: r.get(0)?,
                chapter_id: r.get(1)?,
                position: r.get(2)?,
                name: r.get(3)?,
                created_at: r.get(4)?,
                updated_at: r.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_bookmark(
    conn: &Connection,
    book_id: i64,
    client_id: &str,
    chapter_id: &str,
    position: f64,
    name: &str,
    created_at: NaiveDateTime,
    updated_at: Option<NaiveDateTime>,
) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO bookmarks(book_id, client_id, chapter_id, position, name, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(client_id) DO UPDATE SET
            chapter_id = excluded.chapter_id, position = excluded.position, name = excluded.name,
            created_at = excluded.created_at, updated_at = excluded.updated_at",
        rusqlite::params![book_id, client_id, chapter_id, position, name, created_at, updated_at],
    )?;
    Ok(())
}

pub fn delete_bookmark(conn: &Connection, book_id: i64, client_id: &str) -> anyhow::Result<bool> {
    let affected = conn.execute(
        "DELETE FROM bookmarks WHERE book_id = ?1 AND client_id = ?2",
        rusqlite::params![book_id, client_id],
    )?;
    Ok(affected > 0)
}

pub struct NoteRow {
    pub client_id: String,
    pub chapter_id: String,
    pub start_offset: i64,
    pub end_offset: i64,
    pub text: String,
    pub comment: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: Option<NaiveDateTime>,
}

pub fn list_notes(conn: &Connection, book_id: i64) -> anyhow::Result<Vec<NoteRow>> {
    let mut stmt = conn.prepare(
        "SELECT client_id, chapter_id, start_offset, end_offset, text, comment, created_at, updated_at
         FROM notes WHERE book_id = ?1",
    )?;
    let rows = stmt
        .query_map([book_id], |r| {
            Ok(NoteRow {
                client_id: r.get(0)?,
                chapter_id: r.get(1)?,
                start_offset: r.get(2)?,
                end_offset: r.get(3)?,
                text: r.get(4)?,
                comment: r.get(5)?,
                created_at: r.get(6)?,
                updated_at: r.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub fn upsert_note(
    conn: &Connection,
    book_id: i64,
    client_id: &str,
    chapter_id: &str,
    start_offset: i64,
    end_offset: i64,
    text: &str,
    comment: Option<&str>,
    created_at: NaiveDateTime,
    updated_at: Option<NaiveDateTime>,
) -> anyhow::Result<()> {
    conn.execute(
        "INSERT INTO notes(book_id, client_id, chapter_id, start_offset, end_offset, text, comment, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(client_id) DO UPDATE SET
            chapter_id = excluded.chapter_id, start_offset = excluded.start_offset, end_offset = excluded.end_offset,
            text = excluded.text, comment = excluded.comment, created_at = excluded.created_at, updated_at = excluded.updated_at",
        rusqlite::params![book_id, client_id, chapter_id, start_offset, end_offset, text, comment, created_at, updated_at],
    )?;
    Ok(())
}

pub fn delete_note(conn: &Connection, book_id: i64, client_id: &str) -> anyhow::Result<bool> {
    let affected = conn.execute(
        "DELETE FROM notes WHERE book_id = ?1 AND client_id = ?2",
        rusqlite::params![book_id, client_id],
    )?;
    Ok(affected > 0)
}

pub struct ProgressRow {
    pub current_chapter: i64,
    pub total_chapters: i64,
    pub current_page: i64,
    pub total_pages: i64,
    pub chapter_title: Option<String>,
    pub percentage: f64,
    pub chapter_id: Option<String>,
    pub position: Option<f64>,
    pub updated_at: NaiveDateTime,
}

pub fn get_progress(conn: &Connection, book_id: i64) -> anyhow::Result<Option<ProgressRow>> {
    conn.query_row(
        "SELECT current_chapter, total_chapters, current_page, total_pages, chapter_title,
                percentage, chapter_id, position, updated_at
         FROM reading_progress WHERE book_id = ?1",
        [book_id],
        |r| {
            Ok(ProgressRow {
                current_chapter: r.get(0)?,
                total_chapters: r.get(1)?,
                current_page: r.get(2)?,
                total_pages: r.get(3)?,
                chapter_title: r.get(4)?,
                percentage: r.get(5)?,
                chapter_id: r.get(6)?,
                position: r.get(7)?,
                updated_at: r.get(8)?,
            })
        },
    )
    .optional()
    .map_err(Into::into)
}

pub struct SaveProgressRequest {
    pub current_chapter: Option<i64>,
    pub total_chapters: Option<i64>,
    pub current_page: Option<i64>,
    pub total_pages: Option<i64>,
    pub chapter_title: Option<String>,
    pub percentage: Option<f64>,
    pub chapter_id: Option<String>,
    pub position: Option<f64>,
}

/// Partial merge, not a blind overwrite: the display snapshot and the resume anchor are written
/// independently by two different reader callbacks - a field omitted here means "this writer
/// doesn't know it", not "clear it".
pub fn save_progress(conn: &Connection, book_id: i64, request: &SaveProgressRequest) -> anyhow::Result<()> {
    let existing = get_progress(conn, book_id)?;
    let now = chrono::Utc::now().naive_utc();

    let merged = ProgressRow {
        current_chapter: request.current_chapter.or(existing.as_ref().map(|p| p.current_chapter)).unwrap_or(0),
        total_chapters: request.total_chapters.or(existing.as_ref().map(|p| p.total_chapters)).unwrap_or(0),
        current_page: request.current_page.or(existing.as_ref().map(|p| p.current_page)).unwrap_or(0),
        total_pages: request.total_pages.or(existing.as_ref().map(|p| p.total_pages)).unwrap_or(0),
        chapter_title: request.chapter_title.clone().or_else(|| existing.as_ref().and_then(|p| p.chapter_title.clone())),
        percentage: request.percentage.or(existing.as_ref().map(|p| p.percentage)).unwrap_or(0.0),
        chapter_id: request.chapter_id.clone().or_else(|| existing.as_ref().and_then(|p| p.chapter_id.clone())),
        position: request.position.or(existing.as_ref().and_then(|p| p.position)),
        updated_at: now,
    };

    conn.execute(
        "INSERT INTO reading_progress(book_id, current_chapter, total_chapters, current_page, total_pages,
                                       chapter_title, percentage, chapter_id, position, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(book_id) DO UPDATE SET
            current_chapter = excluded.current_chapter, total_chapters = excluded.total_chapters,
            current_page = excluded.current_page, total_pages = excluded.total_pages,
            chapter_title = excluded.chapter_title, percentage = excluded.percentage,
            chapter_id = excluded.chapter_id, position = excluded.position, updated_at = excluded.updated_at",
        rusqlite::params![
            book_id, merged.current_chapter, merged.total_chapters, merged.current_page, merged.total_pages,
            merged.chapter_title, merged.percentage, merged.chapter_id, merged.position, merged.updated_at,
        ],
    )?;
    Ok(())
}
