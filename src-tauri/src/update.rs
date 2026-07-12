//! Auto-update via `tauri-plugin-updater`. Like every other backend command,
//! the webview calls these thin wrappers; the download, signature verification
//! and install happen in Rust.
//!
//! SCAFFOLD: `plugins.updater` in `tauri.conf.json` currently holds placeholder
//! `endpoints` + `pubkey`, and release bundles aren't signed yet. Until a real
//! signing key and release feed exist (see the "Auto-updates" section in the
//! README), `check_for_update` is best-effort and simply reports "no update"
//! rather than surfacing configuration errors to the user.

use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    /// The version available on the release feed.
    pub version: String,
    /// The version currently running.
    pub current_version: String,
    /// Release notes, if the feed provides them.
    pub notes: Option<String>,
}

/// Check the configured endpoint for a newer signed release. Returns `None`
/// when already up to date — or when the updater isn't configured / the feed
/// is unreachable, so a half-set-up scaffold never nags the user with errors.
#[tauri::command]
pub async fn check_for_update(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = match app.updater() {
        Ok(updater) => updater,
        Err(_) => return Ok(None), // not configured yet
    };
    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version.clone(),
            current_version: update.current_version.clone(),
            notes: update.body.clone(),
        })),
        Ok(None) => Ok(None),
        Err(_) => Ok(None), // unreachable feed / placeholder config → stay quiet
    }
}

/// The running app version, for the "what's new after an update" card to
/// compare against the last version it saw.
#[tauri::command]
pub fn get_app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseInfo {
    /// The git tag, e.g. `v0.2.0`.
    pub tag: String,
    /// ISO-8601 publish timestamp.
    pub published_at: Option<String>,
    /// The release body (markdown), if any.
    pub notes: Option<String>,
}

/// Version releases on this app's public GitHub repo, newest first — one call
/// serves both the what's-new card and the release-history view. Drafts,
/// prereleases and non-version tags (the `pr-evidence` asset host) are
/// filtered out. Best-effort like the updater: any failure (offline, rate
/// limit) returns `None` so callers can stay quiet rather than surface errors.
/// No token — releases are public.
#[tauri::command]
pub async fn list_releases() -> Result<Option<Vec<ReleaseInfo>>, String> {
    let url = "https://api.github.com/repos/PauliusKrutkis/pr-flow/releases?per_page=30";
    let client = match reqwest::Client::builder().user_agent("pr-flow").build() {
        Ok(client) => client,
        Err(_) => return Ok(None),
    };
    let resp = match client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
    {
        Ok(resp) if resp.status().is_success() => resp,
        _ => return Ok(None),
    };
    let values: Vec<serde_json::Value> = match resp.json().await {
        Ok(values) => values,
        Err(_) => return Ok(None),
    };
    let releases = values
        .iter()
        .filter(|v| {
            let flagged = |key| v.get(key).and_then(serde_json::Value::as_bool) == Some(true);
            !flagged("draft") && !flagged("prerelease")
        })
        .filter_map(|v| {
            let tag = v.get("tag_name").and_then(serde_json::Value::as_str)?;
            let rest = tag.strip_prefix('v')?;
            if !rest.starts_with(|c: char| c.is_ascii_digit()) {
                return None;
            }
            let text = |key| {
                v.get(key)
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .map(String::from)
            };
            Some(ReleaseInfo {
                tag: tag.to_string(),
                published_at: text("published_at"),
                notes: text("body"),
            })
        })
        .collect();
    Ok(Some(releases))
}

/// Download + install the available update (verifying its signature against the
/// configured public key), then relaunch into the new version. Surfaces real
/// errors here because the user explicitly opted in by pressing "Install".
#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;
    update
        .download_and_install(|_chunk_len, _content_len| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}
