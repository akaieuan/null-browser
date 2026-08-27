//! Clips as plain files. Every clip saved in the drawer is also written
//! to `~/Documents/Null/` as a markdown file with YAML front matter, so
//! notes are grep-able, Obsidian-compatible, and usable by any tool
//! without going through the app. SQLite stays the index; the files are
//! the user-facing copy (invariant 5: data lives with the user).
//!
//! What this stores: the clip's title, source URL, and markdown body,
//! on the local disk only. Nothing is transmitted anywhere.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// The notes directory: `<user documents>/Null`. `None` when the
/// platform has no resolvable documents directory (headless CI).
pub fn notes_dir() -> Option<PathBuf> {
    directories::UserDirs::new()
        .and_then(|d| d.document_dir().map(|p| p.to_path_buf()))
        .map(|d| d.join("Null"))
}

/// Reduce a title to a short, filesystem-safe slug.
fn slug(title: &str) -> String {
    let mut out = String::with_capacity(48);
    for c in title.chars() {
        if out.len() >= 48 {
            break;
        }
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
        } else if (c == ' ' || c == '-' || c == '_') && !out.ends_with('-') && !out.is_empty() {
            out.push('-');
        }
    }
    let trimmed = out.trim_matches('-');
    if trimmed.is_empty() {
        "clip".to_string()
    } else {
        trimmed.to_string()
    }
}

fn yaml_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Write one clip to the notes directory. Returns the file path.
/// The id prefix keeps names unique and stable even when two clips
/// share a title.
pub fn write_note(
    id: i64,
    title: &str,
    source_url: &str,
    markdown: &str,
) -> Result<PathBuf, String> {
    let dir = notes_dir().ok_or_else(|| "no documents directory available".to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{id:04}-{}.md", slug(title)));
    fs::write(&path, note_content(title, source_url, markdown)).map_err(|e| e.to_string())?;
    Ok(path)
}

/// The exact bytes [`write_note`] puts on disk. One definition, because
/// [`delete_note`] compares the file against it to decide whether the
/// user has edited the file since — a comparison against a re-derivation
/// would silently rot.
pub fn note_content(title: &str, source_url: &str, markdown: &str) -> String {
    format!(
        "---\ntitle: \"{}\"\nsource: {}\n---\n\n{}\n",
        yaml_escape(title),
        source_url,
        markdown,
    )
}

/// Write a file for every clip that doesn't have one yet. Runs once at
/// startup so clips saved before the notes directory existed converge
/// to the same model as new ones — a clip the user can't find on disk
/// isn't doing what Clips promises.
///
/// Best-effort and quiet: a failure here must never stop the app from
/// starting, and the clip is still safe in SQLite either way.
pub fn backfill(storage: &crate::storage::Storage) {
    let Ok(artifacts) = storage.list_artifacts() else {
        return;
    };
    for a in artifacts.iter().filter(|a| a.file_path.is_none()) {
        if let Ok(path) = write_note(a.id, &a.title, &a.source_url, &a.markdown) {
            let _ = storage.set_artifact_file_path(a.id, &path.to_string_lossy());
        }
    }
}

/// One-time cleanup for notes saved before the duplicate guard existed:
/// exact duplicates (same kind, source, body) of a newer note lose
/// their SQLite row, and their file mirror goes through the same
/// guarded [`delete_note`] as a user delete — so a duplicate's file
/// that was edited externally is kept on disk, exactly like any other
/// edited file. Best-effort and quiet, like [`backfill`].
pub fn dedupe(storage: &crate::storage::Storage) {
    let Ok(dupes) = storage.duplicate_artifacts() else {
        return;
    };
    for a in dupes {
        if storage.delete_artifact(a.id).is_err() {
            continue;
        }
        if let Some(path) = a.file_path {
            let expected = note_content(&a.title, &a.source_url, &a.markdown);
            let _ = delete_note(&path, &expected);
        }
    }
}

/// Undo [`yaml_escape`]: `\"` and `\\` come back as `"` and `\`.
fn yaml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some(n) => out.push(n),
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Tolerant inverse of [`note_content`]: `(title, body)`.
///
/// Splits on the *first* `\n---\n`, so a `---` horizontal rule inside
/// the markdown body never truncates it. A file with no front matter at
/// all is taken whole as the body with no title — the user rewrote the
/// file, and their text matters more than our framing. Unknown front
/// matter keys are ignored, not errors: Obsidian and friends add their
/// own.
pub fn parse_note(content: &str) -> (Option<String>, String) {
    if let Some(rest) = content.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---\n") {
            let front = &rest[..end];
            let body = &rest[end + 5..];
            let body = body.strip_prefix('\n').unwrap_or(body);
            let body = body.strip_suffix('\n').unwrap_or(body).to_string();
            let mut title = None;
            for line in front.lines() {
                if let Some(v) = line.strip_prefix("title: ") {
                    let v = v.trim();
                    let v = v
                        .strip_prefix('"')
                        .and_then(|x| x.strip_suffix('"'))
                        .unwrap_or(v);
                    title = Some(yaml_unescape(v));
                }
            }
            return (title, body);
        }
    }
    let body = content.strip_suffix('\n').unwrap_or(content);
    (None, body.to_string())
}

