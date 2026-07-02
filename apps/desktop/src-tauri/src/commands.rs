//! Tauri data commands. Each resolves the active account, dispatches to its
//! platform, and namespaces the on-disk caches per account so switching never
//! bleeds one host's data into another.

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::accounts;
use crate::github::{
    FileBlob, GitHubUser, InboxData, PullRequestDetail, ReviewComment, ReviewCommentInput,
};
use crate::storage;

fn inbox_cache_name(account_id: &str) -> String {
    format!("inbox_{account_id}.json")
}

fn detail_cache_name(account_id: &str, owner: &str, repo: &str, number: u64) -> String {
    let safe_owner = owner.replace(['/', '\\'], "_");
    format!("pr_{account_id}_{safe_owner}_{repo}_{number}.json")
}

fn viewed_name(account_id: &str) -> String {
    format!("viewed_{account_id}.json")
}

// ---------------------------------------------------------------------------
// Auth-ish commands (kept under their historical names for the frontend)
// ---------------------------------------------------------------------------

/// "Is the app signed in at all?" — true when any account exists (migrating a
/// legacy single-token install on the way).
#[tauri::command]
pub async fn has_token(app: AppHandle) -> Result<bool, String> {
    Ok(!accounts::load_migrated(&app).await?.accounts.is_empty())
}

/// Legacy entry point (token paste): adds a github.com account.
#[tauri::command]
pub async fn set_token(app: AppHandle, token: String) -> Result<GitHubUser, String> {
    let info = accounts::add_account(app, "github".to_string(), None, token).await?;
    Ok(GitHubUser {
        login: info.login,
        avatar_url: info.avatar_url,
        name: String::new(),
    })
}

/// Signs the active account out.
#[tauri::command]
pub async fn clear_token(app: AppHandle) -> Result<(), String> {
    let file = accounts::load_migrated(&app).await?;
    if let Some(id) = file.active_id {
        accounts::remove_account(app, id).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn get_current_user(app: AppHandle) -> Result<GitHubUser, String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform.current_user().await
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn list_inbox(app: AppHandle) -> Result<InboxData, String> {
    let (account, platform) = accounts::active_platform(&app).await?;
    let inbox = platform.inbox().await?;
    storage::write_json(&app, &inbox_cache_name(&account.id), &inbox)?;
    Ok(inbox)
}

#[tauri::command]
pub async fn get_cached_inbox(app: AppHandle) -> Result<Option<InboxData>, String> {
    let account = accounts::active_account(&app).await?;
    storage::read_json::<InboxData>(&app, &inbox_cache_name(&account.id))
}

// ---------------------------------------------------------------------------
// Pull request detail
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_pull_request_detail(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
) -> Result<PullRequestDetail, String> {
    let (account, platform) = accounts::active_platform(&app).await?;
    let detail = platform.pr_detail(&owner, &repo, number).await?;
    storage::write_json(
        &app,
        &detail_cache_name(&account.id, &owner, &repo, number),
        &detail,
    )?;
    Ok(detail)
}

#[tauri::command]
pub async fn get_cached_pull_request_detail(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
) -> Result<Option<PullRequestDetail>, String> {
    let account = accounts::active_account(&app).await?;
    storage::read_json::<PullRequestDetail>(
        &app,
        &detail_cache_name(&account.id, &owner, &repo, number),
    )
}

// ---------------------------------------------------------------------------
// Comments & reviews
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
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .create_review_comment(&owner, &repo, number, &body, &commit_id, &path, line, &side)
        .await
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
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .reply_to_review_comment(&owner, &repo, number, &body, in_reply_to)
        .await
}

#[tauri::command]
pub async fn create_issue_comment(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    body: String,
) -> Result<(), String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .create_issue_comment(&owner, &repo, number, &body)
        .await
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
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
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .submit_review(&owner, &repo, number, &event, &body, &commit_id, &comments)
        .await
}

// ---------------------------------------------------------------------------
// File blobs (image diffs)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_file_blob(
    app: AppHandle,
    owner: String,
    repo: String,
    path: String,
    r#ref: String,
) -> Result<FileBlob, String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform.file_blob(&owner, &repo, &path, &r#ref).await
}

// ---------------------------------------------------------------------------
// Viewed-file state (local only, per account)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn get_viewed_map(app: AppHandle) -> Result<Value, String> {
    let account = accounts::active_account(&app).await?;
    if let Some(v) = storage::read_json::<Value>(&app, &viewed_name(&account.id))? {
        return Ok(v);
    }
    // Pre-multi-account installs kept one global viewed.json — fall back to it
    // (reads only; writes go to the namespaced file).
    Ok(storage::read_json::<Value>(&app, "viewed.json")?.unwrap_or_else(|| json!({})))
}

#[tauri::command]
pub async fn set_viewed_map(app: AppHandle, map: Value) -> Result<(), String> {
    let account = accounts::active_account(&app).await?;
    storage::write_json(&app, &viewed_name(&account.id), &map)
}
