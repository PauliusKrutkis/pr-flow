use super::*;

#[test]
fn pr_from_pull_maps_rich_fields() {
    let v = serde_json::json!({
        "id": 1, "number": 7, "title": "T", "state": "open",
        "draft": true, "merged": false,
        "updated_at": "u", "created_at": "c", "review_comments": 4,
        "html_url": "https://github.com/o/r/pull/7", "body": "b",
        "additions": 10, "deletions": 2, "changed_files": 3,
        "user": { "login": "alice", "avatar_url": "av" },
        "head": { "sha": "h", "ref": "feat" },
        "base": { "sha": "bs", "ref": "main" }
    });
    let pr = pr_from_pull(&v, "o", "r");
    assert_eq!(pr.number, 7);
    assert_eq!(pr.repo, "o/r");
    assert!(pr.draft);
    assert_eq!(pr.head_sha, "h");
    assert_eq!(pr.base_sha, "bs");
    assert_eq!(pr.base_ref, "main");
    assert_eq!(pr.additions, 10);
}

#[test]
fn missing_fields_degrade_to_defaults_not_panics() {
    let pr = pr_from_pull(&serde_json::json!({}), "o", "r");
    assert_eq!(pr.number, 0);
    assert_eq!(pr.title, "");
    assert!(!pr.merged);
    let c = comment_from(&serde_json::json!({}));
    assert_eq!(c.side, "RIGHT");
    assert_eq!(c.line, None);
}

#[test]
fn graphql_bucket_maps_states_and_counts() {
    let data = serde_json::json!({
        "alias": {
            "issueCount": 12,
            "nodes": [
                {
                    "databaseId": 5, "number": 2, "title": "x",
                    "url": "https://github.com/o/r/pull/2",
                    "state": "MERGED", "isDraft": false,
                    "createdAt": "c", "updatedAt": "u",
                    "author": { "login": "a", "avatarUrl": "av" },
                    "repository": { "name": "r", "owner": { "login": "o" } },
                    "comments": { "totalCount": 1 }
                },
                null
            ]
        }
    });
    let bucket = bucket_from(&data, "alias");
    assert_eq!(bucket.count, 12);
    assert_eq!(bucket.prs.len(), 1);
    assert_eq!(bucket.prs[0].owner, "o");
    assert!(bucket.prs[0].merged);
    assert_eq!(bucket.prs[0].state, "merged");
}

#[test]
fn ci_from_github_aggregates_checks_and_status() {
    let check_runs = serde_json::json!({
        "check_runs": [
            { "status": "completed", "conclusion": "success", "html_url": "ok" },
            { "status": "completed", "conclusion": "failure", "html_url": "boom" },
            { "status": "in_progress", "conclusion": null, "html_url": "wip" }
        ]
    });
    let combined = serde_json::json!({
        "statuses": [ { "state": "success", "target_url": "t" } ]
    });
    let ci = ci_from_github(&check_runs, &combined, "https://x/checks");
    assert_eq!(ci.state, "failure");
    assert_eq!(ci.total, 4);
    assert_eq!(ci.failed, 1);
    assert_eq!(ci.url, "boom");
}

#[test]
fn ci_from_github_pending_then_success_then_none() {
    let pending = ci_from_github(
        &serde_json::json!({ "check_runs": [
            { "status": "queued", "conclusion": null }
        ] }),
        &serde_json::json!({ "statuses": [] }),
        "cx",
    );
    assert_eq!(pending.state, "pending");
    assert_eq!(pending.url, "cx");

    let success = ci_from_github(
        &serde_json::json!({ "check_runs": [
            { "status": "completed", "conclusion": "success" }
        ] }),
        &serde_json::json!({ "statuses": [] }),
        "cx",
    );
    assert_eq!(success.state, "success");
    assert_eq!(success.total, 1);

    let none = ci_from_github(
        &serde_json::json!({ "check_runs": [] }),
        &serde_json::json!({ "statuses": [] }),
        "cx",
    );
    assert_eq!(none.state, "none");
    assert_eq!(none.total, 0);
    assert_eq!(none.url, "");
}

#[test]
fn comment_from_threads_replies() {
    let v = serde_json::json!({
        "id": 9, "path": "f.ts", "line": 3, "side": "LEFT",
        "body": "b", "created_at": "t", "in_reply_to_id": 4,
        "user": { "login": "u", "avatar_url": "" }
    });
    let c = comment_from(&v);
    assert_eq!(c.in_reply_to_id, Some(4));
    assert_eq!(c.side, "LEFT");
}
