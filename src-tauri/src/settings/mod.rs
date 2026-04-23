//! Versioned JSON settings with a migration path from day one.
//!
//! The browser must always be able to read its own older configs.
//! Every schema change bumps the version and ships a migration.
