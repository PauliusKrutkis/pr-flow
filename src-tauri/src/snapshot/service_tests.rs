use super::*;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};

static COUNTER: AtomicU32 = AtomicU32::new(0);

fn temp_root(label: &str) -> PathBuf {
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let path =
        std::env::temp_dir().join(format!("prflow-service-{label}-{}-{n}", std::process::id()));
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(&path).expect("temp root");
    path
}

fn key(sha: &str) -> SnapshotKey {
    SnapshotKey {
        host: "https://github.com".to_string(),
        owner: "acme".to_string(),
        repo: "widget-app".to_string(),
        sha: sha.to_string(),
    }
}

#[test]
fn unknown_keys_start_idle() {
    let root = temp_root("idle");
    assert_eq!(status(&root, &key("never-seen")).state, SnapshotState::Idle);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn a_snapshot_on_disk_reads_as_ready_without_any_registry_entry() {
    let root = temp_root("ready");
    let k = key("on-disk");
    std::fs::create_dir_all(store::partial_dir(&root, &k).join("src")).expect("staging");
    std::fs::write(store::partial_dir(&root, &k).join("src/a.ts"), "x").expect("write");
    store::promote(&root, &k).expect("promote");

    assert_eq!(status(&root, &k).state, SnapshotState::Ready);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn recorded_state_survives_until_the_filesystem_disagrees() {
    let root = temp_root("registry");
    let k = key("in-flight");

    set_status(&k, SnapshotStatus::new(SnapshotState::Downloading, ""));
    assert_eq!(status(&root, &k).state, SnapshotState::Downloading);

    set_status(
        &k,
        SnapshotStatus::new(SnapshotState::Failed, "network error"),
    );
    let failed = status(&root, &k);
    assert_eq!(failed.state, SnapshotState::Failed);
    assert_eq!(failed.detail, "network error");
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn readiness_on_disk_wins_over_a_stale_failure() {
    let root = temp_root("disk-wins");
    let k = key("recovered");
    set_status(
        &k,
        SnapshotStatus::new(SnapshotState::Failed, "earlier attempt"),
    );

    std::fs::create_dir_all(store::partial_dir(&root, &k)).expect("staging");
    std::fs::write(store::partial_dir(&root, &k).join("a.ts"), "x").expect("write");
    store::promote(&root, &k).expect("promote");

    assert_eq!(status(&root, &k).state, SnapshotState::Ready);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn only_one_caller_can_claim_a_key() {
    let root = temp_root("claim");
    let k = key("contended");

    assert!(claim(&root, &k).is_ok());

    let second = claim(&root, &k).expect_err("second caller must be turned away");
    assert_eq!(second.state, SnapshotState::Downloading);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn claim_is_refused_when_the_snapshot_is_already_on_disk() {
    let root = temp_root("claim-ready");
    let k = key("already-there");
    std::fs::create_dir_all(store::partial_dir(&root, &k)).expect("staging");
    std::fs::write(store::partial_dir(&root, &k).join("a.ts"), "x").expect("write");
    store::promote(&root, &k).expect("promote");

    let refused = claim(&root, &k).expect_err("ready keys must not re-download");
    assert_eq!(refused.state, SnapshotState::Ready);
    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn registry_keys_separate_hosts_repos_and_shas() {
    let a = key("sha1");
    let b = key("sha2");
    let other_host = SnapshotKey {
        host: "https://gitlab.acme.dev".to_string(),
        ..key("sha1")
    };

    assert_ne!(registry_key(&a), registry_key(&b));
    assert_ne!(registry_key(&a), registry_key(&other_host));
}
