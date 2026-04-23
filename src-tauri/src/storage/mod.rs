//! SQLite schema, migrations, and queries.
//!
//! One connection per process, opened against the user's data dir
//! (resolved via the `directories` crate). Every schema change goes
//! through a numbered migration.