/// Read-direction sync: adopt external edits to a note's file mirror
/// into SQLite. Runs when a note is opened, not on a watcher — opening
/// is the moment staleness would be visible.
///
/// Returns the refreshed artifact when the file's *values* (title,
/// body) differ from the row's, `None` when there is nothing to adopt:
/// no mirror, a missing file (the user moved or deleted it — their
/// copy, their call), a path outside the notes directory (same
/// containment contract as [`delete_note`]), or a file that differs
/// only in formatting. The comparison is value-space on purpose: a file
/// with extra front-matter keys would never converge byte-for-byte, and
/// re-writing SQLite with identical values on every open is churn.
///
/// The source URL is not adopted from the file — SQLite stays the
/// authority on provenance.
pub fn sync_from_disk(
    storage: &crate::storage::Storage,
    artifact: &crate::storage::Artifact,
) -> Option<crate::storage::Artifact> {
    let path_str = artifact.file_path.as_ref()?;
    let dir = notes_dir()?;
    let path = Path::new(path_str);
    if path.components().any(|c| c == Component::ParentDir) || !path.starts_with(&dir) {
        return None;
    }
    let on_disk = fs::read_to_string(path).ok()?;
    if on_disk == note_content(&artifact.title, &artifact.source_url, &artifact.markdown) {
        return None;
    }
    let (title, markdown) = parse_note(&on_disk);
    let title = title.unwrap_or_else(|| artifact.title.clone());
    if title == artifact.title && markdown == artifact.markdown {
        return None;
    }
    storage
        .update_artifact(artifact.id, &title, &markdown)
        .ok()?;
    storage.get_artifact(artifact.id).ok()
}

/// Remove a note file previously created by [`write_note`]. Refuses
/// paths outside the notes directory — the DB row is the only thing
/// telling us where the file is, and it must not be able to point the
/// delete anywhere else. Missing files are fine (the user may have
/// moved or deleted the note themselves; their copy, their call).
/// `expected` is what Null itself wrote ([`note_content`] of the DB
/// row). If the file on disk no longer matches — the user edited the
/// note in Obsidian, a script rewrote it — the file is *kept*: deleting
/// the row deletes Null's index entry, never someone's edits. That was
/// a real data-loss bug: the note is the product, and an external edit
/// is the strongest possible signal the user values that file.
pub fn delete_note(path: &str, expected: &str) -> Result<(), String> {
    let Some(dir) = notes_dir() else {
        return Ok(());
    };
    let path = Path::new(path);

    // `starts_with` compares path components literally, so
    // `<notes>/../../.ssh/id_rsa` satisfies it. Today nothing can put
    // such a path in the DB — `slug` emits only `[a-z0-9-]` and the file
    // name is `{id}-{slug}.md` — but this function's contract is
    // containment, and containment has to hold without depending on the
    // caller. Reject traversal outright rather than canonicalising: the
    // file may legitimately be missing, and `canonicalize` fails then.
    if path.components().any(|c| c == Component::ParentDir) {
        return Err("note path contains a parent traversal".to_string());
    }
    if !path.starts_with(&dir) {
        return Err("note path outside the notes directory".to_string());
    }
    match fs::read_to_string(path) {
        Ok(on_disk) if on_disk != expected => Ok(()), // edited — keep it
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
        Ok(_) => match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_inverts_note_content() {
        let md = "body line\n\n---\n\nmore after an hr";
        let (title, body) = parse_note(&note_content(
            "A \"quoted\" title",
            "https://example.com/x",
            md,
        ));
        assert_eq!(title.as_deref(), Some("A \"quoted\" title"));
        assert_eq!(body, md);
    }

    #[test]
    fn parse_without_front_matter_takes_whole_body() {
        let (title, body) = parse_note("just text\nsecond line\n");
        assert_eq!(title, None);
        assert_eq!(body, "just text\nsecond line");
    }

    #[test]
    fn parse_unterminated_front_matter_is_body() {
        let (title, body) = parse_note("---\ntitle: \"x\"\nno closer");
        assert_eq!(title, None);
        assert_eq!(body, "---\ntitle: \"x\"\nno closer");
    }

    #[test]
    fn parse_ignores_unknown_front_matter_keys() {
        let (title, body) =
            parse_note("---\ntags: [a, b]\ntitle: \"T\"\naliases: []\n---\n\nbody\n");
        assert_eq!(title.as_deref(), Some("T"));
        assert_eq!(body, "body");
    }

    #[test]
    fn hr_in_body_never_truncates() {
        let md = "before\n\n---\n\nafter";
        let (_, body) = parse_note(&note_content("t", "s", md));
        assert_eq!(body, md);
    }

    #[test]
    fn yaml_escape_round_trips() {
        for s in ["plain", "with \"quotes\"", "back\\slash", "both \\\" mixed"] {
            assert_eq!(yaml_unescape(&yaml_escape(s)), s);
        }
    }
}
