//! Case-insensitive find-or-create lookups shared by import and metadata editing. Mirrors
//! Maktaba.Data/Services/EntityResolvers.cs. Runs against a `rusqlite::Transaction` (or plain
//! `Connection`) so callers control the surrounding transaction boundary.

use maktaba_core::entities::{Author, Series, Tag};
use maktaba_core::naming;
use rusqlite::{Connection, OptionalExtension};

pub fn resolve_authors(conn: &Connection, author_names: &[String]) -> anyhow::Result<Vec<Author>> {
    let mut authors = Vec::new();

    for name in author_names {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }

        let existing = conn
            .query_row(
                "SELECT id, name, sort_name FROM authors WHERE LOWER(name) = LOWER(?1)",
                [trimmed],
                |row| {
                    Ok(Author {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        sort_name: row.get(2)?,
                    })
                },
            )
            .optional()?;

        if let Some(existing) = existing {
            authors.push(existing);
            continue;
        }

        let sort_name = naming::compute_author_sort_name(trimmed);
        conn.execute(
            "INSERT INTO authors(name, sort_name) VALUES (?1, ?2)",
            rusqlite::params![trimmed, sort_name],
        )?;
        let id = conn.last_insert_rowid();
        authors.push(Author { id, name: trimmed.to_string(), sort_name });
    }

    Ok(authors)
}

pub fn resolve_series(conn: &Connection, series_name: Option<&str>) -> anyhow::Result<Option<Series>> {
    let Some(trimmed) = series_name.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(None);
    };

    let existing = conn
        .query_row(
            "SELECT id, name FROM series WHERE LOWER(name) = LOWER(?1)",
            [trimmed],
            |row| Ok(Series { id: row.get(0)?, name: row.get(1)? }),
        )
        .optional()?;

    if let Some(existing) = existing {
        return Ok(Some(existing));
    }

    conn.execute("INSERT INTO series(name) VALUES (?1)", [trimmed])?;
    let id = conn.last_insert_rowid();
    Ok(Some(Series { id, name: trimmed.to_string() }))
}

pub fn resolve_tags(conn: &Connection, tag_names: &[String]) -> anyhow::Result<Vec<Tag>> {
    let mut tags = Vec::new();

    for name in tag_names {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            continue;
        }

        let existing = conn
            .query_row(
                "SELECT id, name FROM tags WHERE LOWER(name) = LOWER(?1)",
                [trimmed],
                |row| Ok(Tag { id: row.get(0)?, name: row.get(1)? }),
            )
            .optional()?;

        if let Some(existing) = existing {
            tags.push(existing);
            continue;
        }

        conn.execute("INSERT INTO tags(name) VALUES (?1)", [trimmed])?;
        let id = conn.last_insert_rowid();
        tags.push(Tag { id, name: trimmed.to_string() });
    }

    Ok(tags)
}
