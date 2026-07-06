//! GitLab implementation of the platform seam. Merge requests are mapped onto
//! the shared PullRequest/ChangedFile/ReviewComment model so the frontend
//! never learns the difference:
//!
//! - MR `iid` is the PR number; the project path ("group/subgroup/project")
//!   splits into owner ("group/subgroup") and name ("project").
//! - `/diffs` entries become ChangedFiles (the `diff` field is a unified diff
//!   body, same format the diff viewer already parses).
//! - Diff discussions become review-comment threads: the first note anchors
//!   the thread, later notes carry `in_reply_to_id` pointing at it.
//! - GitLab has no batched review: submit posts the inline comments and the
//!   summary note sequentially, then approves when the event is APPROVE.
//!   REQUEST_CHANGES is expressed in the summary note (no API equivalent).

use serde_json::{json, Value};

use crate::github::{
    fbool, fopt_u64, fstr, fu64, get_all_pages, get_json, log, net_err, now_millis, nstr,
    read_body, ChangedFile, FileBlob, GitHubUser, InboxBucket, InboxData, IssueComment,
    PullRequest, PullRequestDetail, RepoHit, ReviewComment, ReviewCommentInput, ReviewSummary,
    MAX_BLOB_BYTES,
};

pub struct GitLabPlatform {
    client: reqwest::Client,
    /// REST base, e.g. "https://gitlab.com/api/v4".
    api: String,
}

/// Percent-encode a path segment (RFC 3986 unreserved set), '/' included —
/// GitLab wants project paths and file paths as single encoded segments.
fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// "group/subgroup/project" from an owner/name pair the frontend carries.
fn project(owner: &str, name: &str) -> String {
    enc(&format!("{owner}/{name}"))
}

/// GitLab MR states: opened | closed | locked | merged → our open/closed.
fn map_state(state: &str) -> (String, bool) {
    match state {
        "opened" => ("open".to_string(), false),
        "merged" => ("closed".to_string(), true),
        other => (other.to_string(), false),
    }
}

