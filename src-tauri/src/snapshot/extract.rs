//! Turning a downloaded archive into a directory tree, defensively.
//!
//! Host archives (GitHub tarball, GitLab archive) wrap everything in one
//! top-level directory named after the repo and commit — `acme-widget-a1b2c3/`
//! — which is stripped so snapshot paths match repository paths, and a diff's
//! `src/lib/api.ts` maps straight onto a file on disk.
//!
//! Every entry is untrusted. Three separate limits apply, because a size cap on
//! the compressed download says nothing about what it expands to: total bytes
//! written, number of entries, and per-path validation via `store::safe_join`.
//! Only regular files are materialised — symlinks and hardlinks are skipped
//! outright rather than resolved, since a link is the cheapest way to point a
//! later write outside the tree, and no review surface needs them.
//!
//! Errors abort the whole extraction: a partially written snapshot that looks
//! complete would silently serve wrong file contents, which is worse than
//! having no snapshot at all.

use std::fs;
use std::io::Read;
use std::path::{Component, Path};

use flate2::read::GzDecoder;

use super::store::safe_join;

pub const MAX_EXTRACTED_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 200_000;

#[derive(Debug, PartialEq, Eq)]
pub struct ExtractStats {
    pub files: usize,
    pub bytes: u64,
}

/// Drops the archive's single top-level directory.
///
/// `Ok(None)` is the benign skip — the entry *is* the root directory and has
/// nothing under it. An `Err` means the path was hostile rather than merely
/// uninteresting, and the distinction matters: an archive containing a
/// traversal entry is not one to extract the rest of.
fn strip_root(path: &Path) -> Result<Option<String>, String> {
    let hostile = || format!("archive entry escapes the snapshot: {}", path.display());
    let mut components = path.components();
    match components.next() {
        Some(Component::Normal(_)) => {}
        None => return Ok(None),
        _ => return Err(hostile()),
    }
    let mut rest: Vec<String> = Vec::new();
    for component in components {
        match component {
            Component::Normal(part) => rest.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            _ => return Err(hostile()),
        }
    }
    if rest.is_empty() {
        return Ok(None);
    }
    Ok(Some(rest.join("/")))
}

/// Extracts a gzipped tar into `dest`, which must already exist.
pub fn extract_tar_gz(archive: &[u8], dest: &Path) -> Result<ExtractStats, String> {
    let mut tar = tar::Archive::new(GzDecoder::new(archive));
    let entries = tar
        .entries()
        .map_err(|e| format!("could not read archive: {e}"))?;

    let mut stats = ExtractStats { files: 0, bytes: 0 };
    for entry in entries {
        let mut entry = entry.map_err(|e| format!("could not read archive entry: {e}"))?;
        if !entry.header().entry_type().is_file() {
            continue;
        }
        if stats.files >= MAX_ENTRIES {
            return Err("archive has too many files".to_string());
        }
        let raw = entry
            .path()
            .map_err(|e| format!("could not read archive entry path: {e}"))?
            .into_owned();
        let Some(relative) = strip_root(&raw)? else {
            continue;
        };
        let Some(target) = safe_join(dest, &relative) else {
            return Err(format!("archive entry escapes the snapshot: {relative}"));
        };

        let size = entry.header().size().unwrap_or(0);
        if stats.bytes + size > MAX_EXTRACTED_BYTES {
            return Err("archive expands to too much data".to_string());
        }

        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("could not create snapshot directory: {e}"))?;
        }
        let mut buf: Vec<u8> = Vec::with_capacity(size as usize);
        entry
            .read_to_end(&mut buf)
            .map_err(|e| format!("could not read archive entry: {e}"))?;
        fs::write(&target, &buf).map_err(|e| format!("could not write snapshot file: {e}"))?;

        stats.files += 1;
        stats.bytes += buf.len() as u64;
    }
    Ok(stats)
}

#[cfg(test)]
#[path = "extract_tests.rs"]
mod tests;
