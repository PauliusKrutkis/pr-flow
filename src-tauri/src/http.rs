//! Shared reqwest helpers used by every platform adapter: JSON field
//! extraction, response-body parsing, pagination, and an in-memory ETag
//! cache for conditional GETs. Nothing here assumes a particular host.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::model::{FileBlob, MAX_BLOB_BYTES};

pub(crate) fn fstr(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn fu64(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}

pub(crate) fn fbool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(Value::as_bool).unwrap_or(false)
}

pub(crate) fn fopt_u64(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}

pub(crate) fn fopt_str(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
}

pub(crate) fn nstr(v: &Value, parent: &str, key: &str) -> String {
    v.get(parent)
        .and_then(|p| p.get(key))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

pub(crate) fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn net_err(e: reqwest::Error) -> String {
    format!("network error: {e}")
}

/// Lightweight stderr logging — shows up in the `tauri dev` terminal.
pub(crate) fn log(msg: &str) {
    eprintln!("[pr-flow] {msg}");
}

/// Reads a response body, turning non-2xx responses into a friendly error that
/// surfaces the host's own `message` field when present.
pub(crate) async fn read_body(resp: reqwest::Response) -> Result<Value, String> {
    let status = resp.status();
    let text = resp.text().await.map_err(net_err)?;
    if !status.is_success() {
        let parsed = serde_json::from_str::<Value>(&text).ok();
        let mut msg = parsed
            .as_ref()
            .and_then(|v| v.get("message").and_then(Value::as_str))
            .map(|s| s.to_string())
            .unwrap_or_else(|| text.clone());
        if let Some(errors) = parsed.as_ref().and_then(|v| v.get("errors")) {
            if !errors.is_null() {
                msg = format!("{msg} — {errors}");
            }
        }
        log(&format!("API error {}: {}", status.as_u16(), msg));
        return Err(format!("API error ({}): {}", status.as_u16(), msg));
    }
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("could not parse response: {e}"))
}

/// One cached conditional GET: the `ETag` we last saw plus the body that came
/// with it. Kept in-memory only — the process is long-lived, so we don't need
/// to persist it (the on-disk cache in RUST.md already covers cold starts).
#[derive(Clone)]
struct CachedResponse {
    etag: String,
    body: Value,
}

/// Process-wide ETag cache, keyed by full request URL. Because the token is
/// baked into each account's `reqwest::Client` and account switches change the
/// active client, the URL alone is a safe key: a 304 is only ever returned for
/// the same resource the caller is authorised to see.
fn etag_cache() -> &'static Mutex<HashMap<String, CachedResponse>> {
    static CACHE: OnceLock<Mutex<HashMap<String, CachedResponse>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Outcome of a conditional GET, decided purely from inputs so it can be unit
/// tested without a network. `Cached` means serve the stored body (a 304);
/// `Fresh` means a new body arrived and, if it carried an `ETag`, we should
/// remember it for next time.
#[derive(Debug, PartialEq)]
enum Conditional {
    Cached(Value),
    Fresh { body: Value, etag: Option<String> },
}

/// Pure decision core for a conditional GET. Given what we had cached and the
/// response we just received, decide whether to serve the cache or the fresh
/// body. Anything that isn't a clean 304-with-a-cached-body is treated as
/// fresh, so a stale/missing cache can never wedge the request.
fn resolve_conditional(
    status: u16,
    resp_etag: Option<&str>,
    cached: Option<&CachedResponse>,
    fresh_body: Value,
) -> Conditional {
    if status == 304 {
        if let Some(hit) = cached {
            return Conditional::Cached(hit.body.clone());
        }
    }
    Conditional::Fresh {
        body: fresh_body,
        etag: resp_etag.filter(|e| !e.is_empty()).map(str::to_string),
    }
}

/// Conditional GET: sends `If-None-Match` when we hold an `ETag` for the URL.
/// GitHub (and GitLab) answer `304 Not Modified` without spending rate limit
/// when nothing changed, letting the inbox poll far more often for free. Any
/// failure falls through to a plain fetch — the cache is a pure optimisation
/// and must never break a request.
pub(crate) async fn get_json(client: &reqwest::Client, url: &str) -> Result<Value, String> {
    let stored = etag_cache().lock().ok().and_then(|c| c.get(url).cloned());

    let mut req = client.get(url);
    if let Some(hit) = &stored {
        req = req.header(reqwest::header::IF_NONE_MATCH, hit.etag.clone());
    }
    let resp = req.send().await.map_err(net_err)?;

    let status = resp.status().as_u16();
    let resp_etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    let fresh_body = if status == 304 {
        Value::Null
    } else {
        read_body(resp).await?
    };

    match resolve_conditional(status, resp_etag.as_deref(), stored.as_ref(), fresh_body) {
        Conditional::Cached(body) => Ok(body),
        Conditional::Fresh { body, etag } => {
            if let Some(etag) = etag {
                if let Ok(mut cache) = etag_cache().lock() {
                    cache.insert(
                        url.to_string(),
                        CachedResponse {
                            etag,
                            body: body.clone(),
                        },
                    );
                }
            }
            Ok(body)
        }
    }
}

/// Fetches an already-resolved URL through an authenticated platform client
/// and returns it as a base64 blob, capped at `MAX_BLOB_BYTES`. Used to load
/// markdown-embedded uploads (e.g. resolved via GitLab's Uploads API) that
/// need the same auth as the rest of the API.
pub(crate) async fn fetch_blob(client: &reqwest::Client, url: &str) -> Result<FileBlob, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let resp = client.get(url).send().await.map_err(net_err)?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        log(&format!(
            "fetch_blob: {url} -> {} ({} bytes body)",
            status.as_u16(),
            text.len()
        ));
        return Err(format!("file fetch error ({}): {}", status.as_u16(), text));
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

/// Fetches every page of a list endpoint (100/page, capped at 20 pages).
/// GitHub and GitLab share the `per_page`/`page` convention.
pub(crate) async fn get_all_pages(
    client: &reqwest::Client,
    url: &str,
) -> Result<Vec<Value>, String> {
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

#[cfg(test)]
#[path = "http_tests.rs"]
mod tests;
