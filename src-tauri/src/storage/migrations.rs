//! Numbered migrations. One rule: never rewrite a past migration.
//!
//! `run` compares the DB's `user_version` pragma against the latest
//! migration and applies everything in between. To add a migration,
//! bump [`LATEST`], append a new `MIGRATION_N` constant, and extend
//! the match in [`run`].

use rusqlite::Connection;

const LATEST: i64 = 1;

pub fn run(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for version in (current + 1)..=LATEST {
        let sql = match version {
            1 => MIGRATION_001,
            _ => unreachable!("no migration defined for version {version}"),
        };
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }
    Ok(())
}

const MIGRATION_001: &str = r#"
    CREATE TABLE bookmarks (
        id         INTEGER PRIMARY KEY,
        url        TEXT    NOT NULL,
        title      TEXT    NOT NULL,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX bookmarks_url_idx ON bookmarks (url);

    CREATE TABLE history (
        id         INTEGER PRIMARY KEY,
        url        TEXT    NOT NULL,
        title      TEXT,
        visited_at INTEGER NOT NULL
    );

    CREATE INDEX history_visited_at_idx ON history (visited_at);

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
"#;
