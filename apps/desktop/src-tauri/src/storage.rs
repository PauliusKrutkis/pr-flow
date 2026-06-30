//! Local persistence: PR metadata cache, per-PR detail cache, viewed-file
//! state and the GitHub token are all stored as plain JSON files inside the
//! application config directory. No SQLite, no server — just files, per the
//! MVP spec.

use std::fs;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Serialize;
use tauri::{AppHandle, Manager};

const TOKEN_FILE: &str = "token.json";

/// Returns the app config directory, creating it if necessary.
pub fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("could not resolve config dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("could not create config dir: {e}"))?;
    Ok(dir)
}

/// Reads and deserializes a JSON file from the config dir. Returns `None` when
/// the file does not exist yet.
pub fn read_json<T: DeserializeOwned>(app: &AppHandle, name: &str) -> Result<Option<T>, String> {
    let path = config_dir(app)?.join(name);
    if !path.exists() {
        return Ok(None);
    }
    let data = fs::read_to_string(&path).map_err(|e| format!("could not read {name}: {e}"))?;
    if data.trim().is_empty() {
        return Ok(None);
    }
    let value =
        serde_json::from_str::<T>(&data).map_err(|e| format!("could not parse {name}: {e}"))?;
    Ok(Some(value))
}

/// Serializes a value as pretty JSON and writes it to the config dir.
pub fn write_json<T: Serialize>(app: &AppHandle, name: &str, value: &T) -> Result<(), String> {
    let path = config_dir(app)?.join(name);
    let data =
        serde_json::to_string_pretty(value).map_err(|e| format!("could not encode {name}: {e}"))?;
    fs::write(&path, data).map_err(|e| format!("could not write {name}: {e}"))?;
    Ok(())
}

/// Removes a JSON file from the config dir (no error if it is already gone).
pub fn remove_file(app: &AppHandle, name: &str) -> Result<(), String> {
    let path = config_dir(app)?.join(name);
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("could not remove {name}: {e}"))?;
    }
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct TokenFile {
    token: String,
}

/// Reads the stored GitHub token, if any.
pub fn read_token(app: &AppHandle) -> Result<Option<String>, String> {
    Ok(read_json::<TokenFile>(app, TOKEN_FILE)?.map(|t| t.token))
}

/// Persists the GitHub token.
pub fn write_token(app: &AppHandle, token: &str) -> Result<(), String> {
    write_json(
        app,
        TOKEN_FILE,
        &TokenFile {
            token: token.to_string(),
        },
    )
}

/// Deletes the stored token.
pub fn clear_token(app: &AppHandle) -> Result<(), String> {
    remove_file(app, TOKEN_FILE)
}
