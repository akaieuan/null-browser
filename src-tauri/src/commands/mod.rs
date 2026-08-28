//! Tauri IPC commands, grouped by domain.
//!
//! Every command that the frontend can invoke lives under this module.
//! One file per domain so the full IPC surface is auditable at a glance.
//!
//! **Every command is shell-only.** The primary guard is the ACL
//! capability in `capabilities/default.json` (`webviews: ["main"]`),
//! which makes the Tauri runtime reject a `tab-*`/`popup-*` caller before
//! a command body runs. Each command *also* opens with a `Webview`-label
//! check ([`ensure_shell`] / [`is_shell_label`]) as defence in depth: the
//! body still refuses page content even if a future capability edit
//! widened that scope by mistake. See docs/SECURITY.md.

pub mod artifacts;
pub mod bookmarks;
pub mod favicons;
pub mod history;
pub mod meta;
pub mod network;
pub mod search;
pub mod tabs;

/// Label of the one webview allowed to call Null's IPC: the React shell.
/// Page content lives in `tab-*` and `popup-*` webviews, which must never
/// reach these commands.
pub const SHELL_LABEL: &str = "main";

/// Whether `label` names the privileged shell webview. Exact match only —
/// `main-2`, `tab-…`, `popup-…` are all page-trust webviews.
pub fn is_shell_label(label: &str) -> bool {
    label == SHELL_LABEL
}

/// Reject IPC from a webview whose label isn't the shell's.
///
/// The [`ensure_shell`] wrapper is what commands normally call; this
/// label form exists for `show_bookmark_menu`, which is handed a
/// `WebviewWindow` (no `Deref` to `Webview`) rather than a `Webview`.
pub fn ensure_shell_label(label: &str) -> Result<(), String> {
    if is_shell_label(label) {
        Ok(())
    } else {
        Err("denied: this command is not available to page content".to_string())
    }
}

/// Reject IPC that did not originate in the shell webview.
///
/// Used as the first line of every `Result`-returning command. Commands
/// with a non-`Result` return type inline the [`is_shell_label`] check and
/// return a safe empty value instead.
pub fn ensure_shell<R: tauri::Runtime>(webview: &tauri::Webview<R>) -> Result<(), String> {
    ensure_shell_label(webview.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_exact_shell_label_is_privileged() {
        assert!(is_shell_label("main"));
        // Everything a page runs in is denied.
        assert!(!is_shell_label("tab-9f3c-1"));
        assert!(!is_shell_label("popup-0"));
        // No prefix/substring escape hatch.
        assert!(!is_shell_label("main-2"));
        assert!(!is_shell_label("notmain"));
        assert!(!is_shell_label(""));
    }
}
