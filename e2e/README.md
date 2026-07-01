# PR Flow — end-to-end tests

> **Status: TODO scaffold.** This directory enumerates the intended e2e coverage
> as *pending* specs. **Nothing here is implemented yet** — there is no test
> runner wired up, no dependencies added, and no `package.json` scripts. Each
> spec file is a list of `test.todo(...)` entries to be filled in later.

## Why it's only TODO for now

The MVP's first job was to ship a usable app. E2E tests are tracked here so the
coverage is planned and visible, but implementing them is deliberately deferred
(see the PR that introduced this scaffold).

## Planned approach

Two complementary layers — we'll likely start with the second (it works on
macOS, where most dev happens):

### 1. Full-app e2e — WebdriverIO + `tauri-driver`

The official Tauri e2e path drives the real built binary (Rust backend + webview)
through `tauri-driver` and WebDriver.

- **Caveat:** Tauri's WebDriver support is **Linux & Windows only** — macOS has no
  `WKWebViewDriver`, so these run in **CI (Linux)**, not on a Mac laptop.
- Good for: real backend behavior, the OAuth loopback round-trip (against a mock
  GitHub or a recorded fixture), window/keyboard integration.

### 2. Frontend e2e — Playwright against `vite dev` with a mocked Tauri bridge

Run the React app in a normal browser via `pnpm dev`, stubbing
`@tauri-apps/api/core`'s `invoke` (and `@tauri-apps/plugin-opener`) with fixture
data. Covers the keyboard system, navigation, diff rendering, comment UI, command
palette, and cache-seeding logic without needing Rust or a Mac WebDriver.

- Good for: fast, deterministic UI/interaction coverage; runs everywhere.
- Doesn't cover: the real Rust commands / GitHub calls (those are layer 1).

### Performance budgets

`docs/DESIGN.md` sets hard budgets — **open a PR < 300ms, switch PR < 100ms,
switch file < 16ms (one frame)** — and the rule that cached content never blocks
on a spinner. These are verified by *targeted measurement*, not a UI overlay:
wrap a single interaction in `performance.mark`/`measure` (or observe main-thread
long tasks) and assert the elapsed time against the budget, so a regression fails
CI. Layer 2 (Playwright) is enough for the render/interaction budgets; cold-start
timing that includes the Rust backend belongs in layer 1.

## When implementing, decide

- [ ] Runner + assertion lib (WebdriverIO+Mocha for layer 1; Playwright for layer 2)
- [ ] Where Tauri `invoke` is mocked, and the fixture shape (reuse `src/types.ts`)
- [ ] A seeded fake GitHub (MSW / local server) vs. recorded fixtures
- [ ] CI matrix (Linux for `tauri-driver`; any OS for Playwright)
- [ ] `pnpm e2e` / `pnpm e2e:ui` scripts + CI workflow
- [ ] How perf budgets are measured (`performance.mark`/`measure` vs. long-task
      observer) and where the thresholds live so a regression fails CI

## Coverage checklist

Auth (`specs/auth.spec.ts`)
- [ ] Token gate shown when no token is stored
- [ ] "Sign in with GitHub" visible only when OAuth is configured
- [ ] PAT fallback: invalid token shows an error; valid token → inbox
- [ ] OAuth loopback round-trip (mocked GitHub) captures token → inbox

Inbox (`specs/inbox.spec.ts`)
- [ ] Renders review-requested PRs from cache instantly, then background refetch
- [ ] `j`/`k` (and arrows) move selection; `Enter` opens the PR
- [ ] `/` focuses search and filters; `Esc` clears + blurs
- [ ] `r` refreshes the list
- [ ] Unread indicator reflects `updatedAt` vs last-seen
- [ ] Empty state when there are no review requests

Review (`specs/review.spec.ts`)
- [ ] Opening a PR shows the file sidebar + diff; back (`Esc`) returns to inbox
- [ ] `n`/`p` switch files; `j`/`k` scroll the diff
- [ ] `v` toggles viewed (checkmark + header count update) and advances
- [ ] `]c`/`[c` navigate between comment threads
- [ ] `o` opens files on GitHub (opener mocked); `i` toggles the info panel
- [ ] Diff renders add/del/context rows with syntax highlighting; hunks collapse
- [ ] Binary / no-patch file shows the explanatory note

Comments (`specs/comments.spec.ts`)
- [ ] Existing review comments anchor to the correct line/side
- [ ] Inline `+` opens the composer; submit posts and the comment appears
- [ ] Replying to a thread posts with the correct `inReplyTo`
- [ ] PR-level comment via the info panel composer
- [ ] `⌘/Ctrl+Enter` submits; `Esc` cancels; empty submit is ignored

Keyboard / palette / help (`specs/keyboard.spec.ts`)
- [ ] `⌘K` opens the command palette; filtering; `Enter` runs a command
- [ ] Palette lists "jump to PR" entries and navigates
- [ ] Palette open suppresses underlying screen shortcuts
- [ ] `?` opens the help overlay; `Esc` closes it
- [ ] Two-key sequences (`]c`/`[c`) and `mod+` combos resolve correctly
- [ ] Bindings are ignored while typing in inputs/textareas

Caching / polling (`specs/caching.spec.ts`)
- [ ] First paint comes from the on-disk cache before the network resolves
- [ ] 60s polling and refetch-on-window-focus update data quietly
- [ ] Viewed-file state persists across an app restart

Performance / budgets (`specs/perf.spec.ts`)
- [ ] Opening a PR paints the sidebar + diff in under 300ms
- [ ] Switching to an already-cached PR renders in under 100ms
- [ ] Switching files within a PR renders in under 16ms (one frame)
- [ ] A seen PR paints from cache with no loading spinner
- [ ] Opening a large diff produces no main-thread long task over 50ms
- [ ] The command palette opens in under 100ms
