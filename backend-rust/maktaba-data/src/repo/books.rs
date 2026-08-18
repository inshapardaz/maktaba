//! Read queries backing the book-listing/detail endpoints. Mirrors the query logic in
//! Maktaba.Api/Endpoints/BookEndpoints.cs (kept here rather than in maktaba-api so the SQL and
//! its shaping stay next to the schema it depends on; maktaba-api just encodes ids to sqids and
//! serializes the result).

use std::collections::HashMap;
use std::path::Path;

use chrono::NaiveDateTime;
use maktaba_core::entities::{BookFormat, ReadingStatus};
use rusqlite::{Connection, OptionalExtension};

use crate::cover_locator;

#[derive(Default)]
pub struct BookListFilters {
    pub search: Option<String>,
    pub author_id: Option<i64>,
    pub series_id: Option<i64>,
    pub tag_id: Option<i64>,
    pub collection_id: Option<i64>,
    pub reading_status: Option<ReadingStatus>,
    pub format: Option<BookFormat>,
    pub min_rating: Option<i64>,
}

pub struct BookSummaryRow {
    pub id: i64,
    pub title: String,
    pub sort_title: String,
    pub authors: Vec<String>,
    pub rating: i64,
    pub date_added: NaiveDateTime,
    pub has_cover: bool,
    pub reading_status: ReadingStatus,
    pub series_index: Option<f64>,
    pub last_read_at: Option<NaiveDateTime>,
}

pub struct ContinueReadingRow {
    pub id: i64,
    pub title: String,
    pub authors: Vec<String>,
    pub has_cover: bool,
    pub reading_status: ReadingStatus,
    pub format: BookFormat,
    pub absolute_path: String,
    pub percentage: f64,
    pub updated_at: NaiveDateTime,
}

pub struct IdentifierRow {
    pub scheme: String,
    pub value: String,
}

pub struct BookFileRow {
    pub format: BookFormat,
    pub file_size_bytes: i64,
    pub absolute_path: String,
}

pub struct BookCollectionRow {
    pub id: i64,
    pub name: String,
}

pub struct BookDetailRow {
    pub id: i64,
    pub title: String,
    pub sort_title: String,
    pub description: Option<String>,
    pub language: Option<String>,
    pub publisher: Option<String>,
    pub date_published: Option<chrono::NaiveDate>,
    pub rating: i64,
    pub date_added: NaiveDateTime,
    pub authors: Vec<String>,
    pub series_name: Option<String>,
    pub series_index: Option<f64>,
    pub tags: Vec<String>,
    pub identifiers: Vec<IdentifierRow>,
    pub files: Vec<BookFileRow>,
    pub has_cover: bool,
    pub reading_status: ReadingStatus,
    pub collections: Vec<BookCollectionRow>,
}

struct CandidateBook {
    id: i64,
    title: String,
    sort_title: String,
    rating: i64,
    date_added: NaiveDateTime,
    reading_status: ReadingStatus,
    folder_path: String,
}

pub fn book_exists(conn: &Connection, book_id: i64) -> anyhow::Result<bool> {
    Ok(conn
        .query_row("SELECT 1 FROM books WHERE id = ?1", [book_id], |_| Ok(true))
        .optional()?
        .unwrap_or(false))
}

