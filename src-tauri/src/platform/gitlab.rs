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

use crate::http::{
    fbool, fopt_u64, fstr, fu64, get_all_pages, get_json, log, net_err, now_millis, nstr, read_body,
};
use crate::model::{
    ChangedFile, CiStatus, FileBlob, GitHubUser, InboxBucket, InboxData, IssueComment, PullRequest,
    PullRequestDetail, RepoHit, ReviewComment, ReviewCommentInput, ReviewSummary, MAX_BLOB_BYTES,
};

pub struct GitLabPlatform {
    client: reqwest::Client,
    api: String,
}

/// One end of a GitLab multi-line `line_range`. The line_code format is
/// `{sha1(file_path)}_{old_line}_{new_line}`; the side the line doesn't
/// exist on is encoded as 0 (best-effort — see the fallback at the caller).
fn gl_range_end(path: &str, line: u64, side: &str) -> Value {
    use sha1::{Digest, Sha1};
    let sha = format!("{:x}", Sha1::digest(path.as_bytes()));
    if side == "LEFT" {
        json!({ "line_code": format!("{sha}_{line}_0"), "type": "old", "old_line": line })
    } else {
        json!({ "line_code": format!("{sha}_0_{line}"), "type": "new", "new_line": line })
    }
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

/// Maps the newest pipeline from `/merge_requests/:iid/pipelines` (the list is
/// newest-first) onto the shared `CiStatus`. Pure so it can be unit-tested.
/// Pipeline status success/failed/running/pending/canceled → success/failure/
/// pending; no pipeline → "none". `total`/`failed` are coarse (one pipeline is
/// one row) since the list endpoint doesn't break down per-job.
fn ci_from_pipelines(pipelines: &Value) -> CiStatus {
    let Some(latest) = pipelines.as_array().and_then(|a| a.first()) else {
        return CiStatus::default();
    };
    let status = fstr(latest, "status");
    let state = match status.as_str() {
        "success" => "success",
        "failed" => "failure",
        "running" | "pending" | "created" | "waiting_for_resource" | "preparing" => "pending",
        _ => return CiStatus::default(),
    };
    let failed = if state == "failure" { 1 } else { 0 };
    CiStatus {
        state: state.to_string(),
        total: 1,
        failed,
        url: fstr(latest, "web_url"),
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

/// GitLab's `diff` field leads with a `--- a/path`/`+++ b/path` file-header
/// pair before the first `@@` hunk (e.g. `"--- a/VERSION\n+++ b/VERSION\n@@
/// -1 +1 @@\n..."`); GitHub's per-file `patch` field never has one. The
/// frontend's patch parser (`parsePatch` in `diff.ts`) expects a hunk-only
/// patch starting at `@@` — untouched, the header pair gets misread as del/add
/// rows in a headerless pseudo-hunk, which fails full-file expansion's
/// hunk-header validation outright. Strip the pair when present.
fn strip_diff_file_header(diff: &str) -> &str {
    let Some(after_old) = diff.strip_prefix("--- ") else {
        return diff;
    };
    let Some(old_nl) = after_old.find('\n') else {
        return diff;
    };
    let rest = &after_old[old_nl + 1..];
    let Some(after_new) = rest.strip_prefix("+++ ") else {
        return diff;
    };
    match after_new.find('\n') {
        Some(new_nl) => &after_new[new_nl + 1..],
        None => "",
    }
}

fn file_from_diff(v: &Value, head_sha: &str) -> ChangedFile {
    let raw_diff = fstr(v, "diff");
    let diff = strip_diff_file_header(&raw_diff).to_string();
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
/// replies point at it via `in_reply_to_id`. `thread` is the enclosing
/// discussion's (id, resolved) pair when the thread is resolvable — stamped on
/// every note of the thread (matching the GitHub GraphQL overlay) so the
/// frontend never has to walk to the root.
fn note_to_comment(
    note: &Value,
    root: Option<&Value>,
    thread: Option<(&str, bool)>,
) -> ReviewComment {
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
        thread_id: thread.map(|(id, _)| id.to_string()),
        resolved: thread.map(|(_, r)| r).unwrap_or(false),
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

    /// GitLab has no "involves" filter, so the "involved" bucket is synthesized
    /// by unioning the reviewer, assignee, and author buckets.
    pub async fn inbox(&self) -> Result<InboxData, String> {
        let me = self.current_user().await?.login;
        log(&format!("GitLab inbox for {me}"));
        let review_requested = self
            .mr_bucket(&format!("reviewer_username={}", enc(&me)))
            .await?;
        let assigned = self
            .mr_bucket(&format!("assignee_username={}", enc(&me)))
            .await?;
        let created = self
            .mr_bucket(&format!("author_username={}", enc(&me)))
            .await?;
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
            let Some((owner, name)) = repo.rsplit_once('/') else {
                continue;
            };
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
        Ok(InboxBucket {
            count: prs.len() as u64,
            prs,
        })
    }

    /// Fans GitLab discussions out onto the three shared buckets. Approval and
    /// "unapproved" system notes are the review verdict on GitLab, so they map
    /// to `ReviewSummary` (all other system notes stay hidden); "unapproved" is
    /// matched before "approved" because its body contains the latter as a
    /// substring. Discussions with no diff `position` become PR-level issue
    /// comments; diff-anchored ones become review comments, where the
    /// discussion id is the resolve/unresolve handle (dropped when the thread
    /// is not resolvable, which hides the action).
    pub async fn pr_detail(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
    ) -> Result<PullRequestDetail, String> {
        let mr_v = get_json(&self.client, &self.mr_url(owner, repo, number)).await?;
        let mut pr = mr_to_pr(&mr_v);
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
            let disc_id = fstr(disc, "id");
            let thread = if fbool(root, "resolvable") && !disc_id.is_empty() {
                Some((disc_id.as_str(), fbool(root, "resolved")))
            } else {
                None
            };
            comments.push(note_to_comment(root, None, thread));
            for reply in notes.iter().skip(1) {
                if fbool(reply, "system") {
                    continue;
                }
                comments.push(note_to_comment(reply, Some(root), thread));
            }
        }
        issue_comments.sort_by(|a, b| a.created_at.cmp(&b.created_at));
        reviews.sort_by(|a, b| a.submitted_at.cmp(&b.submitted_at));

        let ci_status = match get_json(
            &self.client,
            &format!("{}/pipelines", self.mr_url(owner, repo, number)),
        )
        .await
        {
            Ok(pipelines) => ci_from_pipelines(&pipelines),
            Err(e) => {
                log(&format!(
                    "CI status unavailable for {owner}/{repo}!{number}: {e}"
                ));
                CiStatus::default()
            }
        };

        let detail = PullRequestDetail {
            pr,
            files,
            comments,
            issue_comments,
            reviews,
            ci_status,
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

    /// Posts a diff-anchored discussion, optionally spanning `start_line..line`
    /// via `line_range` and retried once without the range if GitLab rejects
    /// the multi-line payload. The POST response is the new discussion itself,
    /// so its id is carried straight onto the returned thread — the fresh
    /// comment is resolvable without waiting for a detail refetch.
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
        start_line: Option<u64>,
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
        if let Some(start) = start_line {
            position["line_range"] = json!({
                "start": gl_range_end(path, start, side),
                "end": gl_range_end(path, line, side),
            });
        }
        let mut resp = self
            .client
            .post(format!("{}/discussions", self.mr_url(owner, repo, number)))
            .json(&json!({ "body": body, "position": position }))
            .send()
            .await
            .map_err(net_err)?;
        if start_line.is_some() && !resp.status().is_success() {
            let obj = position.as_object_mut().expect("position is an object");
            obj.remove("line_range");
            resp = self
                .client
                .post(format!("{}/discussions", self.mr_url(owner, repo, number)))
                .json(&json!({ "body": body, "position": position }))
                .send()
                .await
                .map_err(net_err)?;
        }
        let v = read_body(resp).await?;
        let note = v
            .get("notes")
            .and_then(Value::as_array)
            .and_then(|n| n.first())
            .cloned()
            .ok_or_else(|| "GitLab did not return the created note".to_string())?;
        let disc_id = fstr(&v, "id");
        let thread = if fbool(&note, "resolvable") && !disc_id.is_empty() {
            Some((disc_id.as_str(), false))
        } else {
            None
        };
        Ok(note_to_comment(&note, None, thread))
    }

    /// Replies to a thread. Our API keys replies by note id, so the parent
    /// discussion is resolved from that note id before posting, since GitLab
    /// addresses replies by discussion id.
    pub async fn reply_to_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        body: &str,
        in_reply_to: u64,
    ) -> Result<ReviewComment, String> {
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
        let thread = if fbool(&root, "resolvable") && !disc_id.is_empty() {
            Some((disc_id.as_str(), fbool(&root, "resolved")))
        } else {
            None
        };
        Ok(note_to_comment(&v, Some(&root), thread))
    }

    /// Flip a diff discussion's resolved state.
    /// PUT /projects/:id/merge_requests/:iid/discussions/:discussion_id?resolved=…
    pub async fn resolve_thread(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        thread_id: &str,
        resolved: bool,
    ) -> Result<(), String> {
        let resp = self
            .client
            .put(format!(
                "{}/discussions/{}",
                self.mr_url(owner, repo, number),
                thread_id
            ))
            .json(&json!({ "resolved": resolved }))
            .send()
            .await
            .map_err(net_err)?;
        read_body(resp).await?;
        Ok(())
    }

    /// Edits a note's body through the MR-notes API, which addresses any note
    /// — diff-anchored or not — by note id alone, so no discussion lookup is
    /// needed (unlike replies).
    pub async fn update_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        comment_id: u64,
        body: &str,
    ) -> Result<(), String> {
        let resp = self
            .client
            .put(format!(
                "{}/notes/{}",
                self.mr_url(owner, repo, number),
                comment_id
            ))
            .json(&json!({ "body": body }))
            .send()
            .await
            .map_err(net_err)?;
        read_body(resp).await?;
        Ok(())
    }

    pub async fn delete_review_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        comment_id: u64,
    ) -> Result<(), String> {
        let resp = self
            .client
            .delete(format!(
                "{}/notes/{}",
                self.mr_url(owner, repo, number),
                comment_id
            ))
            .send()
            .await
            .map_err(net_err)?;
        read_body(resp).await?;
        Ok(())
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

    /// GitLab MR notes are one namespace — PR-level comments go through the
    /// same notes endpoints as diff notes, so these mirror the
    /// review-comment pair.
    pub async fn update_issue_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        comment_id: u64,
        body: &str,
    ) -> Result<(), String> {
        self.update_review_comment(owner, repo, number, comment_id, body)
            .await
    }

    pub async fn delete_issue_comment(
        &self,
        owner: &str,
        repo: &str,
        number: u64,
        comment_id: u64,
    ) -> Result<(), String> {
        self.delete_review_comment(owner, repo, number, comment_id)
            .await
    }

    /// Posts each pending comment, then the review verdict. GitLab has no
    /// REQUEST_CHANGES event, so that verdict is expressed as a summary issue
    /// comment prefixed with "Changes requested"; APPROVE additionally hits the
    /// `/approve` endpoint.
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
                owner,
                repo,
                number,
                &c.body,
                commit_id,
                &c.path,
                c.line,
                &c.side,
                c.start_line,
            )
            .await?;
        }
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

    /// Fetches a markdown-embedded upload (a pasted image or video) through
    /// the Uploads API. GitLab's plain `/uploads/...` web route only accepts
    /// a browser session — it redirects an unauthenticated (or token-only)
    /// request to the sign-in page — so this hits the API route instead,
    /// which authenticates the same way as the rest of the client.
    pub async fn upload_blob(
        &self,
        owner: &str,
        repo: &str,
        secret: &str,
        filename: &str,
    ) -> Result<FileBlob, String> {
        let url = format!(
            "{}/projects/{}/uploads/{}/{}",
            self.api,
            project(owner, repo),
            enc(secret),
            enc(filename)
        );
        crate::http::fetch_blob(&self.client, &url).await
    }
}

#[cfg(test)]
#[path = "gitlab_tests.rs"]
mod tests;
