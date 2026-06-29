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
