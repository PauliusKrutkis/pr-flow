use super::*;

#[test]
fn account_ids_are_filesystem_safe_and_deterministic() {
    let id = account_id("gitlab", "https://gitlab.acme.dev", "demo-user");
    assert_eq!(id, "gitlab-https-gitlab-acme-dev-demo-user");
    assert_eq!(
        id,
        account_id("gitlab", "https://gitlab.acme.dev", "demo-user")
    );
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
