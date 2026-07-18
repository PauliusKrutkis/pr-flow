use super::{cache_path_segment, detail_cache_name};

#[test]
fn detail_cache_name_sanitizes_slashes_in_owner_and_repo() {
    assert_eq!(
        detail_cache_name(
            "gitlab-https-gitlab-acme-dev-demo-user",
            "acme-corp",
            "frontend/widget-app",
            42
        ),
        "pr_gitlab-https-gitlab-acme-dev-demo-user_acme-corp_frontend_widget-app_42.json"
    );
}

#[test]
fn cache_path_segment_replaces_slashes_and_backslashes() {
    assert_eq!(cache_path_segment("a/b\\c"), "a_b_c");
}
