mod auth;
mod github;
mod storage;
mod update;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load OAuth credentials from a local `.env` (src-tauri/.env) if present.
    // Real environment variables already set in the shell take precedence.
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            auth::login_with_github,
            auth::is_oauth_configured,
            github::has_token,
            github::set_token,
            github::clear_token,
            github::get_current_user,
            github::list_inbox,
            github::get_cached_inbox,
            github::get_pull_request_detail,
            github::get_cached_pull_request_detail,
            github::get_file_blob,
            github::create_review_comment,
            github::reply_to_review_comment,
            github::create_issue_comment,
            github::submit_review,
            github::get_viewed_map,
            github::set_viewed_map,
            update::check_for_update,
            update::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
