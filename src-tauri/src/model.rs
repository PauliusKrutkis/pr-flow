//! Shared data model (serialized as camelCase for the TypeScript frontend).
//! Consumed by every platform implementation — providers map their payloads
//! onto these, so the webview stays host-agnostic.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubUser {
    pub login: String,
    pub avatar_url: String,
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub id: u64,
    pub number: u64,
    pub title: String,
    pub repo: String,
    pub owner: String,
    pub name: String,
    pub author: String,
    pub author_avatar_url: String,
    pub url: String,
    pub state: String,
    pub draft: bool,
    #[serde(default)]
    pub merged: bool,
    pub updated_at: String,
    pub created_at: String,
    pub comments_count: u64,
    pub head_sha: String,
    #[serde(default)]
    pub base_sha: String,
    #[serde(default)]
    pub head_ref: String,
    #[serde(default)]
    pub base_ref: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_comment: Option<LastComment>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LastComment {
    pub author: String,
    pub author_avatar_url: String,
    pub body: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub filename: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_filename: Option<String>,
    pub status: String,
    pub additions: u64,
    pub deletions: u64,
    pub changes: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub patch: Option<String>,
    pub sha: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewComment {
    pub id: u64,
    pub path: String,
    pub line: Option<u64>,
    pub original_line: Option<u64>,
    pub side: String,
    pub diff_hunk: String,
    pub body: String,
    pub user: String,
    pub user_avatar_url: String,
    pub created_at: String,
    pub in_reply_to_id: Option<u64>,
    #[serde(default)]
    pub thread_id: Option<String>,
    #[serde(default)]
    pub resolved: bool,
}

/// A PR-level conversation comment (not anchored to a diff line).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct IssueComment {
    pub id: u64,
    pub body: String,
    pub user: String,
    pub user_avatar_url: String,
    pub created_at: String,
}

/// A submitted review: an approval / change request / review with a summary
/// body. These are the "LGTM" moments the conversation view would otherwise
/// silently drop — inline comments live in `ReviewComment`, but the verdict
/// itself only exists here.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ReviewSummary {
    pub id: u64,
    pub user: String,
    pub user_avatar_url: String,
    pub state: String,
    pub body: String,
    pub submitted_at: String,
}

/// Aggregated CI/pipeline state for the PR's head commit, mapped from GitHub
/// check-runs + commit statuses or GitLab pipelines onto one host-agnostic
/// shape. `state: "none"` means the repo has no CI configured (the header pill
/// renders nothing so quiet repos stay quiet).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CiStatus {
    pub state: String,
    pub total: u64,
    pub failed: u64,
    pub url: String,
}

impl Default for CiStatus {
    fn default() -> Self {
        CiStatus {
            state: "none".to_string(),
            total: 0,
            failed: 0,
            url: String::new(),
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetail {
    pub pr: PullRequest,
    pub files: Vec<ChangedFile>,
    pub comments: Vec<ReviewComment>,
    #[serde(default)]
    pub issue_comments: Vec<IssueComment>,
    #[serde(default)]
    pub reviews: Vec<ReviewSummary>,
    #[serde(default)]
    pub ci_status: CiStatus,
    pub fetched_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InboxBucket {
    pub count: u64,
    pub prs: Vec<PullRequest>,
}

/// All inbox tabs fetched in a single request (where the host allows it).
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InboxData {
    pub review_requested: InboxBucket,
    pub assigned: InboxBucket,
    pub created: InboxBucket,
    pub involved: InboxBucket,
}

/// Hard cap on blob size shipped to the webview — images beyond this are
/// better opened on the host than base64-encoded into the UI.
pub const MAX_BLOB_BYTES: usize = 20 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileBlob {
    pub base64: String,
    pub size: u64,
}

/// A repository search hit (the watch-repos picker).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RepoHit {
    pub full_name: String,
    pub description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCommentInput {
    pub path: String,
    pub line: u64,
    pub side: String,
    pub body: String,
    #[serde(default)]
    pub start_line: Option<u64>,
}
