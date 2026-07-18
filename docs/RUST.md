# Rust backend (Tauri)

The desktop app's backend lives in `src-tauri/src/`. It holds
tokens, talks to GitHub/GitLab, and writes on-disk caches. The React webview
never calls host APIs directly.

For the full stack (webview → invoke → commands), see
[ARCHITECTURE.md](./ARCHITECTURE.md). This document is the map for the Rust side.

---

## Request flow

```
React (src/lib/api.ts)
  → invoke("command_name", …)
  → lib.rs (handler registration)
  → #[tauri::command] in auth | accounts | commands | update
  → accounts::active_platform (resolve active account + provider)
  → platform::AnyPlatform (dispatch)
  → GitHubPlatform | GitLabPlatform
  → storage::read_json / write_json (optional cache write)
```

Every data command follows the same pattern: resolve the **active account**,
build an **`AnyPlatform`**, call the provider, optionally persist a cache file
namespaced by `account.id`.

---

## Module map

The crate is intentionally flat (~10 files). Layers exist, but names do not
always match them. Use this table as the mental model:

| File | Layer | Responsibility |
| ---- | ----- | -------------- |
| `main.rs` | Entry | Delegates to `pr_flow_lib::run()`. |
| `lib.rs` | Bootstrap | Tauri builder, plugin setup, `generate_handler![…]`. |
| `commands.rs` | Handlers | PR/inbox/review/file commands; cache key helpers. |
| `auth.rs` | Handlers + infra | OAuth loopback server (GitHub + GitLab), token exchange. |
| `accounts.rs` | Domain + handlers | `Account` types, `accounts.json`, migration, account commands, `active_platform`. |
| `platform.rs` | Seam | `AnyPlatform` enum; forwards calls to the active provider. |
| `github.rs` | Model + adapter + HTTP | **Shared** serde types, JSON helpers, `GitHubPlatform` impl. |
| `gitlab.rs` | Adapter | `GitLabPlatform` — maps GitLab payloads onto shared types. |
| `storage.rs` | Infrastructure | JSON read/write under the app config dir. |
| `update.rs` | Handlers | `tauri-plugin-updater` wrappers. |

Rough mapping to familiar terms:

- **Controller / handler** → `#[tauri::command]` functions (spread across four modules; registered in `lib.rs`).
- **Use-case orchestration** → mostly inline in those commands (account → platform → cache).
- **Port / adapter** → `AnyPlatform` + `GitHubPlatform` / `GitLabPlatform`.
- **DTOs / models** → structs at the top of `github.rs` (`PullRequest`, `InboxData`, …).
- **Persistence** → `storage.rs` + account file logic in `accounts.rs`.

---

## Where to look

| I need to… | Start here |
| ---------- | ---------- |
| See every command the frontend can call | `lib.rs` → `generate_handler![…]` |
| Change inbox / PR detail / review behavior | `commands.rs` → method on `AnyPlatform` in `platform.rs` → provider impl |
| Add or change a shared JSON shape | Top of `github.rs` (serde structs, `camelCase`) |
| Add a new code host | New `*Platform` struct + variant on `AnyPlatform` + `accounts::platform_for` |
| Change OAuth / sign-in | `auth.rs` |
| Change multi-account storage | `accounts.rs` + `storage.rs` |
| Change cache file layout | `commands.rs` (`*_cache_name` helpers) + `storage.rs` |

---

## Tauri commands (by module)

All handlers are registered in `lib.rs`. Grouped by source file:

**`auth.rs`** — sign-in

- `is_oauth_configured`, `login_with_github`
- `is_gitlab_oauth_configured`, `probe_gitlab`, `login_with_gitlab`

**`accounts.rs`** — multi-account

- `list_accounts`, `add_account`, `set_active_account`, `remove_account`

**`commands.rs`** — PR workflow + legacy token helpers

- Session: `has_token`, `set_token`, `clear_token`, `get_current_user`
- Inbox: `list_inbox`, `get_cached_inbox`
- Watching: `get_watched_repos`, `set_watched_repos`, `list_subscribed`, `get_cached_subscribed`, `search_repos`
- Detail: `get_pull_request_detail`, `get_cached_pull_request_detail`, `get_file_blob`
- Review: `create_review_comment`, `reply_to_review_comment`, `resolve_thread`, `create_issue_comment`, `submit_review`
- Viewed state: `get_viewed_map`, `set_viewed_map`

**`update.rs`** — auto-update

- `check_for_update`, `install_update`

TypeScript wrappers live in `src/lib/api.ts`.

---

## Platform seam

`platform.rs` defines `AnyPlatform` (GitHub | GitLab) and forwards every host
operation (`inbox`, `pr_detail`, `submit_review`, …) to the matching impl.

