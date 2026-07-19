# Nod

> A keyboard-first, cache-first desktop app for reviewing GitHub pull requests.

Nod (formerly PR Flow) is a focused experiment with one hypothesis:

> **Keyboard-first + cache-first PR review is faster and more satisfying than the GitHub web UI** — closer to triaging an inbox than navigating a website.

It is intentionally small. No AI, no git operations, no team features — just the
fastest possible loop for the thing you do every day: open a review request, read
the diff, leave a comment, move on.

Built with **Tauri 2 + React 19 + TypeScript + Tailwind v4**.

---

## Highlights

- ⌨️ **Keyboard-first.** Navigate PRs, files, hunks and comments without the mouse.
- ⚡ **Cache-first.** Everything you've seen paints instantly from a local cache;
  the network refreshes quietly in the background (every 60s and on window focus).
- ⏯️ **Resume where you left off.** Launch straight back into the last PR — even
  the file and scroll position you were on.
- 🔔 **New-review notifications.** When a fresh review request lands, a
  keyboard-dismissable toast pops up; press `Enter` to open it. No webhooks.
- 🔍 **Diff-centric review.** Syntax-highlighted, collapsible diffs with inline
  comment threads.
- 💬 **Comment inline or on the PR** without leaving the keyboard flow.
- ✅ **Mark files as viewed** to track review progress (stored locally).
- 🎯 **Command palette** (`⌘K`) and a **shortcut cheatsheet** (`?`).
- 🔒 **Your token stays on the backend.** All GitHub calls run in Rust — no CORS,
  no token in the webview.

---

## Keyboard shortcuts

### Inbox

| Key        | Action            |
| ---------- | ----------------- |
| `j` / `↓`  | Next PR           |
| `k` / `↑`  | Previous PR       |
| `Enter`    | Open PR           |
| `/`        | Focus search      |
| `1`–`4`    | Switch tab (Review requests · Assigned · Created · Involved) |
| `⌘K`       | Command palette   |
| `?`        | Keyboard shortcuts |

### Review

| Key        | Action                       |
| ---------- | ---------------------------- |
| `n` / `p`  | Next / previous file         |
| `j` / `k`  | Move the line cursor (`↑`/`↓`) |
| `Space`    | Page down the diff           |
| `]c` / `[c`| Next / previous comment      |
| `c`        | Comment on the cursor line   |
| `e`        | Mark file viewed and advance |
| `v`        | Toggle file as viewed        |
| `o`        | Open the files on GitHub     |
| `y`        | Copy the PR link             |
| `i`        | Toggle the info panel        |
| `s`        | Submit review                |
| `Esc`      | Back to inbox                |

Inline comments: hover a diff line and click the **`+`** in the gutter. PR-level
comments: use the composer in the info panel (`i`).

---

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for layering and comment conventions,
[docs/RUST.md](docs/RUST.md) for the Tauri backend module map,
and state/caching notes. Overview:

```
┌──────────────────────────── Webview (React) ────────────────────────────┐
│  Inbox / Review screens  ·  keyboard layer  ·  zustand UI state          │
│  TanStack Query (in-memory cache, 60s polling, refetch-on-focus)         │
└───────────────────────────────┬──────────────────────────────────────────┘
                                 │  invoke()  (typed wrappers in src/lib/api.ts)
┌───────────────────────────────▼──────────────────────────────────────────┐
│  Rust (Tauri commands)                                                    │
│   • GitHub REST client (reqwest) — token never leaves the backend         │
│   • JSON file cache: prs.json, pr_<owner>_<repo>_<n>.json, viewed.json     │
└───────────────────────────────────────────────────────────────────────────┘
```

**Cache-first flow:** the Rust commands fetch from GitHub and persist JSON to the
app config dir. On startup the UI seeds TanStack Query from that on-disk cache, so
the first paint is instant; the live fetch then reconciles in the background.

Key source files:

- `src-tauri/src/platform/github.rs` — GitHub client + commands: a single GraphQL request powers the inbox (all four tabs + counts at once); REST handles PR detail / diffs / comments
- `src-tauri/src/storage.rs` — JSON file persistence + token storage
- `src/lib/api.ts` — typed `invoke()` wrappers
- `src/keyboard/` — the scope-aware keyboard system (the differentiator)
- `src/hooks/` — TanStack Query data hooks (polling, focus refetch, cache seeding)
- `src/components/inbox`, `src/components/review` — the two screens

---

## Prerequisites

