//! Tauri data commands. Each resolves the active account, dispatches to its
//! platform, and namespaces the on-disk caches per account so switching never
//! bleeds one host's data into another.

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::accounts;
use crate::model::{
    FileBlob, GitHubUser, InboxBucket, InboxData, PullRequestDetail, RepoHit, ReviewComment,
    ReviewCommentInput,
};
use crate::storage;

fn inbox_cache_name(account_id: &str) -> String {
    format!("inbox_{account_id}.json")
}

fn cache_path_segment(segment: &str) -> String {
    segment.replace(['/', '\\'], "_")
}

fn detail_cache_name(account_id: &str, owner: &str, repo: &str, number: u64) -> String {
    format!(
        "pr_{}_{}_{}_{}.json",
        cache_path_segment(account_id),
        cache_path_segment(owner),
        cache_path_segment(repo),
        number
    )
}

fn viewed_name(account_id: &str) -> String {
    format!("viewed_{account_id}.json")
}

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

/// Watched repositories ("Watching" tab).
fn watched_name(account_id: &str) -> String {
    format!("watched_{account_id}.json")
}
fn subscribed_cache_name(account_id: &str) -> String {
    format!("subscribed_{account_id}.json")
}

#[tauri::command]
pub async fn get_watched_repos(app: AppHandle) -> Result<Vec<String>, String> {
    let account = accounts::active_account(&app).await?;
    Ok(storage::read_json::<Vec<String>>(&app, &watched_name(&account.id))?.unwrap_or_default())
}

#[tauri::command]
pub async fn set_watched_repos(app: AppHandle, repos: Vec<String>) -> Result<(), String> {
    let account = accounts::active_account(&app).await?;
    let cleaned: Vec<String> = repos
        .into_iter()
        .map(|r| r.trim().trim_matches('/').to_string())
        .filter(|r| r.contains('/') && !r.is_empty())
        .collect();
    storage::write_json(&app, &watched_name(&account.id), &cleaned)
}

#[tauri::command]
pub async fn search_repos(app: AppHandle, query: String) -> Result<Vec<RepoHit>, String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform.search_repos(&query).await
}

#[tauri::command]
pub async fn list_subscribed(app: AppHandle) -> Result<InboxBucket, String> {
    let (account, platform) = accounts::active_platform(&app).await?;
    let repos =
        storage::read_json::<Vec<String>>(&app, &watched_name(&account.id))?.unwrap_or_default();
    let bucket = platform.subscribed_prs(&repos).await?;
    storage::write_json(&app, &subscribed_cache_name(&account.id), &bucket)?;
    Ok(bucket)
}

#[tauri::command]
pub async fn get_cached_subscribed(app: AppHandle) -> Result<Option<InboxBucket>, String> {
    let account = accounts::active_account(&app).await?;
    storage::read_json::<InboxBucket>(&app, &subscribed_cache_name(&account.id))
}

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
    start_line: Option<u64>,
) -> Result<ReviewComment, String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .create_review_comment(
            &owner, &repo, number, &body, &commit_id, &path, line, &side, start_line,
        )
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

/// Edit an inline review comment's body. Gated in the UI to the signed-in
/// user's own comments; the hosts reject foreign ids anyway.
#[tauri::command]
pub async fn update_review_comment(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    comment_id: u64,
    body: String,
) -> Result<(), String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .update_review_comment(&owner, &repo, number, comment_id, &body)
        .await
}

/// Delete an inline review comment. Gated in the UI to the signed-in user's
/// own comments behind a two-step confirm.
#[tauri::command]
pub async fn delete_review_comment(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    comment_id: u64,
) -> Result<(), String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .delete_review_comment(&owner, &repo, number, comment_id)
        .await
}

/// Resolve / unresolve an inline review thread. `thread_id` is the provider's
/// thread handle carried on ReviewComment (GraphQL node id / discussion id).
#[tauri::command]
pub async fn resolve_thread(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    thread_id: String,
    resolved: bool,
) -> Result<(), String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .resolve_thread(&owner, &repo, number, &thread_id, resolved)
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

/// Edit a PR-level (conversation) comment's body. Gated in the UI to the
/// signed-in user's own comments.
#[tauri::command]
pub async fn update_issue_comment(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    comment_id: u64,
    body: String,
) -> Result<(), String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .update_issue_comment(&owner, &repo, number, comment_id, &body)
        .await
}

/// Delete a PR-level (conversation) comment. Gated in the UI to the
/// signed-in user's own comments behind a two-step confirm.
#[tauri::command]
pub async fn delete_issue_comment(
    app: AppHandle,
    owner: String,
    repo: String,
    number: u64,
    comment_id: u64,
) -> Result<(), String> {
    let (_, platform) = accounts::active_platform(&app).await?;
    platform
        .delete_issue_comment(&owner, &repo, number, comment_id)
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

#[tauri::command]
pub async fn get_viewed_map(app: AppHandle) -> Result<Value, String> {
    let account = accounts::active_account(&app).await?;
    if let Some(v) = storage::read_json::<Value>(&app, &viewed_name(&account.id))? {
        return Ok(v);
    }
    Ok(storage::read_json::<Value>(&app, "viewed.json")?.unwrap_or_else(|| json!({})))
}

#[tauri::command]
pub async fn set_viewed_map(app: AppHandle, map: Value) -> Result<(), String> {
    let account = accounts::active_account(&app).await?;
    storage::write_json(&app, &viewed_name(&account.id), &map)
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
