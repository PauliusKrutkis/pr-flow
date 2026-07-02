//! "Sign in with GitHub" via the OAuth authorization-code flow with a loopback
//! redirect (RFC 8252 style). The app opens the browser to GitHub's authorize
//! page, runs a one-shot `http://127.0.0.1` listener to catch the redirect,
//! exchanges the `code` for an access token, validates it, and stores it — so
//! the only thing the user does is log in once in the browser.
//!
//! Credentials come from the environment (kept out of the repo):
//!   PRFLOW_GH_CLIENT_ID, PRFLOW_GH_CLIENT_SECRET

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::accounts;
use crate::github::{build_client, fetch_user, GitHubUser};

const OAUTH_PORT: u16 = 8765;
const REDIRECT_URI: &str = "http://127.0.0.1:8765/callback";
const SCOPE: &str = "repo read:org";

fn oauth_credentials() -> Result<(String, String), String> {
    let id = std::env::var("PRFLOW_GH_CLIENT_ID").unwrap_or_default();
    let secret = std::env::var("PRFLOW_GH_CLIENT_SECRET").unwrap_or_default();
    if id.trim().is_empty() || secret.trim().is_empty() {
        return Err(
            "GitHub sign-in isn't configured. Set PRFLOW_GH_CLIENT_ID and \
             PRFLOW_GH_CLIENT_SECRET and restart (see README → Sign in with GitHub). \
             You can still paste a token instead."
                .to_string(),
        );
    }
    Ok((id.trim().to_string(), secret.trim().to_string()))
}

/// Whether the "Sign in with GitHub" button should be offered.
#[tauri::command]
pub fn is_oauth_configured() -> bool {
    oauth_credentials().is_ok()
}

fn make_state() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

#[tauri::command]
pub async fn login_with_github(app: AppHandle) -> Result<GitHubUser, String> {
    let (client_id, client_secret) = oauth_credentials()?;
    let state = make_state();

    // Bind the loopback listener BEFORE opening the browser so the redirect
    // never races a closed port.
    let listener = TcpListener::bind(("127.0.0.1", OAUTH_PORT)).map_err(|e| {
        format!("Couldn't start the local sign-in listener on port {OAUTH_PORT}: {e}")
    })?;

    let mut authorize = url::Url::parse("https://github.com/login/oauth/authorize")
        .map_err(|e| e.to_string())?;
    authorize
        .query_pairs_mut()
        .append_pair("client_id", &client_id)
        .append_pair("redirect_uri", REDIRECT_URI)
        .append_pair("scope", SCOPE)
        .append_pair("state", &state);
    open_in_browser(authorize.as_str())?;

    // Wait for the redirect on a blocking thread so we don't stall the runtime.
    let wait_state = state.clone();
    let code = tokio::task::spawn_blocking(move || wait_for_code(listener, &wait_state))
        .await
        .map_err(|e| format!("sign-in task failed: {e}"))??;

    let token = exchange_code(&client_id, &client_secret, &code, &state).await?;
    let client = build_client(&token)?;
    let user = fetch_user(&client).await?;
    accounts::upsert_github(&app, &token, &user.login, &user.avatar_url)?;

    // Bring the app back to the front — the user just finished in the browser,
    // so the handoff should land them straight in PR Flow.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
    Ok(user)
}

fn open_in_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let program = "xdg-open";

    std::process::Command::new(program)
        .arg(url)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("couldn't open the browser: {e}"))
}

async fn exchange_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
    state: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::USER_AGENT, "pr-flow")
        .json(&json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
            "redirect_uri": REDIRECT_URI,
            "state": state,
        }))
        .send()
        .await
        .map_err(|e| format!("token exchange failed: {e}"))?;

    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("token exchange parse failed: {e}"))?;

    if let Some(err) = v.get("error_description").and_then(Value::as_str) {
        return Err(format!("GitHub: {err}"));
    }
    v.get("access_token")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .ok_or_else(|| "GitHub did not return an access token".to_string())
}

fn wait_for_code(listener: TcpListener, expected_state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);

    loop {
        if Instant::now() > deadline {
            return Err("Sign-in timed out. Please try again.".to_string());
        }
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream.set_nonblocking(false).ok();
                match handle_connection(&mut stream, expected_state) {
                    Ok(Some(code)) => return Ok(code),
                    // Not the callback (e.g. a favicon request) — keep waiting.
                    Ok(None) => continue,
                    Err(e) => return Err(e),
                }
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(format!("local sign-in server error: {e}")),
        }
    }
}

fn handle_connection(
    stream: &mut TcpStream,
    expected_state: &str,
) -> Result<Option<String>, String> {
    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).map_err(|e| e.to_string())?;
    let req = String::from_utf8_lossy(&buf[..n]);
    let first_line = req.lines().next().unwrap_or("");
    // "GET /callback?code=...&state=... HTTP/1.1"
    let path = first_line.split_whitespace().nth(1).unwrap_or("");

    if !path.starts_with("/callback") {
        write_response(stream, "404 Not Found", &page("Not found."));
        return Ok(None);
    }

    let parsed = url::Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
    let mut code: Option<String> = None;
    let mut got_state: Option<String> = None;
    let mut error: Option<String> = None;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.into_owned()),
            "state" => got_state = Some(v.into_owned()),
            "error_description" => error = Some(v.into_owned()),
            "error" => {
                if error.is_none() {
                    error = Some(v.into_owned());
                }
            }
            _ => {}
        }
    }

    if let Some(e) = error {
        write_response(stream, "200 OK", &page("Sign-in was cancelled or failed."));
        return Err(format!("GitHub sign-in error: {e}"));
    }
    if got_state.as_deref() != Some(expected_state) {
        write_response(stream, "400 Bad Request", &page("Sign-in failed: state mismatch."));
        return Err("Sign-in failed: state mismatch (possible CSRF). Please try again.".to_string());
    }
    match code {
        Some(c) => {
            write_response(
                stream,
                "200 OK",
                &success_page("Signed in! Sending you back to Nod…"),
            );
            Ok(Some(c))
        }
        None => {
            write_response(stream, "400 Bad Request", &page("Sign-in failed: no code returned."));
            Err("GitHub did not return an authorization code.".to_string())
        }
    }
}

fn write_response(stream: &mut TcpStream, status: &str, body_html: &str) {
    let body = body_html.as_bytes();
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(body);
    let _ = stream.flush();
}

fn page(message: &str) -> String {
    page_with_script(message, "")
}

/// Success page: tries to close the tab (browsers only honor this in some
/// cases, e.g. Chrome tabs opened by an app); the app window is refocused from
/// Rust either way, so the fallback copy still reads correctly.
fn success_page(message: &str) -> String {
    page_with_script(
        message,
        "<script>setTimeout(function(){window.open('','_self');window.close();},300)</script>",
    )
}

fn page_with_script(message: &str, script: &str) -> String {
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Nod</title></head>\
         <body style=\"font-family:-apple-system,system-ui,sans-serif;background:#0d1117;\
         color:#e6edf3;display:flex;align-items:center;justify-content:center;height:100vh;margin:0\">\
         <div style=\"text-align:center\"><h2 style=\"margin:0 0 8px;color:#2f81f7\">Nod</h2>\
         <p>{message}</p><p style=\"color:#8b949e;font-size:13px\">You can close this tab.</p></div>\
         {script}</body></html>"
    )
}
