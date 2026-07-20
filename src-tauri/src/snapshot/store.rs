//! On-disk layout for repo snapshots, and the only code allowed to turn an
//! archive entry's path into a real one.
//!
//! Layout under the cache dir: `snapshots/{host}/{owner}__{repo}/{sha}/`. The
//! host is part of the key because the same `owner/repo` exists on github.com
//! and on a self-hosted GitLab, and their trees are unrelated. Path segments
//! are sanitised the same way `commands::cache_path_segment` sanitises JSON
//! cache names — hosts and owners are attacker-influenced strings.
//!
//! Extraction writes to a sibling `{sha}.partial` directory and renames it into
//! place only once complete, so a torn or aborted download can never be read as
//! a finished snapshot: readers look exclusively at `{sha}`.
//!
//! `safe_join` is the security boundary of the whole feature. Archive entries
//! are untrusted: a `../../.ssh/authorized_keys` entry, an absolute path, or a
//! Windows drive prefix must never escape the snapshot directory. Everything
//! that materialises an entry goes through it, and it is fail-closed —
//! anything not a plain relative component returns `None`.
//!
//! Eviction runs on every successful extraction rather than on a timer: keep
//! the newest `keep` SHAs per repo (the current head plus a little history for
//! a force-push or a rebase), then trim oldest-first across all repos until the
//! whole tree fits `max_bytes`.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

pub const KEEP_SHAS_PER_REPO: usize = 2;
pub const MAX_CACHE_BYTES: u64 = 2 * 1024 * 1024 * 1024;

const SNAPSHOTS_DIR: &str = "snapshots";
const PARTIAL_SUFFIX: &str = ".partial";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SnapshotKey {
    pub host: String,
    pub owner: String,
    pub repo: String,
    pub sha: String,
}

fn segment(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('.');
    if trimmed.is_empty() {
        "_".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Directory holding every snapshot of one repo, one subdirectory per SHA.
pub fn repo_dir(root: &Path, key: &SnapshotKey) -> PathBuf {
    root.join(SNAPSHOTS_DIR)
        .join(segment(&key.host))
        .join(format!("{}__{}", segment(&key.owner), segment(&key.repo)))
}

/// Directory a finished snapshot lives in. Its existence means "complete".
pub fn snapshot_dir(root: &Path, key: &SnapshotKey) -> PathBuf {
    repo_dir(root, key).join(segment(&key.sha))
}

/// Staging directory an extraction writes into before the atomic rename.
pub fn partial_dir(root: &Path, key: &SnapshotKey) -> PathBuf {
    repo_dir(root, key).join(format!("{}{PARTIAL_SUFFIX}", segment(&key.sha)))
}

pub fn is_ready(root: &Path, key: &SnapshotKey) -> bool {
    snapshot_dir(root, key).is_dir()
}

/// Resolves an untrusted archive-entry path against `base`, or `None` if it
/// tries to escape. Rejects parent traversal, absolute paths and Windows
/// prefixes; tolerates the `./` segments archives routinely carry.
pub fn safe_join(base: &Path, relative: &str) -> Option<PathBuf> {
    let mut resolved = base.to_path_buf();
    let mut pushed = false;
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(part) => {
                resolved.push(part);
                pushed = true;
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    if pushed {
        Some(resolved)
    } else {
        None
    }
}

/// Reads one file out of a finished snapshot. `None` covers every miss the
/// caller treats identically — no snapshot, not extracted yet, or no such file
/// at this SHA — so callers fall back to the network without branching.
#[allow(dead_code)]
pub fn read_file(root: &Path, key: &SnapshotKey, path: &str) -> Option<Vec<u8>> {
    let base = snapshot_dir(root, key);
    if !base.is_dir() {
        return None;
    }
    let target = safe_join(&base, path)?;
    if !target.is_file() {
        return None;
    }
    fs::read(target).ok()
}

/// Replaces any existing snapshot at `key` with the staged `.partial`
/// directory.
///
/// Re-snapshotting a SHA must not open a window where the reader sees nothing,
/// so an existing tree is moved aside, the staged one renamed into place, and
/// only then is the old tree deleted. If the second rename fails the old tree
/// is put back, leaving the caller exactly where it started rather than with a
/// missing snapshot.
pub fn promote(root: &Path, key: &SnapshotKey) -> Result<(), String> {
    let staged = partial_dir(root, key);
    let final_dir = snapshot_dir(root, key);
    if !staged.is_dir() {
        return Err("snapshot staging directory is missing".to_string());
    }

    let discard = repo_dir(root, key).join(format!("{}.discard", segment(&key.sha)));
    let replacing = final_dir.exists();
    if replacing {
        let _ = fs::remove_dir_all(&discard);
        fs::rename(&final_dir, &discard)
            .map_err(|e| format!("could not replace existing snapshot: {e}"))?;
    }

    let promoted =
        fs::rename(&staged, &final_dir).map_err(|e| format!("could not finish snapshot: {e}"));
    if promoted.is_err() && replacing {
        let _ = fs::rename(&discard, &final_dir);
        return promoted;
    }
    let _ = fs::remove_dir_all(&discard);
    promoted
}

pub fn discard_partial(root: &Path, key: &SnapshotKey) {
    let _ = fs::remove_dir_all(partial_dir(root, key));
}

fn modified_at(path: &Path) -> SystemTime {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH)
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.file_type() {
            Ok(t) if t.is_dir() => dir_size(&entry.path()),
            Ok(t) if t.is_file() => entry.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

fn snapshot_dirs(repo: &Path) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(repo) else {
        return Vec::new();
    };
    entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| !n.ends_with(PARTIAL_SUFFIX) && !n.ends_with(".discard"))
        })
        .collect()
}

fn all_snapshot_dirs(root: &Path) -> Vec<PathBuf> {
    let snapshots = root.join(SNAPSHOTS_DIR);
    let Ok(hosts) = fs::read_dir(&snapshots) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for host in hosts.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
        let Ok(repos) = fs::read_dir(&host) else {
            continue;
        };
        for repo in repos.flatten().map(|e| e.path()).filter(|p| p.is_dir()) {
            out.extend(snapshot_dirs(&repo));
        }
    }
    out
}

fn sort_oldest_first(dirs: &mut [PathBuf]) {
    dirs.sort_by_key(|p| modified_at(p));
}

/// Trims one repo to its newest `keep` snapshots.
pub fn evict_repo(root: &Path, key: &SnapshotKey, keep: usize) {
    let mut dirs = snapshot_dirs(&repo_dir(root, key));
    if dirs.len() <= keep {
        return;
    }
    sort_oldest_first(&mut dirs);
    let excess = dirs.len() - keep;
    for dir in dirs.into_iter().take(excess) {
        let _ = fs::remove_dir_all(dir);
    }
}

/// Trims oldest snapshots across every repo until the tree fits `max_bytes`.
/// The newest snapshot is never removed, so a single repo larger than the cap
/// degrades to "one snapshot" instead of thrashing.
pub fn evict_global(root: &Path, max_bytes: u64) {
    let mut sized: Vec<(PathBuf, u64)> = all_snapshot_dirs(root)
        .into_iter()
        .map(|path| {
            let size = dir_size(&path);
            (path, size)
        })
        .collect();
    let mut total: u64 = sized.iter().map(|(_, size)| size).sum();
    if total <= max_bytes {
        return;
    }
    sized.sort_by_key(|(path, _)| modified_at(path));
    while total > max_bytes && sized.len() > 1 {
        let (victim, size) = sized.remove(0);
        total = total.saturating_sub(size);
        let _ = fs::remove_dir_all(victim);
    }
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod tests;
