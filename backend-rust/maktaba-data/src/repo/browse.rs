//! Distinct author/series/tag/collection lists (with book counts), publisher autocomplete list,
//! and reading-status counts. Mirrors Maktaba.Api/Endpoints/BrowseEndpoints.cs and
//! CollectionEndpoints.cs's GET.

use maktaba_core::entities::ReadingStatus;
use rusqlite::Connection;

pub struct BrowseGroupRow {
    pub id: i64,
    pub name: String,
    pub count: i64,
}

pub fn authors(conn: &Connection) -> anyhow::Result<Vec<BrowseGroupRow>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.name, COUNT(ba.book_id) c FROM authors a
         JOIN book_authors ba ON ba.author_id = a.id
         GROUP BY a.id HAVING c > 0 ORDER BY a.name",
    )?;
    let rows = stmt
        .query_map([], |r| Ok(BrowseGroupRow { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn series(conn: &Connection) -> anyhow::Result<Vec<BrowseGroupRow>> {
    let mut stmt = conn.prepare(
        "SELECT s.id, s.name, COUNT(bs.book_id) c FROM series s
         JOIN book_series bs ON bs.series_id = s.id
         GROUP BY s.id HAVING c > 0 ORDER BY s.name",
    )?;
    let rows = stmt
        .query_map([], |r| Ok(BrowseGroupRow { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn tags(conn: &Connection) -> anyhow::Result<Vec<BrowseGroupRow>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, t.name, COUNT(bt.book_id) c FROM tags t
         JOIN book_tags bt ON bt.tag_id = t.id
         GROUP BY t.id HAVING c > 0 ORDER BY t.name",
    )?;
    let rows = stmt
        .query_map([], |r| Ok(BrowseGroupRow { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// Every collection is listed, even one with zero books - unlike Authors/Series/Tags, collections
/// aren't derived from file metadata.
pub fn collections(conn: &Connection) -> anyhow::Result<Vec<BrowseGroupRow>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.name, (SELECT COUNT(*) FROM book_collections bc WHERE bc.collection_id = c.id) cnt
         FROM collections c ORDER BY c.name",
    )?;
    let rows = stmt
        .query_map([], |r| Ok(BrowseGroupRow { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn publishers(conn: &Connection) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT publisher FROM books WHERE publisher IS NOT NULL AND publisher != '' ORDER BY publisher",
    )?;
    let rows = stmt.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

pub fn reading_status_counts(conn: &Connection) -> anyhow::Result<Vec<(ReadingStatus, i64)>> {
    let mut stmt = conn.prepare("SELECT reading_status, COUNT(*) FROM books GROUP BY reading_status")?;
    let counts: std::collections::HashMap<String, i64> =
        stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))?.collect::<Result<_, _>>()?;

    // Every status is always returned, even with a zero count, so the sidebar can render a stable
    // Unread/Reading/Finished list without special-casing missing entries.
    Ok(ReadingStatus::all()
        .into_iter()
        .map(|status| (status, counts.get(status.as_str()).copied().unwrap_or(0)))
        .collect())
}
