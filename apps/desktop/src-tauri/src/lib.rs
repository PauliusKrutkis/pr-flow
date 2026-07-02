mod accounts;
mod auth;
mod commands;
mod github;
mod gitlab;
mod platform;
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
            auth::login_with_gitlab,
            auth::is_gitlab_oauth_configured,
            auth::probe_gitlab,
            accounts::list_accounts,
            accounts::add_account,
            accounts::set_active_account,
            accounts::remove_account,
            commands::has_token,
            commands::set_token,
            commands::clear_token,
            commands::get_current_user,
            commands::list_inbox,
            commands::get_cached_inbox,
            commands::get_pull_request_detail,
            commands::get_cached_pull_request_detail,
            commands::get_file_blob,
            commands::create_review_comment,
            commands::reply_to_review_comment,
            commands::create_issue_comment,
            commands::submit_review,
            commands::get_viewed_map,
            commands::set_viewed_map,
            update::check_for_update,
            update::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
