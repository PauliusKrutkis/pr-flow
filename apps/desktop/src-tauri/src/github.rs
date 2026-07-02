//! GitHub REST API client and the Tauri commands the frontend invokes.
//!
//! Every network call routes through here (never from the webview) so the
//! token stays in the backend and we sidestep CORS entirely. Responses are
//! parsed defensively from `serde_json::Value` — a missing or null field
//! degrades to a sensible default rather than panicking.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::storage;

const API: &str = "https://api.github.com";

// ---------------------------------------------------------------------------
// Data model (serialized as camelCase for the TypeScript frontend)
// ---------------------------------------------------------------------------

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
    /// Base branch tip sha (populated on detail fetch; used for image diffs).
    #[serde(default)]
    pub base_sha: String,
    /// Branch names (populated on detail fetch; empty in the list view).
    #[serde(default)]
    pub head_ref: String,
    #[serde(default)]
    pub base_ref: String,
    pub additions: u64,
    pub deletions: u64,
    pub changed_files: u64,
    pub body: String,
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
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequestDetail {
    pub pr: PullRequest,
    pub files: Vec<ChangedFile>,
    pub comments: Vec<ReviewComment>,
    pub fetched_at: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InboxBucket {
    /// Total matches reported by GitHub (may exceed `prs.len()` due to paging).
    pub count: u64,
    pub prs: Vec<PullRequest>,
}

/// All inbox tabs fetched in a single GraphQL request.
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InboxData {
    pub review_requested: InboxBucket,
    pub assigned: InboxBucket,
    pub created: InboxBucket,
    pub involved: InboxBucket,
}

// ---------------------------------------------------------------------------
// Small JSON extraction helpers — never panic, always fall back to a default.
// ---------------------------------------------------------------------------

fn fstr(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn fu64(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn fbool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

fn fopt_u64(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}

fn fopt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

fn nstr(v: &Value, parent: &str, key: &str) -> String {
    v.get(parent)
        .and_then(|p| p.get(key))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// One GraphQL document fetching all four inbox tabs (and their counts) via
/// aliased `search` fields — a single request for the whole inbox.
const INBOX_QUERY: &str = r#"{
  reviewRequested: search(query: "is:open is:pr review-requested:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { issueCount nodes { ...P } }
  assigned: search(query: "is:open is:pr assignee:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { issueCount nodes { ...P } }
  created: search(query: "is:open is:pr author:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { issueCount nodes { ...P } }
  involved: search(query: "is:open is:pr involves:@me archived:false sort:updated-desc", type: ISSUE, first: 50) { issueCount nodes { ...P } }
}
fragment P on PullRequest {
  databaseId number title url state isDraft createdAt updatedAt
  author { login avatarUrl }
  repository { name owner { login } }
  comments { totalCount }
}"#;

fn bucket_from(data: &Value, alias: &str) -> InboxBucket {
    let node = data.get(alias);
    let count = node
        .and_then(|b| b.get("issueCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let prs = node
        .and_then(|b| b.get("nodes"))
        .and_then(Value::as_array)
        .map(|nodes| nodes.iter().filter(|n| !n.is_null()).map(pr_from_graphql).collect())
        .unwrap_or_default();
    InboxBucket { count, prs }
}

fn detail_cache_name(owner: &str, repo: &str, number: u64) -> String {
    format!("pr_{owner}_{repo}_{number}.json")
}

// ---------------------------------------------------------------------------
// Mappers: GitHub JSON -> our structs
// ---------------------------------------------------------------------------

/// Maps a GraphQL `PullRequest` search node into our `PullRequest`. List items
/// omit the heavy fields (diff stats, head sha, body) — those load with detail.
fn pr_from_graphql(v: &Value) -> PullRequest {
    let name = nstr(v, "repository", "name");
    let owner = v
        .get("repository")
        .and_then(|r| r.get("owner"))
        .and_then(|o| o.get("login"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let state_raw = fstr(v, "state"); // OPEN | CLOSED | MERGED
    let comments_count = v
        .get("comments")
        .and_then(|c| c.get("totalCount"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    PullRequest {
        id: v.get("databaseId").and_then(Value::as_u64).unwrap_or(0),
        number: fu64(v, "number"),
        title: fstr(v, "title"),
        repo: format!("{owner}/{name}"),
        owner,
        name,
        author: nstr(v, "author", "login"),
        author_avatar_url: nstr(v, "author", "avatarUrl"),
        url: fstr(v, "url"),
        state: state_raw.to_lowercase(),
        draft: fbool(v, "isDraft"),
        merged: state_raw == "MERGED",
        updated_at: fstr(v, "updatedAt"),
        created_at: fstr(v, "createdAt"),
        comments_count,
        head_sha: String::new(),
        base_sha: String::new(),
        head_ref: String::new(),
        base_ref: String::new(),
        additions: 0,
        deletions: 0,
        changed_files: 0,
        body: String::new(),
    }
}

/// Maps a full `/pulls/{n}` object (rich fields) into a `PullRequest`.
fn pr_from_pull(v: &Value, owner: &str, repo: &str) -> PullRequest {
    PullRequest {
        id: fu64(v, "id"),
        number: fu64(v, "number"),
        title: fstr(v, "title"),
        repo: format!("{owner}/{repo}"),
        owner: owner.to_string(),
        name: repo.to_string(),
        author: nstr(v, "user", "login"),
        author_avatar_url: nstr(v, "user", "avatar_url"),
        url: fstr(v, "html_url"),
        state: fstr(v, "state"),
        draft: fbool(v, "draft"),
        merged: fbool(v, "merged"),
        updated_at: fstr(v, "updated_at"),
        created_at: fstr(v, "created_at"),
        comments_count: fu64(v, "review_comments"),
        head_sha: nstr(v, "head", "sha"),
        base_sha: nstr(v, "base", "sha"),
        head_ref: nstr(v, "head", "ref"),
        base_ref: nstr(v, "base", "ref"),
        additions: fu64(v, "additions"),
        deletions: fu64(v, "deletions"),
        changed_files: fu64(v, "changed_files"),
        body: fstr(v, "body"),
    }
}

fn file_from(v: &Value) -> ChangedFile {
    ChangedFile {
        filename: fstr(v, "filename"),
        previous_filename: fopt_str(v, "previous_filename"),
        status: fstr(v, "status"),
        additions: fu64(v, "additions"),
        deletions: fu64(v, "deletions"),
        changes: fu64(v, "changes"),
        patch: fopt_str(v, "patch"),
        sha: fstr(v, "sha"),
    }
}

fn comment_from(v: &Value) -> ReviewComment {
    ReviewComment {
        id: fu64(v, "id"),
        path: fstr(v, "path"),
        line: fopt_u64(v, "line"),
        original_line: fopt_u64(v, "original_line"),
        side: {
            let s = fstr(v, "side");
            if s.is_empty() {
                "RIGHT".to_string()
            } else {
                s
            }
        },
        diff_hunk: fstr(v, "diff_hunk"),
        body: fstr(v, "body"),
        user: nstr(v, "user", "login"),
        user_avatar_url: nstr(v, "user", "avatar_url"),
        created_at: fstr(v, "created_at"),
        in_reply_to_id: fopt_u64(v, "in_reply_to_id"),
    }
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

fn net_err(e: reqwest::Error) -> String {
    format!("network error: {e}")
}

/// Lightweight stderr logging — shows up in the `tauri dev` terminal.
fn log(msg: &str) {
    eprintln!("[pr-flow] {msg}");
}

pub(crate) fn build_client(token: &str) -> Result<reqwest::Client, String> {
    use reqwest::header::{HeaderMap, HeaderValue, ACCEPT, AUTHORIZATION, USER_AGENT};
    let mut headers = HeaderMap::new();
    headers.insert(ACCEPT, HeaderValue::from_static("application/vnd.github+json"));
    headers.insert(USER_AGENT, HeaderValue::from_static("pr-flow"));
    headers.insert(
        "X-GitHub-Api-Version",
        HeaderValue::from_static("2022-11-28"),
    );
    let auth = HeaderValue::from_str(&format!("Bearer {token}"))
        .map_err(|e| format!("invalid token header: {e}"))?;
    headers.insert(AUTHORIZATION, auth);
    reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| format!("could not build http client: {e}"))
}

async fn token_or_err(app: &AppHandle) -> Result<String, String> {
    storage::read_token(app)?.ok_or_else(|| "No GitHub token configured".to_string())
}

/// Reads a response body, turning non-2xx responses into a friendly error that
/// surfaces GitHub's own `message` field when present.
async fn read_body(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(net_err)?;
    if !status.is_success() {
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("message")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
            })
            .unwrap_or_else(|| text.clone());
        log(&format!("GitHub API error {}: {}", status.as_u16(), msg));
        return Err(format!("GitHub API error ({}): {}", status.as_u16(), msg));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("could not parse response: {e}"))
}

async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let resp = client.get(url).send().await.map_err(net_err)?;
    read_body(resp).await
}

/// Fetches every page of a list endpoint (100/page, capped at 20 pages).
async fn get_all_pages(client: &reqwest::Client, url: &str) -> Result<Vec<Value>, String> {
    let mut out: Vec<Value> = Vec::new();
    let mut page: u32 = 1;
    loop {
        let page_str = page.to_string();
        let resp = client
            .get(url)
            .query(&[("per_page", "100"), ("page", page_str.as_str())])
            .send()
            .await
            .map_err(net_err)?;
        let body = read_body(resp).await?;
        let arr = body.as_array().cloned().unwrap_or_default();
        let len = arr.len();
        out.extend(arr);
        if len < 100 || page >= 20 {
            break;
        }
        page += 1;
    }
    Ok(out)
}

pub(crate) async fn fetch_user(client: &reqwest::Client) -> Result<GitHubUser, String> {
    let v = get_json(client, &format!("{API}/user")).await?;
    Ok(GitHubUser {
        login: fstr(&v, "login"),
        avatar_url: fstr(&v, "avatar_url"),
        name: fstr(&v, "name"),
    })
}

// ---------------------------------------------------------------------------
// Commands: auth
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn has_token(app: AppHandle) -> Result<bool, String> {
    Ok(storage::read_token(&app)?.is_some())
}

#[tauri::command]
pub async fn set_token(app: AppHandle, token: String) -> Result<GitHubUser, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token is empty".to_string());
    }
    let client = build_client(&token)?;
    // Validate before persisting so we never store a bad token.
    let user = fetch_user(&client).await?;
    storage::write_token(&app, &token)?;
    Ok(user)
}

#[tauri::command]
pub async fn clear_token(app: AppHandle) -> Result<(), String> {
    storage::clear_token(&app)
}

#[tauri::command]
pub async fn get_current_user(app: AppHandle) -> Result<GitHubUser, String> {
    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;
    fetch_user(&client).await
}

// ---------------------------------------------------------------------------
// Commands: pull request list
// ---------------------------------------------------------------------------

const GRAPHQL_URL: &str = "https://api.github.com/graphql";

async fn graphql(client: &reqwest::Client, query: &str) -> Result<Value, String> {
    let resp = client
        .post(GRAPHQL_URL)
        .json(&json!({ "query": query }))
        .send()
        .await
        .map_err(net_err)?;
    let status = resp.status();
    let text = resp.text().await.map_err(net_err)?;
    if !status.is_success() {
        log(&format!("GraphQL HTTP {}: {}", status.as_u16(), text));
        return Err(format!("GitHub GraphQL error ({}): {text}", status.as_u16()));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| format!("could not parse GraphQL response: {e}"))?;
    // GraphQL reports query-level problems in a top-level `errors` array (HTTP 200).
    if let Some(errors) = v.get("errors").and_then(Value::as_array) {
        if !errors.is_empty() {
            let msg = errors
                .iter()
                .filter_map(|e| e.get("message").and_then(Value::as_str))
                .collect::<Vec<_>>()
                .join("; ");
            log(&format!("GraphQL errors: {msg}"));
            return Err(format!("GitHub GraphQL error: {msg}"));
        }
    }
    Ok(v)
}

#[tauri::command]
pub async fn list_inbox(app: AppHandle) -> Result<InboxData, String> {
    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;
    log("GraphQL inbox: review-requested / assigned / created / involved");
    let v = graphql(&client, INBOX_QUERY).await?;
    let data = v
        .get("data")
        .ok_or_else(|| "GraphQL response missing `data`".to_string())?;
    let inbox = InboxData {
        review_requested: bucket_from(data, "reviewRequested"),
        assigned: bucket_from(data, "assigned"),
        created: bucket_from(data, "created"),
        involved: bucket_from(data, "involved"),
    };
    log(&format!(
        "inbox counts — review:{} assigned:{} created:{} involved:{}",
        inbox.review_requested.count,
        inbox.assigned.count,
        inbox.created.count,
        inbox.involved.count
    ));
    storage::write_json(&app, "inbox.json", &inbox)?;
    Ok(inbox)
}

#[tauri::command]
pub async fn get_cached_inbox(app: AppHandle) -> Result<Option<InboxData>, String> {
    storage::read_json::<InboxData>(&app, "inbox.json")
}

// ---------------------------------------------------------------------------
// Commands: pull request detail
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_pull_request_detail(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
) -> Result<PullRequestDetail, String> {
    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;

    let pr_v = get_json(&client, &format!("{API}/repos/{owner}/{repo}/pulls/{number}")).await?;
    let pr = pr_from_pull(&pr_v, &owner, &repo);

    let files_v =
        get_all_pages(&client, &format!("{API}/repos/{owner}/{repo}/pulls/{number}/files")).await?;
    let files: Vec<ChangedFile> = files_v.iter().map(file_from).collect();

    let comments_v = get_all_pages(
        &client,
        &format!("{API}/repos/{owner}/{repo}/pulls/{number}/comments"),
    )
    .await?;
    let comments: Vec<ReviewComment> = comments_v.iter().map(comment_from).collect();

    let detail = PullRequestDetail {
        pr,
        files,
        comments,
        fetched_at: now_millis(),
    };
    log(&format!(
        "PR {owner}/{repo}#{number}: {} files, {} comments",
        detail.files.len(),
        detail.comments.len()
    ));
    storage::write_json(&app, &detail_cache_name(&owner, &repo, number), &detail)?;
    Ok(detail)
}

#[tauri::command]
pub async fn get_cached_pull_request_detail(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
) -> Result<Option<PullRequestDetail>, String> {
    storage::read_json::<PullRequestDetail>(&app, &detail_cache_name(&owner, &repo, number))
}

// ---------------------------------------------------------------------------
// Commands: comments
// ---------------------------------------------------------------------------

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn create_review_comment(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    body: String,
    commit_id: String,
    path: String,
    line: u64,
    side: String,
) -> Result<ReviewComment, String> {
    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;
    let payload = json!({
        "body": body,
        "commit_id": commit_id,
        "path": path,
        "line": line,
        "side": side,
    });
    let resp = client
        .post(format!(
            "{API}/repos/{owner}/{repo}/pulls/{number}/comments"
        ))
        .json(&payload)
        .send()
        .await
        .map_err(net_err)?;
    let v = read_body(resp).await?;
    Ok(comment_from(&v))
}

#[tauri::command]
pub async fn reply_to_review_comment(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    body: String,
    in_reply_to: u64,
) -> Result<ReviewComment, String> {
    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;
    let payload = json!({ "body": body, "in_reply_to": in_reply_to });
    let resp = client
        .post(format!(
            "{API}/repos/{owner}/{repo}/pulls/{number}/comments"
        ))
        .json(&payload)
        .send()
        .await
        .map_err(net_err)?;
    let v = read_body(resp).await?;
    Ok(comment_from(&v))
}

#[tauri::command]
pub async fn create_issue_comment(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    body: String,
) -> Result<(), String> {
    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;
    let payload = json!({ "body": body });
    let resp = client
        .post(format!(
            "{API}/repos/{owner}/{repo}/issues/{number}/comments"
        ))
        .json(&payload)
        .send()
        .await
        .map_err(net_err)?;
    read_body(resp).await?;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewCommentInput {
    pub path: String,
    pub line: u64,
    pub side: String,
    pub body: String,
}

/// Submit a pull request review (APPROVE | REQUEST_CHANGES | COMMENT) with an
/// optional body and a batch of inline comments, in one request.
#[tauri::command]
pub async fn submit_review(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    event: String,
    body: String,
    commit_id: String,
    comments: Vec<ReviewCommentInput>,
) -> Result<(), String> {
    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;
    let comment_payload: Vec<Value> = comments
        .iter()
        .map(|c| json!({ "path": c.path, "line": c.line, "side": c.side, "body": c.body }))
        .collect();
    let mut payload = json!({
        "event": event,
        "body": body,
        "comments": comment_payload,
    });
    if !commit_id.is_empty() {
        payload["commit_id"] = json!(commit_id);
    }
    let resp = client
        .post(format!(
            "{API}/repos/{owner}/{repo}/pulls/{number}/reviews"
        ))
        .json(&payload)
        .send()
        .await
        .map_err(net_err)?;
    read_body(resp).await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands: file blobs (image diffs)
// ---------------------------------------------------------------------------

/// Hard cap on blob size shipped to the webview — images beyond this are
/// better opened on GitHub than base64-encoded into the UI.
const MAX_BLOB_BYTES: usize = 20 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileBlob {
    /// Raw file bytes, base64-encoded (the frontend builds a data: URL).
    pub base64: String,
    pub size: u64,
}

/// Fetches a file's raw contents at a given ref (sha or branch). Used by the
/// image diff view to load the before/after versions of a binary file.
#[tauri::command]
pub async fn get_file_blob(
    app: AppHandle,
    owner: String,
    repo: String,
    path: String,
    r#ref: String,
) -> Result<FileBlob, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};

    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;

    // Build via Url so exotic path characters are percent-encoded safely.
    let mut u = url::Url::parse(API).map_err(|e| e.to_string())?;
    u.set_path(&format!("repos/{owner}/{repo}/contents/{path}"));
    u.query_pairs_mut().append_pair("ref", &r#ref);

    let resp = client
        .get(u)
        .header(reqwest::header::ACCEPT, "application/vnd.github.raw+json")
        .send()
        .await
        .map_err(net_err)?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.get("message").and_then(Value::as_str).map(String::from))
            .unwrap_or(text);
        return Err(format!("GitHub API error ({}): {}", status.as_u16(), msg));
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

// ---------------------------------------------------------------------------
// Commands: viewed-file state (local only)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_viewed_map(app: AppHandle) -> Result<Value, String> {
    Ok(storage::read_json::<Value>(&app, "viewed.json")?.unwrap_or_else(|| json!({})))
}

#[tauri::command]
pub async fn set_viewed_map(app: AppHandle, map: Value) -> Result<(), String> {
    storage::write_json(&app, "viewed.json", &map)
}