Provider selection happens in `accounts::platform_for` from the active
account's `provider` + `host` + `token`. Data commands never import GitHub or
GitLab directly — they always go through `accounts::active_platform`.

Adding a third host means:

1. Implement the same method surface as the other platforms (follow
   `GitHubPlatform` / `GitLabPlatform`).
2. Add a variant to `AnyPlatform` and a match arm in each forwarded method.
3. Extend `accounts::platform_for` and account validation in `add_account`.

---

## Shared types (naming quirk)

Domain types consumed by the frontend (`PullRequest`, `PullRequestDetail`,
`ReviewComment`, `InboxData`, …) live in **`github.rs`** because GitHub was
the first provider. They are **not** GitHub-specific — GitLab maps MR data
onto them so the webview stays host-agnostic.

Similarly, `GitHubUser` is the shared “current user” shape for every provider.
HTTP helpers in `github.rs` (`read_body`, `get_all_pages`, `fstr`, …) are also
shared; `gitlab.rs` imports them from there.

If this becomes confusing as the crate grows, a likely refactor is:

- `model/` — shared serde types
- `http/` — shared reqwest helpers
- `platform/github/` and `platform/gitlab/` — provider impls

No behavior change required; the current layout is fine at ~3k lines.

---

## Accounts and tokens

- **`accounts.json`** — list of accounts (`provider`, `host`, `token`, `login`,
  …) plus `activeId`. Tokens never leave Rust except in token-free
  `AccountInfo` sent to the webview.
- **Legacy `token.json`** — migrated into a single GitHub account on first load
  (`accounts::load_migrated`), then deleted.
- **Account id** — deterministic slug from `provider`, `host`, and `login`
  (`accounts::account_id`); used to namespace cache files.

Helpers:

- `accounts::active_account` — load file + return active `Account` (with token).
- `accounts::active_platform` — active account + `AnyPlatform` ready for API calls.

---

## On-disk cache

All caches are pretty-printed JSON under the Tauri app config directory
(`storage::config_dir`). Names are per-account where it matters:

| File pattern | Written by | Contents |
| ------------ | ---------- | -------- |
| `accounts.json` | `accounts.rs` | Account list + active id |
| `inbox_{accountId}.json` | `list_inbox` | Full inbox tabs |
| `subscribed_{accountId}.json` | `list_subscribed` | Watching-tab PR bucket |
| `watched_{accountId}.json` | `set_watched_repos` | Repo full names to watch |
| `pr_{accountId}_{owner}_{repo}_{number}.json` | `get_pull_request_detail` | PR detail snapshot |
| `viewed_{accountId}.json` | `set_viewed_map` | Per-file viewed fingerprints |

Commands that end in `_cached_*` read these files only (no network). Fresh
fetch commands write through to the same paths.

---

## Auth (OAuth)

`auth.rs` implements RFC 8252-style loopback OAuth:

1. Bind `127.0.0.1:8765`, open the provider authorize URL in the system browser.
2. One-shot HTTP listener catches `?code=` on `/callback`.
3. Exchange code for token, validate via `current_user`, store via
   `accounts::upsert_github` or GitLab equivalent.

Credentials come from env (`PRFLOW_GH_*`, `PRFLOW_GL_*`) or compile-time
`option_env!` for release builds. `dotenvy` loads `src-tauri/.env` in dev.

Token paste (`set_token` / `add_account`) bypasses OAuth but still validates
the token against the host before persisting.

---

## Error handling and logging

- Commands return `Result<T, String>` — errors are user-facing strings.
- API failures surface the host's `message` when present (`read_body` in
  `github.rs`).
- Debug logging goes to stderr with a `[pr-flow]` prefix (`log()` helper).

---

## Conventions

Comment style for Rust sources is defined in
[ARCHITECTURE.md](./ARCHITECTURE.md#rust) (`//!` module docs, `///` on
non-obvious API fields).

When touching the backend:

- Keep tokens and HTTP out of the webview.
- Map provider responses onto shared types in the provider module, not in
  `commands.rs`.
- Namespace new persistent state by `account.id` so account switches do not
  leak data.
- Register new commands in `lib.rs` and add a typed wrapper in `api.ts`.

---

## Tests

Unit tests live in a sibling `{module}_tests.rs` file, pulled in via
`#[cfg(test)] #[path = "{module}_tests.rs"] mod tests;` at the bottom of the
module they test (e.g. `github.rs` → `github_tests.rs`). This keeps large
modules (`github.rs`, `gitlab.rs`) navigable without the test module pushing
the real code further down the file. Add new tests to the sibling file, not
inline, once a module has one.

---

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — stack-wide layering, comments, state
- [TESTING.md](./TESTING.md) — what to test when changing cache or commands
- [README.md](../README.md) — product overview and runtime diagram
