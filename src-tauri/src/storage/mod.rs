//! SQLite schema, migrations, and queries.
//!
//! One connection per process, opened against the user's data dir
//! (resolved via the `directories` crate). Every schema change goes
//! through a numbered migration in [`migrations`].

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use directories::ProjectDirs;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

mod migrations;

/// A bookmark as stored in SQLite and exposed to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Bookmark {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub created_at: i64,
    /// `"bookmark"` or `"folder"`. A folder has an empty URL.
    pub kind: String,
    /// The folder this row lives in; `None` at the top level.
    pub parent_id: Option<i64>,
}

/// One visit in the local history.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub url: String,
    pub title: String,
    pub visited_at: i64,
}

/// An origin (scheme://host[:port]) the user has chosen to block.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockedOrigin {
    pub origin: String,
    pub created_at: i64,
}

/// One origin's icon: a validated `data:image/png;base64,` URL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Favicon {
    pub origin: String,
    pub data: String,
}

/// One day's tracker-sighting count. `day` is days since the Unix
/// epoch, UTC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrackerDay {
    pub day: i64,
    pub count: i64,
}

/// A saved page summary (or later: other kinds of saved AI outputs).
/// Lives on disk, openable inside the AI drawer next to chat.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Artifact {
    pub id: i64,
    pub kind: String,
    pub title: String,
    pub source_url: String,
    pub source_title: Option<String>,
    pub markdown: String,
    pub model: String,
    pub created_at: i64,
    /// Where this clip's markdown mirror lives on disk. `None` if the
    /// file write failed — the clip is still in SQLite either way.
    pub file_path: Option<String>,
}

/// Owned handle to the single SQLite connection used by the app.
///
/// Managed via Tauri state so command handlers can acquire it with
/// `State<Storage>`. The inner `Mutex` serializes access — rusqlite
/// is not `Sync` on its own.
pub struct Storage {
    conn: Mutex<Connection>,
}

