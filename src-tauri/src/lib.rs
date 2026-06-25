mod auth;
mod github;
mod storage;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            auth::login_with_github,
            auth::is_oauth_configured,
            github::has_token,
            github::set_token,
            github::clear_token,
            github::get_current_user,
            github::list_review_requested,
            github::get_cached_prs,
            github::get_pull_request_detail,
            github::get_cached_pull_request_detail,
            github::create_review_comment,
            github::reply_to_review_comment,
            github::create_issue_comment,
            github::get_viewed_map,
            github::set_viewed_map,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
