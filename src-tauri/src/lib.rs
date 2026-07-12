mod accounts;
mod auth;
mod commands;
mod github;
mod gitlab;
mod platform;
mod storage;
mod update;

/// The AppImage bundles libwayland-client from the (Ubuntu 22.04) build host.
/// On distros whose Mesa was built against a newer libwayland, the bundled
/// copy shadows the host one and EGL initialisation in WebKit's web process
/// aborts with "Could not create default EGL display: EGL_BAD_PARAMETER",
/// leaving a blank window. Tauri's bundler has no way to exclude the library,
/// so re-exec once with the host's libwayland-client preloaded ahead of it.
/// Set NOD_NO_HOST_WAYLAND=1 to opt out.
#[cfg(target_os = "linux")]
fn preload_host_libwayland() {
    use std::os::unix::process::CommandExt;

    const GUARD: &str = "NOD_NO_HOST_WAYLAND";
    if std::env::var_os(GUARD).is_some() {
        return;
    }
    let Some(appdir) = std::env::var_os("APPDIR") else {
        return;
    };
    if std::env::var_os("WAYLAND_DISPLAY").is_none() {
        return;
    }
    let bundled = std::path::Path::new(&appdir).join("usr/lib/libwayland-client.so.0");
    if !bundled.exists() {
        return;
    }
    let host_lib = [
        "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0", // Debian/Ubuntu
        "/usr/lib/aarch64-linux-gnu/libwayland-client.so.0",
        "/usr/lib64/libwayland-client.so.0", // Fedora/openSUSE
        "/usr/lib/libwayland-client.so.0",   // Arch
    ]
    .into_iter()
    .find(|p| std::path::Path::new(p).exists());
    let Some(host_lib) = host_lib else {
        return;
    };

    let preload = match std::env::var("LD_PRELOAD") {
        Ok(existing) if !existing.is_empty() => format!("{host_lib}:{existing}"),
        _ => host_lib.to_string(),
    };
    let mut cmd = std::process::Command::new("/proc/self/exe");
    if let Some(argv0) = std::env::args_os().next() {
        cmd.arg0(argv0);
    }
    let err = cmd
        .args(std::env::args_os().skip(1))
        .env(GUARD, "1")
        .env("LD_PRELOAD", preload)
        .exec();
    eprintln!("nod: failed to re-exec with host libwayland-client ({err})");
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    preload_host_libwayland();

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
            commands::search_repos,
            commands::get_watched_repos,
            commands::set_watched_repos,
            commands::list_subscribed,
            commands::get_cached_subscribed,
            commands::get_pull_request_detail,
            commands::get_cached_pull_request_detail,
            commands::get_file_blob,
            commands::create_review_comment,
            commands::reply_to_review_comment,
            commands::update_review_comment,
            commands::delete_review_comment,
            commands::resolve_thread,
            commands::create_issue_comment,
            commands::update_issue_comment,
            commands::delete_issue_comment,
            commands::submit_review,
            commands::get_viewed_map,
            commands::set_viewed_map,
            update::check_for_update,
            update::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
