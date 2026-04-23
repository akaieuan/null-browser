//! Tauri IPC commands, grouped by domain.
//!
//! Every command that the frontend can invoke lives under this module.
//! One file per domain so the full IPC surface is auditable at a glance.

pub mod ai;
pub mod bookmarks;
pub mod history;
pub mod meta;
pub mod network;
pub mod tabs;
