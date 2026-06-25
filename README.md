# PR Flow

> A keyboard-first, cache-first desktop app for reviewing GitHub pull requests.

PR Flow is a focused experiment with one hypothesis:

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
| `r`        | Refresh list      |
| `/`        | Focus search      |
| `⌘K`       | Command palette   |
| `?`        | Keyboard shortcuts |

### Review

| Key        | Action                       |
| ---------- | ---------------------------- |
| `n` / `p`  | Next / previous file         |
| `j` / `k`  | Scroll diff                  |
| `]c` / `[c`| Next / previous comment      |
| `v`        | Toggle file as viewed (and advance) |
| `o`        | Open the files on GitHub     |
| `i`        | Toggle the info panel        |
| `r`        | Refresh this PR              |
| `Esc`      | Back to inbox                |

Inline comments: hover a diff line and click the **`+`** in the gutter. PR-level
comments: use the composer in the info panel (`i`).

---

## Architecture

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

- `src-tauri/src/github.rs` — GitHub REST client + all Tauri commands
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
   PRFLOW_GH_CLIENT_ID=Iv1.xxxxxxxx
   PRFLOW_GH_CLIENT_SECRET=xxxxxxxxxxxxxxxx
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

Either way, the token and all cached data are stored locally under the app config
directory (e.g. on macOS:
`~/Library/Application Support/com.pauliuskrutkis.prflow/`). The token is stored in
plain JSON — fine for a local MVP; moving it to the OS keychain is on the roadmap.

---

## Scope

**In scope (MVP v0.1):** token auth · list review-requested PRs · open a PR · view
changed files · syntax-highlighted diffs · view & add comments (inline, reply,
PR-level) · mark files viewed · keyboard navigation · local caching · background
polling.

**Out of scope (for now):** git operations · GitLab · AI review/chat · webhooks ·
team features · notifications · offline sync.

## Roadmap

- `c` to comment on the focused diff line (needs a line cursor)
- OS-keychain token storage
- Submitting full reviews (approve / request changes) with batched comments
- Fuzzy file finder, richer command palette actions
- Per-line syntax-highlighting context across hunks

---

Built as a 7-day experiment. The first milestone — *launch, see assigned PRs, open
one, navigate files with the keyboard* — is the core of the product; everything
else is iteration.