/// Splits `references.full` ("group/sub/project!123") into (owner, name).
fn owner_name(v: &Value) -> (String, String) {
    let full = v
        .get("references")
        .and_then(|r| r.get("full"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let path = full.split('!').next().unwrap_or_default();
    match path.rsplit_once('/') {
        Some((owner, name)) => (owner.to_string(), name.to_string()),
        None => (String::new(), path.to_string()),
    }
}

fn mr_to_pr(v: &Value) -> PullRequest {
    let (owner, name) = owner_name(v);
    let (state, merged) = map_state(&fstr(v, "state"));
    let base_sha = nstr(v, "diff_refs", "base_sha");
    let head_sha = {
        let s = nstr(v, "diff_refs", "head_sha");
        if s.is_empty() {
            fstr(v, "sha")
        } else {
            s
        }
    };
    PullRequest {
        id: fu64(v, "id"),
        number: fu64(v, "iid"),
        title: fstr(v, "title"),
        repo: if owner.is_empty() {
            name.clone()
        } else {
            format!("{owner}/{name}")
        },
        owner,
        name,
        author: nstr(v, "author", "username"),
        author_avatar_url: nstr(v, "author", "avatar_url"),
        url: fstr(v, "web_url"),
        state,
        draft: fbool(v, "draft"),
        merged,
        updated_at: fstr(v, "updated_at"),
        created_at: fstr(v, "created_at"),
        comments_count: fu64(v, "user_notes_count"),
        head_sha,
        base_sha,
        head_ref: fstr(v, "source_branch"),
        base_ref: fstr(v, "target_branch"),
        additions: 0,
        deletions: 0,
        // List responses carry `changes_count` as a string ("12", capped
        // "1000+"); +/- line totals only exist on the detail fetch.
        changed_files: fstr(v, "changes_count")
            .trim_end_matches('+')
            .parse()
            .unwrap_or(0),
        body: fstr(v, "description"),
        last_comment: None,
    }
}

/// Counts +/- lines in a unified diff body.
fn diff_stats(diff: &str) -> (u64, u64) {
    let mut add = 0;
    let mut del = 0;
    for line in diff.lines() {
        if line.starts_with("+++") || line.starts_with("---") {
            continue;
        }
        if line.starts_with('+') {
            add += 1;
        } else if line.starts_with('-') {
            del += 1;
        }
    }
    (add, del)
}

fn file_from_diff(v: &Value, head_sha: &str) -> ChangedFile {
    let diff = fstr(v, "diff");
    let (additions, deletions) = diff_stats(&diff);
    let new_file = fbool(v, "new_file");
    let deleted = fbool(v, "deleted_file");
    let renamed = fbool(v, "renamed_file");
    let status = if new_file {
        "added"
    } else if deleted {
        "removed"
    } else if renamed {
        "renamed"
    } else {
        "modified"
    };
    let new_path = fstr(v, "new_path");
    let old_path = fstr(v, "old_path");
    ChangedFile {
        filename: if deleted { old_path.clone() } else { new_path },
        previous_filename: if renamed { Some(old_path) } else { None },
        status: status.to_string(),
        additions,
        deletions,
        changes: additions + deletions,
        patch: if diff.is_empty() { None } else { Some(diff) },
        sha: head_sha.to_string(),
    }
}

/// Maps one note of a diff discussion. `root` carries the thread's anchor;
/// replies point at it via `in_reply_to_id`.
fn note_to_comment(note: &Value, root: Option<&Value>) -> ReviewComment {
    let anchor = root.unwrap_or(note);
    let pos = anchor.get("position").cloned().unwrap_or(Value::Null);
    let new_line = fopt_u64(&pos, "new_line");
    let old_line = fopt_u64(&pos, "old_line");
    let path = {
        let p = fstr(&pos, "new_path");
        if p.is_empty() {
            fstr(&pos, "old_path")
        } else {
            p
        }
    };
    ReviewComment {
        id: fu64(note, "id"),
        path,
        line: if root.is_none() {
            new_line.or(old_line)
        } else {
            None
        },
        original_line: old_line,
        side: if new_line.is_some() {
            "RIGHT".to_string()
        } else {
            "LEFT".to_string()
        },
        diff_hunk: String::new(),
        body: fstr(note, "body"),
        user: nstr(note, "author", "username"),
        user_avatar_url: nstr(note, "author", "avatar_url"),
        created_at: fstr(note, "created_at"),
        in_reply_to_id: root.map(|r| fu64(r, "id")),
    }
}

impl GitLabPlatform {
    pub fn new(host: &str, token: &str) -> Result<Self, String> {
        use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, USER_AGENT};
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static("pr-flow"));
        let auth = HeaderValue::from_str(&format!("Bearer {token}"))
            .map_err(|e| format!("invalid token header: {e}"))?;
        headers.insert(AUTHORIZATION, auth);
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()
            .map_err(|e| format!("could not build http client: {e}"))?;
        Ok(Self {
            client,
            api: format!("{}/api/v4", host.trim_end_matches('/')),
        })
    }

    fn mr_url(&self, owner: &str, name: &str, iid: u64) -> String {
        format!(
            "{}/projects/{}/merge_requests/{}",
            self.api,
            project(owner, name),
            iid
        )
    }

    pub async fn current_user(&self) -> Result<GitHubUser, String> {
        let v = get_json(&self.client, &format!("{}/user", self.api)).await?;
        if fstr(&v, "username").is_empty() {
            return Err("GitLab did not return a user for this token".to_string());
        }
        Ok(GitHubUser {
            login: fstr(&v, "username"),
            avatar_url: fstr(&v, "avatar_url"),
            name: fstr(&v, "name"),
        })
    }

    async fn mr_bucket(&self, query: &str) -> Result<InboxBucket, String> {
        let url = format!(
            "{}/merge_requests?scope=all&state=opened&order_by=updated_at&sort=desc&per_page=50&{}",
            self.api, query
        );
        let v = get_json(&self.client, &url).await?;
        let prs: Vec<PullRequest> = v
            .as_array()
            .map(|arr| arr.iter().map(mr_to_pr).collect())
            .unwrap_or_default();
        Ok(InboxBucket {
            count: prs.len() as u64,
            prs,
        })
    }

    pub async fn inbox(&self) -> Result<InboxData, String> {
        let me = self.current_user().await?.login;
        log(&format!("GitLab inbox for {me}"));
        let review_requested = self
            .mr_bucket(&format!("reviewer_username={}", enc(&me)))
            .await?;
        let assigned = self
            .mr_bucket(&format!("assignee_username={}", enc(&me)))
            .await?;
        let created = self.mr_bucket(&format!("author_username={}", enc(&me))).await?;
        // GitLab has no "involves" filter — union the other buckets instead.
        let mut involved_prs: Vec<PullRequest> = Vec::new();
        for pr in review_requested
            .prs
            .iter()
            .chain(assigned.prs.iter())
            .chain(created.prs.iter())
        {
            if !involved_prs.iter().any(|p| p.id == pr.id) {
                involved_prs.push(pr.clone());
            }
        }
        involved_prs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        let involved = InboxBucket {
            count: involved_prs.len() as u64,
            prs: involved_prs,
        };
        Ok(InboxData {
            review_requested,
            assigned,
            created,
            involved,
        })
    }

    /// Project search for the watch picker — visible projects only.
    pub async fn search_repos(&self, query: &str) -> Result<Vec<RepoHit>, String> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }
        let url = format!(
            "{}/projects?search={}&per_page=8&simple=true&order_by=last_activity_at",
            self.api,
            enc(query)
        );
        let v = get_json(&self.client, &url).await?;
        Ok(v.as_array()
            .map(|items| {
                items
                    .iter()
                    .map(|r| RepoHit {
                        full_name: fstr(r, "path_with_namespace"),
                        description: fstr(r, "description"),
                    })
                    .collect()
            })
            .unwrap_or_default())
    }

    /// Open MRs across watched projects. GitLab has no cross-project search
    /// by list, so this fans out one request per project; a missing/private
    /// project is skipped (logged) rather than failing the whole tab.
    pub async fn subscribed_prs(&self, repos: &[String]) -> Result<InboxBucket, String> {
        let mut prs: Vec<PullRequest> = Vec::new();
        for repo in repos {
            let Some((owner, name)) = repo.rsplit_once('/') else { continue };
            let url = format!(
                "{}/projects/{}/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page=30",
                self.api,
                project(owner, name)
            );
            match get_json(&self.client, &url).await {
                Ok(v) => {
                    if let Some(arr) = v.as_array() {
                        prs.extend(arr.iter().map(mr_to_pr));
                    }
                }
                Err(e) => log(&format!("watching: skipping {repo}: {e}")),
            }
        }
        prs.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(InboxBucket { count: prs.len() as u64, prs })
    }

    pub async fn pr_detail(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<PullRequestDetail, String> {
        let mr_v = get_json(&self.client, &self.mr_url(owner, repo, number)).await?;
        let mut pr = mr_to_pr(&mr_v);
        // The detail payload knows owner/name authoritatively.
        pr.owner = owner.to_string();
        pr.name = repo.to_string();
        pr.repo = format!("{owner}/{repo}");

        let diffs = get_all_pages(
            &self.client,
            &format!("{}/diffs", self.mr_url(owner, repo, number)),
        )
        .await?;
        let files: Vec<ChangedFile> = diffs
            .iter()
            .map(|d| file_from_diff(d, &pr.head_sha))
            .collect();
        pr.changed_files = files.len() as u64;
        pr.additions = files.iter().map(|f| f.additions).sum();
        pr.deletions = files.iter().map(|f| f.deletions).sum();

        let discussions = get_all_pages(
            &self.client,
            &format!("{}/discussions", self.mr_url(owner, repo, number)),
        )
        .await?;
        let mut comments: Vec<ReviewComment> = Vec::new();
        let mut issue_comments: Vec<IssueComment> = Vec::new();
        let mut reviews: Vec<ReviewSummary> = Vec::new();
        for disc in &discussions {
            let notes = disc
                .get("notes")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let Some(root) = notes.first() else { continue };
            if fbool(root, "system") {
                // System notes are host chatter (pushes, labels, …) and stay
                // hidden — except approval events, which ARE the review verdict
                // on GitLab. Map them onto the shared ReviewSummary shape.
                // "unapproved" is checked first: it contains "approved".
                let body = fstr(root, "body");
                let state = if body.starts_with("unapproved this merge request") {
                    Some("DISMISSED")
                } else if body.starts_with("approved this merge request") {
                    Some("APPROVED")
                } else {
                    None
                };
                if let Some(state) = state {
                    reviews.push(ReviewSummary {
                        id: fu64(root, "id"),
                        user: nstr(root, "author", "username"),
                        user_avatar_url: nstr(root, "author", "avatar_url"),
                        state: state.to_string(),
                        body: String::new(),
                        submitted_at: fstr(root, "created_at"),
                    });
                }
                continue;
            }
            // Positionless human threads are MR-level conversation.
            if root.get("position").map_or(true, Value::is_null) {
                for note in &notes {
                    if fbool(note, "system") {
                        continue;
                    }
                    issue_comments.push(IssueComment {
                        id: fu64(note, "id"),
                        body: fstr(note, "body"),
                        user: nstr(note, "author", "username"),
                        user_avatar_url: nstr(note, "author", "avatar_url"),
                        created_at: fstr(note, "created_at"),
                    });
                }
                continue;
            }
            // Diff-anchored threads become review comments.
            comments.push(note_to_comment(root, None));
            for reply in notes.iter().skip(1) {
                if fbool(reply, "system") {
                    continue;
                }
                comments.push(note_to_comment(reply, Some(root)));
            }
        }
        issue_comments.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        reviews.sort_by(|a, b| a.submitted_at.cmp(&b.submitted_at));

        let detail = PullRequestDetail {
            pr,
            files,
            comments,
            issue_comments,
            reviews,
            fetched_at: now_millis(),
        };
        log(&format!(
            "MR {owner}/{repo}!{number}: {} files, {} comments",
            detail.files.len(),
            detail.comments.len()
        ));
        Ok(detail)
    }

    /// diff_refs are required for positioned discussions.
    async fn diff_refs(&self, owner: &str, repo: &str, number: u64) -> Result<Value, String> {
        let mr = get_json(&self.client, &self.mr_url(owner, repo, number)).await?;
        let refs = mr.get("diff_refs").cloned().unwrap_or(Value::Null);
        if refs.is_null() {
            return Err("GitLab did not return diff_refs for this merge request".to_string());
        }
        Ok(refs)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        body: &str,
        _commit_id: &str,
        path: &str,
        line: u64,
        side: &str,
    ) -> Result<ReviewComment, String> {
        let refs = self.diff_refs(owner, repo, number).await?;
        let mut position = json!({
            "position_type": "text",
            "base_sha": fstr(&refs, "base_sha"),
            "start_sha": fstr(&refs, "start_sha"),
            "head_sha": fstr(&refs, "head_sha"),
            "new_path": path,
            "old_path": path,
        });
        if side == "LEFT" {
            position["old_line"] = json!(line);
        } else {
            position["new_line"] = json!(line);
        }
        let resp = self
            .client
            .post(format!("{}/discussions", self.mr_url(owner, repo, number)))
            .json(&json!({ "body": body, "position": position }))
            .send()
            .await
            .map_err(net_err)?;
        let v = read_body(resp).await?;
        let note = v
            .get("notes")
            .and_then(Value::as_array)
            .and_then(|n| n.first())
            .cloned()
            .ok_or_else(|| "GitLab did not return the created note".to_string())?;
        Ok(note_to_comment(&note, None))
    }

    pub async fn reply_to_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        body: &str,
        in_reply_to: u64,
    ) -> Result<ReviewComment, String> {
        // Our API keys replies by note id; GitLab wants the discussion id.
        let discussions = get_all_pages(
            &self.client,
            &format!("{}/discussions", self.mr_url(owner, repo, number)),
        )
        .await?;
        let mut target: Option<(String, Value)> = None;
        for disc in &discussions {
            let notes = disc.get("notes").and_then(Value::as_array);
            if let Some(notes) = notes {
                if notes.iter().any(|n| fu64(n, "id") == in_reply_to) {
                    let root = notes.first().cloned().unwrap_or(Value::Null);
                    target = Some((fstr(disc, "id"), root));
                    break;
                }
            }
        }
        let (disc_id, root) =
            target.ok_or_else(|| "Could not find the thread to reply to".to_string())?;
        let resp = self
            .client
            .post(format!(
                "{}/discussions/{}/notes",
                self.mr_url(owner, repo, number),
                disc_id
            ))
            .json(&json!({ "body": body }))
            .send()
            .await
            .map_err(net_err)?;
        let v = read_body(resp).await?;
        Ok(note_to_comment(&v, Some(&root)))
    }

    pub async fn create_issue_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        body: &str,
    ) -> Result<(), String> {
        let resp = self
            .client
            .post(format!("{}/notes", self.mr_url(owner, repo, number)))
            .json(&json!({ "body": body }))
            .send()
            .await
            .map_err(net_err)?;
        read_body(resp).await?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn submit_review(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        event: &str,
        body: &str,
        commit_id: &str,
        comments: &[ReviewCommentInput],
    ) -> Result<(), String> {
        for c in comments {
            self.create_review_comment(
                owner, repo, number, &c.body, commit_id, &c.path, c.line, &c.side,
            )
            .await?;
        }
        // No REQUEST_CHANGES on GitLab — say it in the summary note instead.
        let summary = match (event, body.trim().is_empty()) {
            ("REQUEST_CHANGES", true) => "**Changes requested.**".to_string(),
            ("REQUEST_CHANGES", false) => format!("**Changes requested.**\n\n{body}"),
            (_, true) => String::new(),
            (_, false) => body.to_string(),
        };
        if !summary.is_empty() {
            self.create_issue_comment(owner, repo, number, &summary)
                .await?;
        }
        if event == "APPROVE" {
            let resp = self
                .client
                .post(format!("{}/approve", self.mr_url(owner, repo, number)))
                .json(&json!({}))
                .send()
                .await
                .map_err(net_err)?;
            read_body(resp).await?;
        }
        Ok(())
    }

    pub async fn file_blob(
        &self,
        owner: &str,
        repo: &str,
        path: &str,
        r#ref: &str,
    ) -> Result<FileBlob, String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        let url = format!(
            "{}/projects/{}/repository/files/{}/raw?ref={}",
            self.api,
            project(owner, repo),
            enc(path),
            enc(r#ref)
        );
        let resp = self.client.get(url).send().await.map_err(net_err)?;
        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("GitLab API error ({}): {}", status.as_u16(), text));
        }
        let bytes = resp.bytes().await.map_err(net_err)?;
        if bytes.len() > MAX_BLOB_BYTES {
            return Err(format!(
                "File is too large to preview ({} MB).",
                bytes.len() / (1024 * 1024)
            ));
        }
        Ok(FileBlob {
            base64: STANDARD.encode(&bytes),
            size: bytes.len() as u64,
        })
    }
}

