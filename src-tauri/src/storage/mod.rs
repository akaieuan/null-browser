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
}

/// A chat thread. Optionally pinned to a page (URL + title captured at
/// the start of the conversation). All turns of the chat live in
/// `messages` and reference this row via `conversation_id`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Conversation {
    pub id: i64,
    pub title: String,
    pub page_url: Option<String>,
    pub page_title: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// One turn in a chat thread. Provider/model recorded so the user can
/// see — when scrolling back — which model gave each answer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: i64,
    pub conversation_id: i64,
    pub role: String,
    pub content: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub created_at: i64,
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
            "SELECT id, url, title, created_at FROM bookmarks ORDER BY position ASC, id ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Bookmark {
                id: row.get(0)?,
                url: row.get(1)?,
                title: row.get(2)?,
                created_at: row.get(3)?,
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
        })
    }

    pub fn remove_bookmark(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM bookmarks WHERE id = ?1", params![id])?;
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

    pub fn remove_bookmark_by_url(&self, url: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute("DELETE FROM bookmarks WHERE url = ?1", params![url])?;
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
        Ok(())
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
            "INSERT INTO artifacts (kind, title, source_url, source_title, markdown, model, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
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
        })
    }

    pub fn list_artifacts(&self) -> rusqlite::Result<Vec<Artifact>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, kind, title, source_url, source_title, markdown, model, created_at \
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
            })
        })?;
        rows.collect()
    }

    pub fn get_artifact(&self, id: i64) -> rusqlite::Result<Artifact> {
        let conn = self.conn();
        conn.query_row(
            "SELECT id, kind, title, source_url, source_title, markdown, model, created_at \
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

    // -------------------------------------------------------------- chats

    pub fn create_conversation(
        &self,
        title: &str,
        page_url: Option<&str>,
        page_title: Option<&str>,
    ) -> rusqlite::Result<Conversation> {
        let conn = self.conn();
        let now = now_unix();
        conn.execute(
            "INSERT INTO conversations (title, page_url, page_title, created_at, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?4)",
            params![title, page_url, page_title, now],
        )?;
        Ok(Conversation {
            id: conn.last_insert_rowid(),
            title: title.to_string(),
            page_url: page_url.map(|s| s.to_string()),
            page_title: page_title.map(|s| s.to_string()),
            created_at: now,
            updated_at: now,
        })
    }

    pub fn list_conversations(&self) -> rusqlite::Result<Vec<Conversation>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, title, page_url, page_title, created_at, updated_at \
             FROM conversations ORDER BY updated_at DESC, id DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(Conversation {
                id: row.get(0)?,
                title: row.get(1)?,
                page_url: row.get(2)?,
                page_title: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        rows.collect()
    }

    pub fn get_conversation(&self, id: i64) -> rusqlite::Result<Conversation> {
        let conn = self.conn();
        conn.query_row(
            "SELECT id, title, page_url, page_title, created_at, updated_at \
             FROM conversations WHERE id = ?1",
            params![id],
            |row| {
                Ok(Conversation {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    page_url: row.get(2)?,
                    page_title: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            },
        )
    }

    pub fn rename_conversation(&self, id: i64, title: &str) -> rusqlite::Result<()> {
        let conn = self.conn();
        conn.execute(
            "UPDATE conversations SET title = ?1, updated_at = ?2 WHERE id = ?3",
            params![title, now_unix(), id],
        )?;
        Ok(())
    }

    pub fn delete_conversation(&self, id: i64) -> rusqlite::Result<()> {
        let conn = self.conn();
        // FK ON DELETE CASCADE drops messages too — but rusqlite ships
        // with foreign_keys OFF by default. Belt-and-braces: drop
        // messages first, then the row, in one transaction.
        let mut conn = conn;
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM messages WHERE conversation_id = ?1",
            params![id],
        )?;
        tx.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        tx.commit()
    }

    pub fn list_messages(&self, conversation_id: i64) -> rusqlite::Result<Vec<ChatMessage>> {
        let conn = self.conn();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, role, content, provider, model, created_at \
             FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC, id ASC",
        )?;
        let rows = stmt.query_map(params![conversation_id], |row| {
            Ok(ChatMessage {
                id: row.get(0)?,
                conversation_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                provider: row.get(4)?,
                model: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?;
        rows.collect()
    }

    pub fn append_message(
        &self,
        conversation_id: i64,
        role: &str,
        content: &str,
        provider: Option<&str>,
        model: Option<&str>,
    ) -> rusqlite::Result<ChatMessage> {
        let mut conn = self.conn();
        let now = now_unix();
        let tx = conn.transaction()?;
        tx.execute(
            "INSERT INTO messages (conversation_id, role, content, provider, model, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![conversation_id, role, content, provider, model, now],
        )?;
        let id = tx.last_insert_rowid();
        tx.execute(
            "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
            params![now, conversation_id],
        )?;
        tx.commit()?;
        Ok(ChatMessage {
            id,
            conversation_id,
            role: role.to_string(),
            content: content.to_string(),
            provider: provider.map(|s| s.to_string()),
            model: model.map(|s| s.to_string()),
            created_at: now,
        })
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn db_path() -> PathBuf {
    ProjectDirs::from("sh", "null", "browser")
        .expect("no home directory available")
        .data_dir()
        .join("null.db")
}
