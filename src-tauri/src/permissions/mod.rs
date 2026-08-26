//! Approval broker. Every sensitive action routes through here.
//!
//! Examples: "clear all history", "wipe site logins". The broker
//! renders a consistent approval UI and records the user's decision.
//!
//! Not yet implemented — today the few destructive actions confirm
//! inline (see the clear-data button in the profile menu).
