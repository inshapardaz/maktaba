//! Connection pool + schema management. Mirrors MaktabaDbContext/MaktabaDbContextFactory.cs and
//! LibraryService's EnsureCurrentSchemaAsync. No migrations here either (matching the C# side's
//! documented "no EF Core migrations" convention) - `ensure_schema` just creates tables that don't
//! exist yet, and `SCHEMA_VERSION` bump + `is_current_schema` below trigger a wipe-and-rebuild
//! (via a rescan) when they detect a stale/foreign database, exactly like the C# version did for
//! its own past schema-breaking changes. This also transparently handles a metadata.db left behind
//! by the old .NET backend: its schema doesn't match this one, so it's treated the same as "stale"
//! and rebuilt from the on-disk library layout.

use std::path::Path;

/// Bumped whenever the schema changes in a way existing databases can't tolerate; `is_current_schema`
/// checks this marker to decide whether to wipe and rebuild.
const SCHEMA_VERSION: i64 = 1;

/// Opens a connection to the current library's database, matching MaktabaDbContextFactory's
/// "fresh context per request scope" pattern - cheap enough for a local single-user desktop app
/// that this isn't worth pooling.
pub fn open_connection(db_path: &Path) -> anyhow::Result<rusqlite::Connection> {
    let conn = rusqlite::Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

pub fn ensure_schema(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS books (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            title          TEXT NOT NULL,
            sort_title     TEXT NOT NULL,
            description    TEXT,
            language       TEXT,
            publisher      TEXT,
            date_published TEXT,
            date_added     TEXT NOT NULL,
            rating         INTEGER NOT NULL DEFAULT 0,
            reading_status TEXT NOT NULL DEFAULT 'Unread',
            folder_path    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_books_sort_title ON books(sort_title);

        CREATE TABLE IF NOT EXISTS authors (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT NOT NULL,
            sort_name TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_authors_name ON authors(name);

        CREATE TABLE IF NOT EXISTS series (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS collections (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS book_authors (
            book_id   INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            author_id INTEGER NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
            "order"   INTEGER NOT NULL,
            PRIMARY KEY (book_id, author_id)
        );

        CREATE TABLE IF NOT EXISTS book_series (
            book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            series_id    INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
            series_index REAL NOT NULL,
            PRIMARY KEY (book_id, series_id)
        );

        CREATE TABLE IF NOT EXISTS book_tags (
            book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
            PRIMARY KEY (book_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS book_collections (
            book_id       INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
            PRIMARY KEY (book_id, collection_id)
        );

        CREATE TABLE IF NOT EXISTS book_files (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id         INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            format          TEXT NOT NULL,
            file_path       TEXT NOT NULL,
            file_size_bytes INTEGER NOT NULL,
            content_hash    TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_book_files_book_id ON book_files(book_id);
        CREATE INDEX IF NOT EXISTS ix_book_files_content_hash ON book_files(content_hash);

        CREATE TABLE IF NOT EXISTS identifiers (
            id      INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            scheme  TEXT NOT NULL,
            value   TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_identifiers_book_id ON identifiers(book_id);

        CREATE TABLE IF NOT EXISTS bookmarks (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            client_id  TEXT NOT NULL UNIQUE,
            chapter_id TEXT NOT NULL,
            position   REAL NOT NULL,
            name       TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_bookmarks_book_id ON bookmarks(book_id);

        CREATE TABLE IF NOT EXISTS notes (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
            client_id    TEXT NOT NULL UNIQUE,
            chapter_id   TEXT NOT NULL,
            start_offset INTEGER NOT NULL,
            end_offset   INTEGER NOT NULL,
            text         TEXT NOT NULL,
            comment      TEXT,
            created_at   TEXT NOT NULL,
            updated_at   TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_notes_book_id ON notes(book_id);

        CREATE TABLE IF NOT EXISTS reading_progress (
            book_id         INTEGER PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
            current_chapter INTEGER NOT NULL,
            total_chapters  INTEGER NOT NULL,
            current_page    INTEGER NOT NULL,
            total_pages     INTEGER NOT NULL,
            chapter_title   TEXT,
            percentage      REAL NOT NULL,
            chapter_id      TEXT,
            position        REAL,
            updated_at      TEXT NOT NULL
        );
        "#,
    )?;

    conn.execute(
        "INSERT INTO schema_meta(key, value) VALUES ('version', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![SCHEMA_VERSION.to_string()],
    )?;

    Ok(())
}

/// True if `db_path` exists and its schema_meta.version matches `SCHEMA_VERSION` - covers both a
/// database from an older Rust schema revision and one left behind by the previous .NET backend
/// (which has no schema_meta table at all - and since SQLite table names are matched
/// case-insensitively, its PascalCase "Books" etc. tables would otherwise collide with this
/// schema's lowercase "books" under `CREATE TABLE IF NOT EXISTS`, so staleness must be caught and
/// the file wiped *before* `ensure_schema` ever runs against it).
fn is_current_schema(db_path: &Path) -> bool {
    if !db_path.exists() {
        return false;
    }

    let Ok(conn) = rusqlite::Connection::open(db_path) else {
        return false;
    };

    conn.query_row(
        "SELECT value FROM schema_meta WHERE key = 'version'",
        [],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .map(|v| v == SCHEMA_VERSION.to_string())
    .unwrap_or(false)
}

/// Verifies `db_path` matches this schema, transparently wiping and recreating it if not (a
/// metadata.db is a rebuildable cache over the on-disk library layout, never the source of truth -
/// see docs/SPEC.md §4). Returns true if the database was (re)created empty and therefore needs a
/// rescan to repopulate it. Mirrors LibraryService.EnsureCurrentSchemaAsync.
pub fn ensure_current_schema(db_path: &Path) -> anyhow::Result<bool> {
    if is_current_schema(db_path) {
        return Ok(false);
    }

    for suffix in ["", "-wal", "-shm", "-journal"] {
        let path = if suffix.is_empty() {
            db_path.to_path_buf()
        } else {
            let mut s = db_path.as_os_str().to_os_string();
            s.push(suffix);
            std::path::PathBuf::from(s)
        };
        if path.exists() {
            std::fs::remove_file(&path)?;
        }
    }

    let conn = rusqlite::Connection::open(db_path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    ensure_schema(&conn)?;

    Ok(true)
}