#[cfg(test)]
mod tests {
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
    fn file_statuses_map() {
        let mk = |extra: Value| {
            let mut v = serde_json::json!({
                "old_path": "old.ts", "new_path": "new.ts",
                "diff": "@@ -1 +1 @@\n-a\n+b\n"
            });
            v.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
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
        let rc = note_to_comment(&root, None);
        assert_eq!(rc.line, Some(7));
        assert_eq!(rc.side, "RIGHT");
        assert_eq!(rc.path, "f.ts");
        assert_eq!(rc.in_reply_to_id, None);
        let rr = note_to_comment(&reply, Some(&root));
        assert_eq!(rr.in_reply_to_id, Some(10));
        assert_eq!(rr.path, "f.ts"); // anchor path comes from the root
        assert_eq!(rr.line, None);
    }

    #[test]
    fn old_side_positions_map_left() {
        let root = serde_json::json!({
            "id": 1, "body": "x", "created_at": "t", "system": false,
            "author": { "username": "a", "avatar_url": "" },
            "position": { "old_path": "f.ts", "old_line": 3 }
        });
        let rc = note_to_comment(&root, None);
        assert_eq!(rc.side, "LEFT");
        assert_eq!(rc.line, Some(3));
    }

    #[test]
    fn enc_percent_encodes_path_separators() {
        assert_eq!(enc("group/sub proj"), "group%2Fsub%20proj");
        assert_eq!(enc("a-b_c.d~e"), "a-b_c.d~e");
    }
}
