//! SQLite schema, migrations, and queries.
//!
//! One connection per process, opened against the user's data dir
//! (resolved via the `directories` crate). Every schema change goes
//! through a numbered migration in [`migrations`].

use std::path::PathBuf;
use std::sync::Mutex;

use directories::ProjectDirs;
use rusqlite::Connection;

mod migrations;

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
}

fn db_path() -> PathBuf {
    ProjectDirs::from("sh", "null", "browser")
        .expect("no home directory available")
        .data_dir()
        .join("null.db")
}