- **Node 18+** and **pnpm**
- **Rust toolchain** (via [rustup](https://rustup.rs)) — required to run the
  desktop app, since Tauri compiles a native Rust binary
- Platform build deps for Tauri — see
  [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)
  (on macOS: Xcode Command Line Tools)

## Getting started

```bash
pnpm install

# Run the desktop app (requires the Rust toolchain)
pnpm tauri dev

# Type-check / build just the frontend
pnpm build

# Produce a distributable bundle
pnpm tauri build
```

### Authenticate

You can authenticate two ways:

#### Option A — Sign in with GitHub (OAuth, best UX)

Click **Sign in with GitHub**: the browser opens GitHub's authorize page, you log
in, and the app catches the redirect on a local `http://127.0.0.1` listener and
captures the token automatically — no copy/paste.

This needs a **one-time OAuth App registration** (only the developer does this
once):

1. Go to **GitHub → Settings → Developer settings → OAuth Apps → New OAuth App**
   ([github.com/settings/applications/new](https://github.com/settings/applications/new)).
2. Set **Authorization callback URL** to exactly:
   ```
   http://127.0.0.1:8765/callback
   ```
   (Homepage URL can be anything, e.g. `http://127.0.0.1:8765`.)
3. Create it, copy the **Client ID**, and **Generate a new client secret**.
4. Put them in **`src-tauri/.env`** (copy the provided `src-tauri/.env.example`):
   ```dotenv
   # Copy these exactly as shown on the OAuth App page — no prefix.
   PRFLOW_GH_CLIENT_ID=Ov23xxxxxxxxxxxxxxxx
   PRFLOW_GH_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   ```
   Then start the app:
   ```bash
   pnpm tauri dev
   ```

`src-tauri/.env` is **gitignored**, so the secret never gets committed; the app
loads it at startup (real shell environment variables, if set, take precedence).
You can equally `export` the two vars instead of using `.env` — either works.

(The callback uses a fixed loopback port, `8765`. GitHub OAuth Apps don't support
PKCE, so the authorization-code flow needs the secret; for a single-user desktop
tool that's an acceptable trade-off. The button shows a "needs setup" hint until
the credentials are present.)

#### Option B — Personal Access Token

Paste a **PAT** with the **`repo`** scope. Create one at
[github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=repo&description=PR%20Flow)
(the in-app link pre-selects the scope). No OAuth App needed.

#### GitLab

**gitlab.com — Sign in with GitLab (OAuth + PKCE, no client secret):** needs a
one-time application registration:

1. GitLab → **Preferences → Applications → Add new application**
   ([gitlab.com/-/user_settings/applications](https://gitlab.com/-/user_settings/applications)).
2. Redirect URI: `http://127.0.0.1:8765/callback`, scope: **`api`**,
   **uncheck "Confidential"** (public client, PKCE) and **uncheck "Expire
   access tokens"** (otherwise tokens expire after 2h and you'd re-auth).
3. Put the Application ID in `src-tauri/.env`:
   ```dotenv
   NOD_GITLAB_CLIENT_ID=xxxxxxxx
   ```

**Self-managed GitLab:** OAuth apps register per instance, so use a **PAT**
with the `api` scope plus your host URL in the GitLab tab of the sign-in
screen.

Either way, the token and all cached data are stored locally under the app config
directory (e.g. on macOS:
`~/Library/Application Support/com.pauliuskrutkis.nod/`). The token is stored in
plain JSON — fine for a local MVP; moving it to the OS keychain is on the roadmap.

---

## Install & auto-updates

**macOS (Homebrew):**

```bash
brew tap pauliuskrutkis/tap
brew trust --tap pauliuskrutkis/tap
brew install --cask nod
xattr -dr com.apple.quarantine /Applications/Nod.app
```

(`brew trust` is one-time, and only needed on newer Homebrew versions —
note the `--tap` flag, plain `brew trust pauliuskrutkis/tap` is rejected.
The `xattr` step is needed because releases aren't Apple-notarized yet;
Homebrew 6 removed the old `--no-quarantine` flag. Alternatively,
download the `.dmg` from [Releases](https://github.com/PauliusKrutkis/pr-flow/releases)
and right-click → Open on first launch.)

**Windows / Linux:** grab the installer (`.msi` / `.deb` / `.AppImage`) from
[Releases](https://github.com/PauliusKrutkis/pr-flow/releases).

After the first install the app keeps itself current: it polls the release
feed, shows an **"Update available"** prompt, and installs + relaunches in one
click. Updates are signed (minisign via `tauri-plugin-updater`) and verified
against the public key baked into the app.

### Cutting a release

Full guide — including testing auto-updates locally while the repo is private,
and the go-public checklist (name, identifier, icon) — in
**[docs/RELEASING.md](docs/RELEASING.md)**.

```bash
git tag v0.1.1 && git push origin v0.1.1
```

The `release.yml` workflow builds macOS (arm64 + x64), Windows and Linux
bundles, signs the updater artifacts, publishes a GitHub Release with
`latest.json`, and bumps the Homebrew tap (when the `TAP_REPO_TOKEN` secret is
set). Bump `version` in `src-tauri/tauri.conf.json` before
tagging — that's the version the updater compares against.

Signing secrets (already configured): `TAURI_SIGNING_PRIVATE_KEY` (from
`~/.tauri/prflow.key` — **back this file up**; losing it breaks the update
chain) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

---

## Scope

**In scope (MVP v0.1):** token + OAuth auth · inbox tabs (review-requested ·
assigned · created · involved) · open a PR · view changed files ·
syntax-highlighted diffs · view & add comments (inline, reply, PR-level) ·
submit reviews (approve / request changes) with batched comments · mark files
viewed · resume where you left off · in-app new-review notifications · keyboard
navigation · local caching · background polling.

**Out of scope (for now):** git operations · GitLab · AI review/chat · webhooks ·
team features · desktop/OS notifications · offline sync.

## Roadmap

- OS-keychain token storage
- Auto-updates: wire the scaffolded updater to a signed CI release feed (above)
- Fuzzy file finder, richer command palette actions
- Per-line syntax-highlighting context across hunks

---

Built as a 7-day experiment. The first milestone — *launch, see assigned PRs, open
one, navigate files with the keyboard* — is the core of the product; everything
else is iteration.
