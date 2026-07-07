//! Multi-account support. Accounts (provider + host + token + identity) live
//! in `accounts.json`; exactly one is active at a time and every data command
//! routes through the active account's platform. A legacy single-token
//! install (`token.json`) is migrated to a GitHub account on first load.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::github::GitHubPlatform;
use crate::gitlab::GitLabPlatform;
use crate::platform::AnyPlatform;
use crate::storage;

pub const GITHUB_HOST: &str = "https://github.com";
pub const GITLAB_HOST: &str = "https://gitlab.com";
const ACCOUNTS_FILE: &str = "accounts.json";

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// "github" | "gitlab"
    pub provider: String,
    /// Web host, e.g. "https://github.com" or a self-managed GitLab base URL.
    pub host: String,
    pub token: String,
    pub login: String,
    #[serde(default)]
    pub avatar_url: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountsFile {
    pub accounts: Vec<Account>,
    pub active_id: Option<String>,
}

/// Token-free view of an account, safe to ship to the webview.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub id: String,
    pub provider: String,
    pub host: String,
    pub login: String,
    pub avatar_url: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AccountsInfo {
    pub accounts: Vec<AccountInfo>,
    pub active_id: Option<String>,
}

fn info_of(a: &Account) -> AccountInfo {
    AccountInfo {
        id: a.id.clone(),
        provider: a.provider.clone(),
        host: a.host.clone(),
        login: a.login.clone(),
        avatar_url: a.avatar_url.clone(),
    }
}

fn info_file(f: &AccountsFile) -> AccountsInfo {
    AccountsInfo {
        accounts: f.accounts.iter().map(info_of).collect(),
        active_id: f.active_id.clone(),
    }
}

/// Filesystem-safe, deterministic account id.
pub fn account_id(provider: &str, host: &str, login: &str) -> String {
    let raw = format!("{provider}-{host}-{login}");
    let mut out = String::with_capacity(raw.len());
    let mut dash = false;
    for c in raw.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').to_string()
}

fn normalize_host(provider: &str, host: Option<String>) -> String {
    let default = match provider {
        "gitlab" => GITLAB_HOST,
        _ => GITHUB_HOST,
    };
    let h = host.unwrap_or_default();
    let h = h.trim().trim_end_matches('/');
    if h.is_empty() {
        return default.to_string();
    }
    if h.starts_with("http://") || h.starts_with("https://") {
        h.to_string()
    } else {
        format!("https://{h}")
    }
}

pub fn load(app: &AppHandle) -> Result<AccountsFile, String> {
    Ok(storage::read_json::<AccountsFile>(app, ACCOUNTS_FILE)?.unwrap_or_default())
}

pub fn save(app: &AppHandle, file: &AccountsFile) -> Result<(), String> {
    storage::write_json(app, ACCOUNTS_FILE, file)
}

pub fn platform_for(account: &Account) -> Result<AnyPlatform, String> {
    match account.provider.as_str() {
        "github" => Ok(AnyPlatform::GitHub(GitHubPlatform::new(&account.token)?)),
        "gitlab" => Ok(AnyPlatform::GitLab(GitLabPlatform::new(
            &account.host,
            &account.token,
        )?)),
        other => Err(format!("Unknown provider: {other}")),
    }
}

/// Loads the accounts file, migrating a legacy `token.json` (single GitHub
/// token) into a first-class account on first run.
pub async fn load_migrated(app: &AppHandle) -> Result<AccountsFile, String> {
    let mut file = load(app)?;
    if file.accounts.is_empty() {
        if let Some(token) = storage::read_token(app)? {
            let (login, avatar_url) = match GitHubPlatform::new(&token) {
                Ok(p) => match p.current_user().await {
                    Ok(u) => (u.login, u.avatar_url),
                    Err(_) => ("github".to_string(), String::new()),
                },
                Err(_) => ("github".to_string(), String::new()),
            };
            let id = account_id("github", GITHUB_HOST, &login);
            file.accounts.push(Account {
                id: id.clone(),
                provider: "github".to_string(),
                host: GITHUB_HOST.to_string(),
                token,
                login,
                avatar_url,
            });
            file.active_id = Some(id);
            save(app, &file)?;
            let _ = storage::clear_token(app);
        }
    }
    if file.active_id.is_none() {
        file.active_id = file.accounts.first().map(|a| a.id.clone());
    }
    Ok(file)
}

