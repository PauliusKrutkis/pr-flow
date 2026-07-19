use super::*;

#[test]
fn conditional_304_serves_cached_body() {
    let cached = CachedResponse {
        etag: "\"abc\"".to_string(),
        body: serde_json::json!({ "cached": true }),
    };
    let out = resolve_conditional(304, Some("\"abc\""), Some(&cached), Value::Null);
    assert_eq!(
        out,
        Conditional::Cached(serde_json::json!({ "cached": true }))
    );
}

#[test]
fn conditional_200_stores_new_etag_and_body() {
    let out = resolve_conditional(
        200,
        Some("\"new\""),
        None,
        serde_json::json!({ "fresh": 1 }),
    );
    assert_eq!(
        out,
        Conditional::Fresh {
            body: serde_json::json!({ "fresh": 1 }),
            etag: Some("\"new\"".to_string()),
        }
    );
}

#[test]
fn conditional_304_without_cache_falls_back_to_fresh() {
    let out = resolve_conditional(304, None, None, Value::Null);
    assert_eq!(
        out,
        Conditional::Fresh {
            body: Value::Null,
            etag: None,
        }
    );
}

#[test]
fn conditional_200_without_etag_stores_nothing() {
    let out = resolve_conditional(200, None, None, serde_json::json!({ "x": 1 }));
    assert_eq!(
        out,
        Conditional::Fresh {
            body: serde_json::json!({ "x": 1 }),
            etag: None,
        }
    );
}