impl Storage {
    /// Open (or create) the database at the user's data dir and run
    /// any pending migrations. Panics on failure — a browser that
    /// cannot persist state shouldn't pretend to.
    pub fn open() -> Self {
        let path = db_path();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).expect("create data dir");
        }
        let mut conn = Connection::open(&path).expect("open sqlite db");
        migrations::run(&mut conn).expect("run migrations");
        Self {
            conn: Mutex::new(conn),
        }
    }

    /// Borrow the underlying connection. Callers hold the mutex for
    /// the duration of the guard.
    pub fn conn(&self) -> std::sync::MutexGuard<'_, Connection> {
        self.conn.lock().expect("storage mutex poisoned")
    }

    pub fn list_bookmarks(&self) -> rusqlite::Result<Vec<Bookmark>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, url, title, created_at, kind, parent_id FROM bookmarks \
             ORDER BY position ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                url: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
                kind: row.get(4)?,
                parent_id: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_bookmark(&self, url: &str, title: &str) -> rusqlite::Result<Bookmark> {
        let conn = self.conn();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO bookmarks (url, title, created_at, position) \
             VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(position) + 1, 0) FROM bookmarks))",
            params![url, title, now],
        )?;
        Ok(Bookmark {
            id: conn.last_insert_rowid(),
            url: url.to_string(),
            title: title.to_string(),
            created_at: now,
            kind: "bookmark".to_string(),
            parent_id: None,
        })
    }

    pub fn remove_bookmark(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn();
        // Deleting a folder re-roots its members instead of deleting
        // them: a folder is arrangement, not a container data can be
        // lost inside.
        conn.execute(
            "UPDATE bookmarks SET parent_id = NULL WHERE parent_id = ?1",
            params![id],
        )?;
        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
        Ok(())
    }

    /// Drop one bookmark onto another: create a folder at the target's
    /// position holding both. iOS's folder gesture.
    pub fn group_bookmarks(&self, target_id: i64, dragged_id: i64) -> rusqlite::Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        let position: i64 = tx.query_row(
            "SELECT position FROM bookmarks WHERE id = ?1",
            params![target_id],
            |r| r.get(0),
        )?;
        tx.execute(
            "INSERT INTO bookmarks (url, title, created_at, position, kind) \
             VALUES ('', 'Folder', ?1, ?2, 'folder')",
            params![now, position],
        )?;
        let folder = tx.last_insert_rowid();
        tx.execute(
            "UPDATE bookmarks SET parent_id = ?1 WHERE id IN (?2, ?3) AND kind = 'bookmark'",
            params![folder, target_id, dragged_id],
        )?;
        tx.commit()
    }

    /// Move a bookmark into a folder (or back to the top level with
    /// `None`). Folders themselves never nest.
    pub fn move_bookmark(&self, id: i64, parent_id: Option<i64>) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE bookmarks SET parent_id = ?1, \
             position = (SELECT COALESCE(MAX(position) + 1, 0) FROM bookmarks b2 \
                         WHERE b2.parent_id IS ?1) \
             WHERE id = ?2 AND kind = 'bookmark'",
            params![parent_id, id],
        )?;
        // An emptied folder dissolves — an empty tile is furniture.
        conn.execute(
            "DELETE FROM bookmarks WHERE kind = 'folder' \
             AND NOT EXISTS (SELECT 1 FROM bookmarks c WHERE c.parent_id = bookmarks.id)",
            [],
        )?;
        Ok(())
    }

    pub fn update_bookmark(&self, id: i64, url: &str, title: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE bookmarks SET url = ?1, title = ?2 WHERE id = ?3",
            params![url, title, id],
        )?;
        Ok(())
    }

    pub fn reorder_bookmarks(&self, ordered_ids: &[i64]) -> rusqlite::Result<()> {
        let mut conn = self.conn();
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare("UPDATE bookmarks SET position = ?1 WHERE id = ?2")?;
            for (idx, id) in ordered_ids.iter().enumerate() {
                stmt.execute(params![idx as i64, id])?;
            }
        }
        tx.commit()
    }

    pub fn add_history(&self, url: &str, title: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO history (url, title, visited_at) VALUES (?1, ?2, ?3)",
            params![url, title, now],
        )?;
        Ok(())
    }

    pub fn list_history(&self, limit: i64) -> rusqlite::Result<Vec<HistoryEntry>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, url, title, visited_at FROM history ORDER BY visited_at DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(HistoryEntry {
                id: row.get(0)?,
                url: row.get(1)?,
                title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                visited_at: row.get(3)?,
            })
        })?;
        rows.collect()
    }

    pub fn remove_history(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM history WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn clear_history(&self) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM history", [])?;
        // Favicons are which-origins-were-visited data — the same
        // sensitivity class as history, so they go with it. Except the
        // pinned ones: a bookmark already records its origin durably
        // and deliberately, so its icon discloses nothing the pin
        // doesn't — and wiping it just breaks every tile until each
        // site is visited again (which is exactly what happened).
        let mut stmt = conn.prepare("SELECT url FROM bookmarks WHERE kind = 'bookmark'")?;
        let keep: std::collections::HashSet<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .filter_map(|u| {
                tauri::Url::parse(&u)
                    .ok()
                    .map(|p| p.origin().ascii_serialization())
            })
            .collect();
        drop(stmt);
        let mut stmt = conn.prepare("SELECT origin FROM favicons")?;
        let all: Vec<String> = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        for origin in all {
            if !keep.contains(&origin) {
                conn.execute("DELETE FROM favicons WHERE origin = ?1", params![origin])?;
            }
        }
        Ok(())
    }

    /// Upsert one origin's icon. `data` must already have passed
    /// `favicons::ingest` validation — this layer stores, it does not
    /// judge.
    pub fn set_favicon(&self, origin: &str, data: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO favicons (origin, data, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(origin) DO UPDATE SET data = ?2, updated_at = ?3",
            params![origin, data, now],
        )?;
        Ok(())
    }

    pub fn list_favicons(&self) -> rusqlite::Result<Vec<Favicon>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT origin, data FROM favicons")?;
        let rows = stmt.query_map([], |row| {
            Ok(Favicon {
                origin: row.get(0)?,
                data: row.get(1)?,
            })
        })?;
        rows.collect()
    }

    /// Add `n` tracker sightings to a day (UTC). Aggregate only — the
    /// day and a running count, never which tracker or when. Called in
    /// batches, not once per request (see `network::note_tracker_sighting`).
    pub fn add_tracker_sightings(&self, day: i64, n: i64) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO tracker_sightings (day, count) VALUES (?1, ?2)
             ON CONFLICT(day) DO UPDATE SET count = count + ?2",
            params![day, n],
        )?;
        Ok(())
    }

    /// Every day that has a sighting, oldest first. The empty days
    /// between are the graph's business to fill, not the store's.
    pub fn list_tracker_sightings(&self) -> rusqlite::Result<Vec<TrackerDay>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT day, count FROM tracker_sightings ORDER BY day ASC")?;
        let rows = stmt.query_map([], |row| {
            Ok(TrackerDay {
                day: row.get(0)?,
                count: row.get(1)?,
            })
        })?;
        rows.collect()
    }

    pub fn add_blocked_origin(&self, origin: &str) -> rusqlite::Result<BlockedOrigin> {
        let conn = self.conn();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT OR IGNORE INTO blocked_origins (origin, created_at) VALUES (?1, ?2)",
            params![origin, now],
        )?;
        Ok(BlockedOrigin {
            origin: origin.to_string(),
            created_at: now,
        })
    }

    pub fn remove_blocked_origin(&self, origin: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute(
            "DELETE FROM blocked_origins WHERE origin = ?1",
            params![origin],
        )?;
        Ok(())
    }

    pub fn list_blocked_origins(&self) -> rusqlite::Result<Vec<BlockedOrigin>> {
        let conn = self.conn();
        let mut stmt = conn
            .prepare("SELECT origin, created_at FROM blocked_origins ORDER BY created_at DESC")?;
        let rows = stmt.query_map([], |row| {
            Ok(BlockedOrigin {
                origin: row.get(0)?,
                created_at: row.get(1)?,
            })
        })?;
        rows.collect()
    }

    pub fn is_origin_blocked(&self, origin: &str) -> rusqlite::Result<bool> {
        let conn = self.conn();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM blocked_origins WHERE origin = ?1",
            params![origin],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    pub fn insert_artifact(
        &self,
        kind: &str,
        title: &str,
        source_url: &str,
        source_title: Option<&str>,
        markdown: &str,
        model: &str,
    ) -> rusqlite::Result<Artifact> {
        let conn = self.conn();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "INSERT INTO artifacts (kind, title, source_url, source_title, markdown, model, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![kind, title, source_url, source_title, markdown, model, now],
        )?;
        Ok(Artifact {
            id: conn.last_insert_rowid(),
            kind: kind.to_string(),
            title: title.to_string(),
            source_url: source_url.to_string(),
            source_title: source_title.map(|s| s.to_string()),
            markdown: markdown.to_string(),
            model: model.to_string(),
            created_at: now,
            file_path: None,
        })
    }

    /// Record where a clip's markdown mirror was written.
    pub fn set_artifact_file_path(&self, id: i64, path: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE artifacts SET file_path = ?1 WHERE id = ?2",
            params![path, id],
        )?;
        Ok(())
    }

    /// Every artifact that is an exact duplicate (same kind, title,
    /// source and body) of a *newer* one. Used by the startup cleanup;
    /// the newest copy of each group is never in this list. Title is
    /// part of the match on purpose: sync_from_disk can make two notes'
    /// bodies converge, and a looser match would let dedupe eat a note
    /// the user deliberately kept under its own name.
    pub fn duplicate_artifacts(&self) -> rusqlite::Result<Vec<Artifact>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, kind, title, source_url, source_title, markdown, model,
                    created_at, file_path
             FROM artifacts a
             WHERE EXISTS (
               SELECT 1 FROM artifacts b
               WHERE b.kind = a.kind AND b.source_url = a.source_url
                 AND b.title = a.title
                 AND b.markdown = a.markdown AND b.id > a.id
             )",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Artifact {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                source_url: row.get(3)?,
                source_title: row.get(4)?,
                markdown: row.get(5)?,
                model: row.get(6)?,
                created_at: row.get(7)?,
                file_path: row.get(8)?,
            })
        })?;
        rows.collect()
    }

    /// An existing artifact with this exact kind, source and body, if
    /// one exists. Newest wins so a re-save surfaces the most recent
    /// identical capture.
    pub fn find_identical_artifact(
        &self,
        kind: &str,
        source_url: &str,
        markdown: &str,
    ) -> rusqlite::Result<Option<i64>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id FROM artifacts
             WHERE kind = ?1 AND source_url = ?2 AND markdown = ?3
             ORDER BY id DESC LIMIT 1",
        )?;
        let mut rows = stmt.query_map(params![kind, source_url, markdown], |row| row.get(0))?;
        rows.next().transpose()
    }

    pub fn list_artifacts(&self) -> rusqlite::Result<Vec<Artifact>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, kind, title, source_url, source_title, markdown, model, created_at, file_path \
             FROM artifacts ORDER BY created_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Artifact {
                id: row.get(0)?,
                kind: row.get(1)?,
                title: row.get(2)?,
                source_url: row.get(3)?,
                source_title: row.get(4)?,
                markdown: row.get(5)?,
                model: row.get(6)?,
                created_at: row.get(7)?,
                file_path: row.get(8)?,
            })
        })?;
        rows.collect()
    }

    /// Rewrite a note's title and body. The file mirror is the
    /// caller's job (commands::artifacts), because it owns the
    /// old-path/new-path dance.
    pub fn update_artifact(&self, id: i64, title: &str, markdown: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        conn.execute(
            "UPDATE artifacts SET title = ?1, markdown = ?2, updated_at = ?3 WHERE id = ?4",
            params![title, markdown, now, id],
        )?;
        Ok(())
    }

    /// When Null itself last wrote this row — the freshness bar a file
    /// mirror must clear before `notes::sync_from_disk` adopts it.
    pub fn artifact_updated_at(&self, id: i64) -> rusqlite::Result<i64> {
        let conn = self.conn();
        conn.query_row(
            "SELECT updated_at FROM artifacts WHERE id = ?1",
            params![id],
            |row| row.get(0),
        )
    }

    pub fn get_artifact(&self, id: i64) -> rusqlite::Result<Artifact> {
        let conn = self.conn();
        conn.query_row(
            "SELECT id, kind, title, source_url, source_title, markdown, model, created_at, file_path \
             FROM artifacts WHERE id = ?1",
            params![id],
            |row| {
                Ok(Artifact {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    title: row.get(2)?,
                    source_url: row.get(3)?,
                    source_title: row.get(4)?,
                    markdown: row.get(5)?,
                    model: row.get(6)?,
                    created_at: row.get(7)?,
                    file_path: row.get(8)?,
                })
            },
        )
    }

    pub fn delete_artifact(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM artifacts WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn();
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn set_setting(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) \
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    pub fn delete_setting(&self, key: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])?;
        Ok(())
    }
}

fn db_path() -> PathBuf {
    ProjectDirs::from("sh", "null", "browser")
        .expect("no home directory available")
        .data_dir()
        .join("null.db")
}
