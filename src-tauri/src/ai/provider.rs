//! The `Provider` trait. Every inference call in Null goes through it.
//!
//! Implementations must declare whether they run locally or over the
//! network — the router uses this to decide whether a call needs
//! user approval via the permission broker.
