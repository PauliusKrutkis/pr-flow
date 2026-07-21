use super::*;

fn mr_fixture() -> Value {
    serde_json::json!({
        "id": 123456,
        "iid": 42,
        "title": "Add search",
        "state": "opened",
        "draft": false,
        "created_at": "2026-07-01T10:00:00Z",
        "updated_at": "2026-07-02T11:00:00Z",
        "source_branch": "feat/search",
        "target_branch": "main",
        "sha": "headsha123",
        "user_notes_count": 3,
        "description": "body text",
        "web_url": "https://gitlab.com/group/sub/proj/-/merge_requests/42",
        "author": { "username": "alice", "avatar_url": "https://a/x.png" },
        "references": { "full": "group/sub/proj!42" }
    })
}

#[test]
fn mr_maps_iid_and_subgroup_paths() {
    let pr = mr_to_pr(&mr_fixture());
    assert_eq!(pr.number, 42);
    assert_eq!(pr.owner, "group/sub");
    assert_eq!(pr.name, "proj");
    assert_eq!(pr.repo, "group/sub/proj");
    assert_eq!(pr.state, "open");
    assert!(!pr.merged);
    assert_eq!(pr.head_sha, "headsha123");
    assert_eq!(pr.head_ref, "feat/search");
    assert_eq!(pr.base_ref, "main");
    assert_eq!(pr.author, "alice");
    assert_eq!(pr.comments_count, 3);
}

#[test]
fn ci_from_pipelines_maps_latest() {
    let failed = ci_from_pipelines(&serde_json::json!([
        { "status": "failed", "web_url": "https://g/p/1" },
        { "status": "success", "web_url": "https://g/p/0" }
    ]));
    assert_eq!(failed.state, "failure");
    assert_eq!(failed.total, 1);
    assert_eq!(failed.failed, 1);
    assert_eq!(failed.url, "https://g/p/1");

    let running = ci_from_pipelines(&serde_json::json!([
        { "status": "running", "web_url": "r" }
    ]));
    assert_eq!(running.state, "pending");
    assert_eq!(running.failed, 0);

    assert_eq!(ci_from_pipelines(&serde_json::json!([])).state, "none");
    assert_eq!(
        ci_from_pipelines(&serde_json::json!([{ "status": "canceled" }])).state,
        "none"
    );
}

#[test]
fn merged_state_maps_to_closed_plus_merged_flag() {
    let mut v = mr_fixture();
    v["state"] = serde_json::json!("merged");
    let pr = mr_to_pr(&v);
    assert_eq!(pr.state, "closed");
    assert!(pr.merged);
}

#[test]
fn diff_refs_head_wins_over_sha() {
    let mut v = mr_fixture();
    v["diff_refs"] = serde_json::json!({ "base_sha": "b", "head_sha": "h" });
    let pr = mr_to_pr(&v);
    assert_eq!(pr.head_sha, "h");
    assert_eq!(pr.base_sha, "b");
}

#[test]
fn diff_stats_ignores_file_headers() {
    let (a, d) = diff_stats("--- a/x\n+++ b/x\n+one\n+two\n-three\n context");
    assert_eq!((a, d), (2, 1));
}

#[test]
fn strip_diff_file_header_drops_leading_pair() {
    assert_eq!(
        strip_diff_file_header("--- a/VERSION\n+++ b/VERSION\n@@ -1 +1 @@\n-1.9.7\n+1.9.8\n"),
        "@@ -1 +1 @@\n-1.9.7\n+1.9.8\n"
    );
}

#[test]
fn strip_diff_file_header_leaves_hunk_only_diff_untouched() {
    let diff = "@@ -1 +1 @@\n-a\n+b\n";
    assert_eq!(strip_diff_file_header(diff), diff);
}

#[test]
fn file_from_diff_strips_gitlab_file_header_from_patch() {
    let v = serde_json::json!({
        "old_path": "VERSION", "new_path": "VERSION",
        "diff": "--- a/VERSION\n+++ b/VERSION\n@@ -1 +1 @@\n-1.9.7\n+1.9.8\n"
    });
    let file = file_from_diff(&v, "sha");
    assert_eq!(file.patch.as_deref(), Some("@@ -1 +1 @@\n-1.9.7\n+1.9.8\n"));
    assert_eq!(file.additions, 1);
    assert_eq!(file.deletions, 1);
}

#[test]
fn file_statuses_map() {
    let mk = |extra: Value| {
        let mut v = serde_json::json!({
            "old_path": "old.ts", "new_path": "new.ts",
            "diff": "@@ -1 +1 @@\n-a\n+b\n"
        });
        v.as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        v
    };
    let added = file_from_diff(&mk(serde_json::json!({"new_file": true})), "sha");
    assert_eq!(added.status, "added");
    let removed = file_from_diff(&mk(serde_json::json!({"deleted_file": true})), "sha");
    assert_eq!(removed.status, "removed");
    assert_eq!(removed.filename, "old.ts"); // deleted files keep the old path
    let renamed = file_from_diff(&mk(serde_json::json!({"renamed_file": true})), "sha");
    assert_eq!(renamed.status, "renamed");
    assert_eq!(renamed.previous_filename.as_deref(), Some("old.ts"));
    let modified = file_from_diff(&mk(serde_json::json!({})), "sha");
    assert_eq!(modified.status, "modified");
    assert_eq!(modified.additions, 1);
    assert_eq!(modified.deletions, 1);
}

#[test]
fn notes_thread_under_the_root() {
    let root = serde_json::json!({
        "id": 10, "body": "root", "created_at": "t1", "system": false,
        "author": { "username": "a", "avatar_url": "" },
        "position": { "new_path": "f.ts", "new_line": 7 }
    });
    let reply = serde_json::json!({
        "id": 11, "body": "reply", "created_at": "t2", "system": false,
        "author": { "username": "b", "avatar_url": "" }
    });
    let rc = note_to_comment(&root, None, Some(("disc-1", true)));
    assert_eq!(rc.line, Some(7));
    assert_eq!(rc.side, "RIGHT");
    assert_eq!(rc.path, "f.ts");
    assert_eq!(rc.in_reply_to_id, None);
    assert_eq!(rc.thread_id.as_deref(), Some("disc-1"));
    assert!(rc.resolved);
    let rr = note_to_comment(&reply, Some(&root), Some(("disc-1", true)));
    assert_eq!(rr.in_reply_to_id, Some(10));
    assert_eq!(rr.path, "f.ts");
    assert_eq!(rr.line, None);
    assert_eq!(rr.thread_id.as_deref(), Some("disc-1"));
}

#[test]
fn old_side_positions_map_left() {
    let root = serde_json::json!({
        "id": 1, "body": "x", "created_at": "t", "system": false,
        "author": { "username": "a", "avatar_url": "" },
        "position": { "old_path": "f.ts", "old_line": 3 }
    });
    let rc = note_to_comment(&root, None, None);
    assert_eq!(rc.side, "LEFT");
    assert_eq!(rc.line, Some(3));
    assert_eq!(rc.thread_id, None);
    assert!(!rc.resolved);
}

#[test]
fn enc_percent_encodes_path_separators() {
    assert_eq!(enc("group/sub proj"), "group%2Fsub%20proj");
    assert_eq!(enc("a-b_c.d~e"), "a-b_c.d~e");
}
