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

fn owner_repo_from_repository_url(url: &str) -> (String, String) {
    // Shape: https://api.github.com/repos/{owner}/{repo}
    let mut parts = url.rsplit('/');
    let repo = parts.next().unwrap_or_default().to_string();
    let owner = parts.next().unwrap_or_default().to_string();
    (owner, repo)
}

fn detail_cache_name(owner: &str, repo: &str, number: u64) -> String {
    format!("pr_{owner}_{repo}_{number}.json")
}

// ---------------------------------------------------------------------------
// Mappers: GitHub JSON -> our structs
// ---------------------------------------------------------------------------

/// Maps a `/search/issues` result item (limited fields) into a `PullRequest`.
fn pr_from_search(v: &Value) -> PullRequest {
    let repo_url = fstr(v, "repository_url");
    let (owner, name) = owner_repo_from_repository_url(&repo_url);
    PullRequest {
        id: fu64(v, "id"),
        number: fu64(v, "number"),
        title: fstr(v, "title"),
        repo: format!("{owner}/{name}"),
        owner,
        name,
        author: nstr(v, "user", "login"),
        author_avatar_url: nstr(v, "user", "avatar_url"),
        url: fstr(v, "html_url"),
        state: fstr(v, "state"),
        draft: fbool(v, "draft"),
        merged: false,
        updated_at: fstr(v, "updated_at"),
        created_at: fstr(v, "created_at"),
        comments_count: fu64(v, "comments"),
        head_sha: String::new(),
        additions: 0,
        deletions: 0,
        changed_files: 0,
        body: fstr(v, "body"),
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

fn build_client(token: &str) -> Result<reqwest::Client, String> {
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

async fn fetch_user(client: &reqwest::Client) -> Result<GitHubUser, String> {
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

#[tauri::command]
pub async fn list_review_requested(app: AppHandle) -> Result<Vec<PullRequest>, String> {
    let token = token_or_err(&app).await?;
    let client = build_client(&token)?;
    let resp = client
        .get(format!("{API}/search/issues"))
        .query(&[
            ("q", "is:open is:pr review-requested:@me archived:false"),
            ("sort", "updated"),
            ("order", "desc"),
            ("per_page", "50"),
        ])
        .send()
        .await
        .map_err(net_err)?;
    let body = read_body(resp).await?;
    let items = body
        .get("items")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let prs: Vec<PullRequest> = items.iter().map(pr_from_search).collect();
    storage::write_json(&app, "prs.json", &prs)?;
    Ok(prs)
}

#[tauri::command]
pub async fn get_cached_prs(app: AppHandle) -> Result<Vec<PullRequest>, String> {
    Ok(storage::read_json::<Vec<PullRequest>>(&app, "prs.json")?.unwrap_or_default())
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
