//! Numbered migrations. One rule: never rewrite a past migration.
//!
//! `run` compares the DB's `user_version` pragma against the latest
//! migration and applies everything in between. To add a migration,
//! bump [`LATEST`], append a new `MIGRATION_N` constant, and extend
//! the match in [`run`].

use rusqlite::Connection;

const LATEST: i64 = 9;

pub fn run(conn: &mut Connection) -> rusqlite::Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    for version in (current + 1)..=LATEST {
        let sql = match version {
            1 => MIGRATION_001,
            2 => MIGRATION_002,
            3 => MIGRATION_003,
            4 => MIGRATION_004,
            5 => MIGRATION_005,
            6 => MIGRATION_006,
            7 => MIGRATION_007,
            8 => MIGRATION_008,
            9 => MIGRATION_009,
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

const MIGRATION_002: &str = r#"
    ALTER TABLE bookmarks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

    UPDATE bookmarks SET position = (
        SELECT COUNT(*) FROM bookmarks b2
        WHERE b2.created_at < bookmarks.created_at
           OR (b2.created_at = bookmarks.created_at AND b2.id < bookmarks.id)
    );

    CREATE INDEX bookmarks_position_idx ON bookmarks (position);
"#;

const MIGRATION_003: &str = r#"
    CREATE TABLE blocked_origins (
        origin     TEXT    PRIMARY KEY,
        created_at INTEGER NOT NULL
    );
"#;

const MIGRATION_004: &str = r#"
    CREATE TABLE artifacts (
        id           INTEGER PRIMARY KEY,
        kind         TEXT    NOT NULL,
        title        TEXT    NOT NULL,
        source_url   TEXT    NOT NULL,
        source_title TEXT,
        markdown     TEXT    NOT NULL,
        model        TEXT    NOT NULL,
        created_at   INTEGER NOT NULL
    );

    CREATE INDEX artifacts_created_at_idx ON artifacts (created_at DESC);
    CREATE INDEX artifacts_source_url_idx ON artifacts (source_url);
"#;

const MIGRATION_005: &str = r#"
    CREATE TABLE conversations (
        id           INTEGER PRIMARY KEY,
        title        TEXT    NOT NULL,
        page_url     TEXT,
        page_title   TEXT,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
    );

    CREATE INDEX conversations_updated_idx ON conversations (updated_at DESC);

    CREATE TABLE messages (
        id              INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT    NOT NULL CHECK (role IN ('user', 'assistant')),
        content         TEXT    NOT NULL,
        provider        TEXT,
        model           TEXT,
        created_at      INTEGER NOT NULL
    );

    CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
"#;

/// Null dropped its AI layer: inference never happens in the browser,
/// so chat conversations no longer exist. Clips gained a `file_path`
/// pointing at their markdown mirror in the user's notes directory.
///
/// Dropping `conversations`/`messages` deletes locally-stored chat
/// history — the app never had a copy anywhere else, and keeping dead
/// tables around would misrepresent what Null stores.
const MIGRATION_006: &str = r#"
    DROP TABLE IF EXISTS messages;
    DROP TABLE IF EXISTS conversations;

    ALTER TABLE artifacts ADD COLUMN file_path TEXT;
"#;

/// Favicons, keyed by origin so one row serves the tab list, the
/// bookmark tiles, and anything else that shows a site. `data` is a
/// `data:image/png;base64,` URL that already passed the Rust-side
/// validation in `favicons::ingest` — nothing else may write here.
/// What this stores: a 64px icon per visited origin, locally. What it
/// transmits: nothing. What it remembers: which origins were visited —
/// same sensitivity class as `history`, so clearing history clears it
/// too, except icons for currently-pinned origins: a bookmark already
/// records its origin durably, so keeping its icon discloses nothing
/// (see `clear_history`).
const MIGRATION_007: &str = r#"
    CREATE TABLE favicons (
        origin      TEXT    PRIMARY KEY,
        data        TEXT    NOT NULL,
        updated_at  INTEGER NOT NULL
    );
"#;

/// Bookmark folders: one level of nesting, iOS-style. A folder is a
/// bookmarks row with `kind = 'folder'` and an empty URL; its members
/// point at it via `parent_id`. Deleting a folder re-roots its members
/// (handled in `remove_bookmark`) — a folder is arrangement, never a
/// place data can be lost in.
const MIGRATION_008: &str = r#"
    ALTER TABLE bookmarks ADD COLUMN kind TEXT NOT NULL DEFAULT 'bookmark';
    ALTER TABLE bookmarks ADD COLUMN parent_id INTEGER REFERENCES bookmarks(id);
"#;

/// Notes gained read-direction sync (external edits to the file mirror
/// are adopted on open). `updated_at` records the last time Null itself
/// wrote the row, so sync can tell an external edit (file newer) from a
/// stale mirror left behind by a failed write (file older) — adopting
/// the latter would silently revert the user's newer note. Backfilled
/// to `created_at`: existing mirrors were written at creation.
const MIGRATION_009: &str = r#"
    ALTER TABLE artifacts ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
    UPDATE artifacts SET updated_at = created_at;
"#;