pub async fn active_account(app: &AppHandle) -> Result<Account, String> {
    let file = load_migrated(app).await?;
    let id = file
        .active_id
        .clone()
        .ok_or_else(|| "No account configured".to_string())?;
    file.accounts
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| "Active account not found".to_string())
}

pub async fn active_platform(app: &AppHandle) -> Result<(Account, AnyPlatform), String> {
    let account = active_account(app).await?;
    let platform = platform_for(&account)?;
    Ok((account, platform))
}

/// Inserts or replaces an account (by id) and optionally makes it active.
pub fn upsert(app: &AppHandle, account: Account, make_active: bool) -> Result<(), String> {
    let mut file = load(app)?;
    if let Some(existing) = file.accounts.iter_mut().find(|a| a.id == account.id) {
        *existing = account.clone();
    } else {
        file.accounts.push(account.clone());
    }
    if make_active || file.active_id.is_none() {
        file.active_id = Some(account.id);
    }
    save(app, &file)
}

/// Used by the GitHub OAuth flow after a successful sign-in.
pub fn upsert_github(
    app: &AppHandle,
    token: &str,
    login: &str,
    avatar_url: &str,
) -> Result<(), String> {
    upsert(
        app,
        Account {
            id: account_id("github", GITHUB_HOST, login),
            provider: "github".to_string(),
            host: GITHUB_HOST.to_string(),
            token: token.to_string(),
            login: login.to_string(),
            avatar_url: avatar_url.to_string(),
        },
        true,
    )
}

#[tauri::command]
pub async fn list_accounts(app: AppHandle) -> Result<AccountsInfo, String> {
    Ok(info_file(&load_migrated(&app).await?))
}

#[tauri::command]
pub async fn add_account(
    app: AppHandle,
    provider: String,
    host: Option<String>,
    token: String,
) -> Result<AccountInfo, String> {
    let token = token.trim().to_string();
    if token.is_empty() {
        return Err("Token is empty".to_string());
    }
    let host = normalize_host(&provider, host);
    /// Validate before persisting so we never store a bad token.
    let probe = Account {
        id: String::new(),
        provider: provider.clone(),
        host: host.clone(),
        token: token.clone(),
        login: String::new(),
        avatar_url: String::new(),
    };
    let platform = platform_for(&probe)?;
    let user = platform.current_user().await?;
    let account = Account {
        id: account_id(&provider, &host, &user.login),
        provider,
        host,
        token,
        login: user.login.clone(),
        avatar_url: user.avatar_url.clone(),
    };
    let info = info_of(&account);
    upsert(&app, account, true)?;
    Ok(info)
}

#[tauri::command]
pub async fn set_active_account(app: AppHandle, id: String) -> Result<(), String> {
    let mut file = load_migrated(&app).await?;
    if !file.accounts.iter().any(|a| a.id == id) {
        return Err("Account not found".to_string());
    }
    file.active_id = Some(id);
    save(&app, &file)
}

#[tauri::command]
pub async fn remove_account(app: AppHandle, id: String) -> Result<AccountsInfo, String> {
    let mut file = load_migrated(&app).await?;
    file.accounts.retain(|a| a.id != id);
    if file.active_id.as_deref() == Some(id.as_str()) {
        file.active_id = file.accounts.first().map(|a| a.id.clone());
    }
    save(&app, &file)?;
    Ok(info_file(&file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_ids_are_filesystem_safe_and_deterministic() {
        let id = account_id("gitlab", "https://gitlab.acme.dev", "paulius.k");
        assert_eq!(id, "gitlab-https-gitlab-acme-dev-paulius-k");
        assert_eq!(id, account_id("gitlab", "https://gitlab.acme.dev", "paulius.k"));
    }

    #[test]
    fn hosts_normalize() {
        assert_eq!(normalize_host("github", None), GITHUB_HOST);
        assert_eq!(normalize_host("gitlab", None), GITLAB_HOST);
        assert_eq!(
            normalize_host("gitlab", Some("gitlab.acme.dev/".into())),
            "https://gitlab.acme.dev"
        );
        assert_eq!(
            normalize_host("gitlab", Some("http://internal:8080".into())),
            "http://internal:8080"
        );
        assert_eq!(normalize_host("gitlab", Some("  ".into())), GITLAB_HOST);
    }
}