pub fn list_books(
    conn: &Connection,
    library_root: &str,
    filters: &BookListFilters,
) -> anyhow::Result<Vec<BookSummaryRow>> {
    let mut conditions = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();

    if let Some(author_id) = filters.author_id {
        conditions.push("EXISTS (SELECT 1 FROM book_authors ba WHERE ba.book_id = b.id AND ba.author_id = ?)".to_string());
        params.push(Box::new(author_id));
    }
    if let Some(series_id) = filters.series_id {
        conditions.push("EXISTS (SELECT 1 FROM book_series bs WHERE bs.book_id = b.id AND bs.series_id = ?)".to_string());
        params.push(Box::new(series_id));
    }
    if let Some(tag_id) = filters.tag_id {
        conditions.push("EXISTS (SELECT 1 FROM book_tags bt WHERE bt.book_id = b.id AND bt.tag_id = ?)".to_string());
        params.push(Box::new(tag_id));
    }
    if let Some(collection_id) = filters.collection_id {
        conditions.push("EXISTS (SELECT 1 FROM book_collections bc WHERE bc.book_id = b.id AND bc.collection_id = ?)".to_string());
        params.push(Box::new(collection_id));
    }
    if let Some(status) = filters.reading_status {
        conditions.push("b.reading_status = ?".to_string());
        params.push(Box::new(status.as_str().to_string()));
    }
    if let Some(rating) = filters.min_rating {
        conditions.push("b.rating >= ?".to_string());
        params.push(Box::new(rating));
    }
    if let Some(format) = filters.format {
        conditions.push("EXISTS (SELECT 1 FROM book_files f WHERE f.book_id = b.id AND f.format = ?)".to_string());
        params.push(Box::new(format.as_str().to_string()));
    }

    let where_clause = if conditions.is_empty() { String::new() } else { format!("WHERE {}", conditions.join(" AND ")) };
    let sql = format!(
        "SELECT b.id, b.title, b.sort_title, b.rating, b.date_added, b.reading_status, b.folder_path
         FROM books b {where_clause}"
    );

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let candidates: Vec<CandidateBook> = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok(CandidateBook {
                id: row.get(0)?,
                title: row.get(1)?,
                sort_title: row.get(2)?,
                rating: row.get(3)?,
                date_added: row.get(4)?,
                reading_status: ReadingStatus::parse(&row.get::<_, String>(5)?).unwrap_or(ReadingStatus::Unread),
                folder_path: row.get(6)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    let book_ids: Vec<i64> = candidates.iter().map(|c| c.id).collect();
    let authors_by_book = load_authors_by_book(conn, &book_ids)?;
    let series_by_book = load_series_by_book(conn, &book_ids)?;
    let tags_by_book = load_tags_by_book(conn, &book_ids)?;
    let last_read_by_book = load_last_read_by_book(conn, &book_ids)?;

    // Free-text search runs against the already-materialized list, matching the C# endpoint's own
    // "small dataset, in-memory filter after SQL-side filters" approach.
    let search_term = filters.search.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(|s| s.to_lowercase());

    let library_root = Path::new(library_root);
    let mut rows: Vec<BookSummaryRow> = candidates
        .into_iter()
        .filter(|c| {
            let Some(term) = &search_term else { return true };
            let authors = authors_by_book.get(&c.id).map(|v| v.as_slice()).unwrap_or(&[]);
            let series = series_by_book.get(&c.id);
            let tags = tags_by_book.get(&c.id).map(|v| v.as_slice()).unwrap_or(&[]);

            c.title.to_lowercase().contains(term.as_str())
                || authors.iter().any(|(_, name)| name.to_lowercase().contains(term.as_str()))
                || series.map(|(name, _)| name.to_lowercase().contains(term.as_str())).unwrap_or(false)
                || tags.iter().any(|t| t.to_lowercase().contains(term.as_str()))
        })
        .map(|c| {
            let mut authors = authors_by_book.get(&c.id).cloned().unwrap_or_default();
            authors.sort_by_key(|(order, _)| *order);

            BookSummaryRow {
                id: c.id,
                title: c.title,
                sort_title: c.sort_title.clone(),
                authors: authors.into_iter().map(|(_, name)| name).collect(),
                rating: c.rating,
                date_added: c.date_added,
                has_cover: cover_locator::find(library_root, &c.folder_path).is_some(),
                reading_status: c.reading_status,
                series_index: series_by_book.get(&c.id).map(|(_, idx)| *idx),
                last_read_at: last_read_by_book.get(&c.id).copied(),
            }
        })
        .collect();

    rows.sort_by(|a, b| a.sort_title.to_lowercase().cmp(&b.sort_title.to_lowercase()));

    Ok(rows)
}

pub fn continue_reading(conn: &Connection, library_root: &str, limit: i64) -> anyhow::Result<Vec<ContinueReadingRow>> {
    let mut stmt = conn.prepare(
        "SELECT b.id, b.title, b.folder_path, b.reading_status, rp.percentage, rp.updated_at
         FROM reading_progress rp JOIN books b ON b.id = rp.book_id
         ORDER BY rp.updated_at DESC LIMIT ?1",
    )?;

    struct Row {
        id: i64,
        title: String,
        folder_path: String,
        reading_status: ReadingStatus,
        percentage: f64,
        updated_at: NaiveDateTime,
    }

    let candidates: Vec<Row> = stmt
        .query_map([limit], |row| {
            Ok(Row {
                id: row.get(0)?,
                title: row.get(1)?,
                folder_path: row.get(2)?,
                reading_status: ReadingStatus::parse(&row.get::<_, String>(3)?).unwrap_or(ReadingStatus::Unread),
                percentage: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?
        .collect::<Result<_, _>>()?;

    let book_ids: Vec<i64> = candidates.iter().map(|c| c.id).collect();
    let authors_by_book = load_authors_by_book(conn, &book_ids)?;
    let files_by_book = load_files_by_book(conn, &book_ids)?;
    let library_root = Path::new(library_root);

    let rows = candidates
        .into_iter()
        .map(|c| {
            let mut authors = authors_by_book.get(&c.id).cloned().unwrap_or_default();
            authors.sort_by_key(|(order, _)| *order);

            let files = files_by_book.get(&c.id).cloned().unwrap_or_default();
            // Same "prefer Epub" rule the frontend's openReader uses - the resume button opens
            // whichever format this feed reports without a second round trip.
            let file = files
                .iter()
                .find(|f| f.0 == BookFormat::Epub)
                .or_else(|| files.first());

            ContinueReadingRow {
                id: c.id,
                title: c.title,
                authors: authors.into_iter().map(|(_, name)| name).collect(),
                has_cover: cover_locator::find(library_root, &c.folder_path).is_some(),
                reading_status: c.reading_status,
                format: file.map(|f| f.0).unwrap_or(BookFormat::Epub),
                absolute_path: file.map(|f| library_root.join(&f.1).to_string_lossy().to_string()).unwrap_or_default(),
                percentage: c.percentage,
                updated_at: c.updated_at,
            }
        })
        .collect();

    Ok(rows)
}

pub fn get_book_detail(conn: &Connection, library_root: &str, book_id: i64) -> anyhow::Result<Option<BookDetailRow>> {
    let base = conn
        .query_row(
            "SELECT title, sort_title, description, language, publisher, date_published,
                    rating, date_added, reading_status, folder_path
             FROM books WHERE id = ?1",
            [book_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<chrono::NaiveDate>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, NaiveDateTime>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                ))
            },
        )
        .optional()?;

    let Some((
        title, sort_title, description, language, publisher, date_published,
        rating, date_added, reading_status, folder_path,
    )) = base else {
        return Ok(None);
    };

    let mut authors: Vec<(i64, String)> = {
        let mut stmt = conn.prepare(
            "SELECT a.name, ba.\"order\" FROM book_authors ba JOIN authors a ON a.id = ba.author_id
             WHERE ba.book_id = ?1",
        )?;
        let rows = stmt.query_map([book_id], |r| Ok((r.get::<_, i64>(1)?, r.get::<_, String>(0)?)))?.collect::<Result<_, _>>()?;
        rows
    };
    authors.sort_by_key(|(order, _)| *order);

    let series: Option<(String, f64)> = conn
        .query_row(
            "SELECT s.name, bs.series_index FROM book_series bs JOIN series s ON s.id = bs.series_id
             WHERE bs.book_id = ?1 LIMIT 1",
            [book_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;

    let tags: Vec<String> = {
        let mut stmt = conn.prepare(
            "SELECT t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id WHERE bt.book_id = ?1",
        )?;
        let rows = stmt.query_map([book_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
        rows
    };

    let identifiers: Vec<IdentifierRow> = {
        let mut stmt = conn.prepare("SELECT scheme, value FROM identifiers WHERE book_id = ?1")?;
        let rows = stmt
            .query_map([book_id], |r| Ok(IdentifierRow { scheme: r.get(0)?, value: r.get(1)? }))?
            .collect::<Result<_, _>>()?;
        rows
    };

    let library_root_path = Path::new(library_root);
    let files: Vec<BookFileRow> = {
        let mut stmt = conn.prepare("SELECT format, file_size_bytes, file_path FROM book_files WHERE book_id = ?1")?;
        let raw_rows = stmt
            .query_map([book_id], |r| {
                let format: String = r.get(0)?;
                let file_size_bytes: i64 = r.get(1)?;
                let file_path: String = r.get(2)?;
                Ok((format, file_size_bytes, file_path))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        raw_rows
            .into_iter()
            .map(|(format, size, path)| BookFileRow {
                format: BookFormat::parse(&format).unwrap_or(BookFormat::Epub),
                file_size_bytes: size,
                absolute_path: library_root_path.join(&path).to_string_lossy().to_string(),
            })
            .collect()
    };

    let collections: Vec<BookCollectionRow> = {
        let mut stmt = conn.prepare(
            "SELECT c.id, c.name FROM book_collections bc JOIN collections c ON c.id = bc.collection_id
             WHERE bc.book_id = ?1",
        )?;
        let rows = stmt
            .query_map([book_id], |r| Ok(BookCollectionRow { id: r.get(0)?, name: r.get(1)? }))?
            .collect::<Result<_, _>>()?;
        rows
    };

    Ok(Some(BookDetailRow {
        id: book_id,
        title,
        sort_title,
        description,
        language,
        publisher,
        date_published,
        rating,
        date_added,
        authors: authors.into_iter().map(|(_, name)| name).collect(),
        series_name: series.as_ref().map(|(name, _)| name.clone()),
        series_index: series.map(|(_, idx)| idx),
        tags,
        identifiers,
        files,
        has_cover: cover_locator::find(library_root_path, &folder_path).is_some(),
        reading_status: ReadingStatus::parse(&reading_status).unwrap_or(ReadingStatus::Unread),
        collections,
    }))
}

fn load_authors_by_book(conn: &Connection, book_ids: &[i64]) -> anyhow::Result<HashMap<i64, Vec<(i64, String)>>> {
    let mut map: HashMap<i64, Vec<(i64, String)>> = HashMap::new();
    if book_ids.is_empty() {
        return Ok(map);
    }

    let placeholders = book_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT ba.book_id, ba.\"order\", a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
         WHERE ba.book_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(book_ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (book_id, order, name) = row?;
        map.entry(book_id).or_default().push((order, name));
    }
    Ok(map)
}

fn load_series_by_book(conn: &Connection, book_ids: &[i64]) -> anyhow::Result<HashMap<i64, (String, f64)>> {
    let mut map = HashMap::new();
    if book_ids.is_empty() {
        return Ok(map);
    }

    let placeholders = book_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT bs.book_id, s.name, bs.series_index FROM book_series bs JOIN series s ON s.id = bs.series_id
         WHERE bs.book_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(book_ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, f64>(2)?))
    })?;
    for row in rows {
        let (book_id, name, index) = row?;
        map.entry(book_id).or_insert((name, index));
    }
    Ok(map)
}

fn load_tags_by_book(conn: &Connection, book_ids: &[i64]) -> anyhow::Result<HashMap<i64, Vec<String>>> {
    let mut map: HashMap<i64, Vec<String>> = HashMap::new();
    if book_ids.is_empty() {
        return Ok(map);
    }

    let placeholders = book_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT bt.book_id, t.name FROM book_tags bt JOIN tags t ON t.id = bt.tag_id
         WHERE bt.book_id IN ({placeholders})"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(book_ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (book_id, name) = row?;
        map.entry(book_id).or_default().push(name);
    }
    Ok(map)
}

fn load_last_read_by_book(conn: &Connection, book_ids: &[i64]) -> anyhow::Result<HashMap<i64, NaiveDateTime>> {
    let mut map = HashMap::new();
    if book_ids.is_empty() {
        return Ok(map);
    }

    let placeholders = book_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT book_id, updated_at FROM reading_progress WHERE book_id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(book_ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, NaiveDateTime>(1)?))
    })?;
    for row in rows {
        let (book_id, updated_at) = row?;
        map.insert(book_id, updated_at);
    }
    Ok(map)
}

fn load_files_by_book(conn: &Connection, book_ids: &[i64]) -> anyhow::Result<HashMap<i64, Vec<(BookFormat, String)>>> {
    let mut map: HashMap<i64, Vec<(BookFormat, String)>> = HashMap::new();
    if book_ids.is_empty() {
        return Ok(map);
    }

    let placeholders = book_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!("SELECT book_id, format, file_path FROM book_files WHERE book_id IN ({placeholders})");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(book_ids.iter()), |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
    })?;
    for row in rows {
        let (book_id, format, path) = row?;
        map.entry(book_id).or_default().push((BookFormat::parse(&format).unwrap_or(BookFormat::Epub), path));
    }
    Ok(map)
}
