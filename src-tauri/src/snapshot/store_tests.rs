use super::*;
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

struct TempRoot(PathBuf);

impl TempRoot {
    fn new(label: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "prflow-snapshot-{label}-{}-{n}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("temp root");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn key(sha: &str) -> SnapshotKey {
    SnapshotKey {
        host: "https://github.com".to_string(),
        owner: "acme".to_string(),
        repo: "widget-app".to_string(),
        sha: sha.to_string(),
    }
}

fn write(path: &Path, contents: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("parent dir");
    }
    fs::write(path, contents).expect("write file");
}

/// Snapshots are evicted oldest-mtime-first, so the eviction tests need
/// distinguishable timestamps. Rather than set mtimes by hand — `futimens` on a
/// directory handle is not portable — separate the writes in real time; every
/// filesystem the app targets resolves far finer than this.
fn settle() {
    std::thread::sleep(std::time::Duration::from_millis(20));
}

fn promote_snapshot(root: &Path, sha: &str, contents: &str) {
    let k = key(sha);
    write(&partial_dir(root, &k).join("f.txt"), contents);
    promote(root, &k).expect("promote");
    settle();
}

#[test]
fn safe_join_rejects_traversal_and_absolute_paths() {
    let base = Path::new("/cache/snapshots/gh/acme__widget/abc");
    assert_eq!(safe_join(base, "../../../etc/passwd"), None);
    assert_eq!(safe_join(base, "src/../../escape.rs"), None);
    assert_eq!(safe_join(base, "/etc/passwd"), None);
    assert_eq!(safe_join(base, ".."), None);
    assert_eq!(safe_join(base, ""), None);
    assert_eq!(safe_join(base, "."), None);
}

#[test]
fn safe_join_accepts_plain_relative_entries() {
    let base = Path::new("/cache/snap");
    assert_eq!(
        safe_join(base, "src/lib/api.ts"),
        Some(PathBuf::from("/cache/snap/src/lib/api.ts"))
    );
    assert_eq!(
        safe_join(base, "./README.md"),
        Some(PathBuf::from("/cache/snap/README.md"))
    );
}

#[test]
fn host_is_part_of_the_key_so_same_repo_on_two_hosts_does_not_collide() {
    let root = Path::new("/cache");
    let gh = key("abc");
    let gl = SnapshotKey {
        host: "https://gitlab.acme.dev".to_string(),
        ..key("abc")
    };
    assert_ne!(snapshot_dir(root, &gh), snapshot_dir(root, &gl));
}

#[test]
fn path_segments_are_sanitized() {
    let root = Path::new("/cache");
    let nasty = SnapshotKey {
        host: "https://github.com".to_string(),
        owner: "..".to_string(),
        repo: "group/sub".to_string(),
        sha: "a/b".to_string(),
    };
    let dir = snapshot_dir(root, &nasty);
    assert!(dir.starts_with("/cache/snapshots"));
    assert!(!dir.to_string_lossy().contains(".."));
    assert!(dir.ends_with("a_b"));
}

#[test]
fn read_file_misses_until_the_snapshot_is_promoted() {
    let root = TempRoot::new("read");
    let k = key("abc123");

    assert_eq!(read_file(root.path(), &k, "src/main.rs"), None);

    write(
        &partial_dir(root.path(), &k).join("src/main.rs"),
        "fn main() {}",
    );
    assert_eq!(read_file(root.path(), &k, "src/main.rs"), None);
    assert!(!is_ready(root.path(), &k));

    promote(root.path(), &k).expect("promote");
    assert!(is_ready(root.path(), &k));
    assert_eq!(
        read_file(root.path(), &k, "src/main.rs"),
        Some(b"fn main() {}".to_vec())
    );
    assert_eq!(read_file(root.path(), &k, "src/missing.rs"), None);
}

#[test]
fn read_file_refuses_to_escape_the_snapshot() {
    let root = TempRoot::new("escape");
    let k = key("abc123");
    write(&root.path().join("secret.txt"), "top secret");
    write(&partial_dir(root.path(), &k).join("README.md"), "hi");
    promote(root.path(), &k).expect("promote");

    assert_eq!(read_file(root.path(), &k, "../../../../secret.txt"), None);
}

#[test]
fn promote_replaces_an_existing_snapshot_at_the_same_sha() {
    let root = TempRoot::new("replace");
    let k = key("abc123");

    write(&partial_dir(root.path(), &k).join("a.txt"), "first");
    promote(root.path(), &k).expect("first promote");

    write(&partial_dir(root.path(), &k).join("a.txt"), "second");
    promote(root.path(), &k).expect("second promote");

    assert_eq!(
        read_file(root.path(), &k, "a.txt"),
        Some(b"second".to_vec())
    );
    assert_eq!(snapshot_dirs(&repo_dir(root.path(), &k)).len(), 1);
}

#[test]
fn promote_leaves_no_staging_or_discard_residue() {
    let root = TempRoot::new("residue");
    let k = key("abc123");
    write(&partial_dir(root.path(), &k).join("a.txt"), "first");
    promote(root.path(), &k).expect("first promote");
    write(&partial_dir(root.path(), &k).join("a.txt"), "second");
    promote(root.path(), &k).expect("second promote");

    let leftovers: Vec<String> = fs::read_dir(repo_dir(root.path(), &k))
        .expect("repo dir")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".partial") || n.ends_with(".discard"))
        .collect();

    assert!(leftovers.is_empty(), "left behind: {leftovers:?}");
}

#[test]
fn evict_repo_keeps_the_newest_shas() {
    let root = TempRoot::new("evict-repo");
    for sha in ["old", "middle", "newest"] {
        promote_snapshot(root.path(), sha, sha);
    }

    evict_repo(root.path(), &key("newest"), 2);

    assert!(!is_ready(root.path(), &key("old")));
    assert!(is_ready(root.path(), &key("middle")));
    assert!(is_ready(root.path(), &key("newest")));
}

#[test]
fn evict_repo_is_a_noop_under_the_limit() {
    let root = TempRoot::new("evict-noop");
    let k = key("only");
    write(&partial_dir(root.path(), &k).join("f.txt"), "x");
    promote(root.path(), &k).expect("promote");

    evict_repo(root.path(), &k, KEEP_SHAS_PER_REPO);

    assert!(is_ready(root.path(), &k));
}

#[test]
fn evict_global_trims_oldest_first_and_always_keeps_one() {
    let root = TempRoot::new("evict-global");
    for sha in ["old", "middle", "newest"] {
        promote_snapshot(root.path(), sha, &"x".repeat(500));
    }

    evict_global(root.path(), 700);

    assert!(!is_ready(root.path(), &key("old")));
    assert!(!is_ready(root.path(), &key("middle")));
    assert!(is_ready(root.path(), &key("newest")));
}

#[test]
fn evict_global_ignores_a_tree_already_under_the_cap() {
    let root = TempRoot::new("evict-global-noop");
    let k = key("abc");
    write(&partial_dir(root.path(), &k).join("f.txt"), "small");
    promote(root.path(), &k).expect("promote");

    evict_global(root.path(), MAX_CACHE_BYTES);

    assert!(is_ready(root.path(), &k));
}
