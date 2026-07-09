# Feature plans — July 2026 batch

> **Planning only — no implementation here.** Each item below is a self-contained
> technical brief that an agent can pick up independently. Product-level
> prioritization lives in [BACKLOG.md](./BACKLOG.md); this doc is the *how*.

## How to pick up an item

1. Read the item's brief plus the files it references. Briefs cite line numbers
   as of `main` @ `b6d85d0`; verify before relying on them.
2. Every item ships via the **split-pr skill** (`.claude/skills/split-pr/SKILL.md`).
   Its gate applies to every PR: one intent, ~300-line soft budget, independently
   testable, `pnpm check` / `typecheck` / `test` / `knip` green (+ `pnpm e2e` and
   visual evidence for UI changes, + `cargo test` when `src-tauri/` changed).
3. Briefs already propose a slicing; re-slice if the diff turns out different,
   but keep slices vertical (wired end to end), never horizontal by layer.
4. Items marked **needs decision** have an open question the user must answer
   before implementation starts. Everything else is ready to build.

Size labels: 🟢 one small PR · 🟡 one budget-sized PR · 🔴 a stack of PRs.

## Suggested execution order

| Wave | Items | Why first |
| ---- | ----- | --------- |
| 1 — bug fixes | [P01](#p01), [P02](#p02), [P03](#p03) | Small, self-contained, user-visible pain |
| 2 — quick wins | [P04](#p04), [P05](#p05), [P06](#p06), [P07](#p07) | 🟢 features on existing plumbing |
| 3 — review surfaces | [P08](#p08), [P09](#p09), [P10](#p10), [P11](#p11), [P12](#p12) | New data/UI, independent of each other |
| 4 — desktop shell | [P13](#p13), [P14](#p14) | Platform work, needs Windows/Linux validation |
| 5 — bigger bets | [P15](#p15), [P16](#p16), [P17](#p17), [P18](#p18) | 🔴 stacks or needs-decision items |
| anytime | [P19](#p19), [P20](#p20), [P21](#p21) | Hygiene / design / deferred |

---

## Wave 1 — bug fixes

<a id="p01"></a>
### P01 · GitHub OAuth on Windows opens the Documents folder 🟢

**Intent:** OAuth sign-in on Windows opens the default browser instead of Explorer.

**Root cause (found):** `src-tauri/src/auth.rs:276-289` — `open_in_browser` spawns
`explorer <url>` on Windows. `explorer.exe` does not reliably treat an `https://`
argument as a URL and falls back to opening the Documents folder. macOS (`open`)
and Linux (`xdg-open`) paths are fine. Both GitHub (`auth.rs:86`) and GitLab
(`auth.rs:220`) flows go through this one function.

**Plan:** Replace the hand-rolled spawn with `tauri_plugin_opener::open_url` —
the plugin is already a dependency (`src-tauri/Cargo.toml:22`) and registered
(`src-tauri/src/lib.rs:75`), so this deletes platform-specific code rather than
adding it. `open_in_browser` currently takes no `AppHandle`; either use the
plugin's standalone `openable` API or thread the handle from the two callers.

**PRs:** One PR, well under budget. `cargo test` in `src-tauri/`; no e2e (auth
is outside the webview). Evidence: manual verification on Windows is the only
real proof — note that in the PR and get a Windows run before release.

<a id="p02"></a>
### P02 · File-tree active effect persists after `r`/`t` 🟢

**Intent:** After clicking a file in the sidebar, keyboard file-switching no
longer leaves a stale highlight on the clicked row.

**Root cause (likely):** Two independent "active" affordances exist on sidebar
rows (`src/components/review/file-sidebar.tsx:136-149`): the selection style
`qf-file-active` (driven by `selectedIndex`, moves correctly) and the focus ring
`.qf-focusable:focus-visible` (`src/quiet.css:781`). A mouse click leaves DOM
focus on the clicked button; when `r`/`t` move `selectedIndex`, the old button
keeps its focus ring. WebKitGTK's `:focus-visible` heuristics are looser than
Chromium's, so the ring shows after plain clicks there. Reproduce on WebKitGTK
first to confirm.

**Plan:** In `handleFileClick` (`file-sidebar.tsx:109`), blur the button after
selecting (`e.currentTarget.blur()`), so mouse selection never retains focus;
keyboard/tab focus behavior is untouched because blur only runs on click.
Audit other click-selectable `qf-focusable` rows (inbox list) for the same
pattern while there.

**PRs:** One PR. Extend `e2e/review.spec.ts`: click a file, press `r`, assert
the previous row has neither `qf-file-active` nor `:focus`. UI evidence:
before/after screenshots.

<a id="p03"></a>
### P03 · Next occurrence doesn't work while find (`mod+f`) is active 🟢

**Intent:** Occurrence navigation and find-in-diff can be active at the same
time, or hand off to each other predictably.

**Root cause (found):** Two gates in `src/components/review/review-screen.tsx`:
selection-driven occurrence spec creation early-returns while find is open
(`review-screen.tsx:511-527`), and the `n`/`p` occurrence bindings only register
when `occSpec` exists (`review-screen.tsx:1518-1532`). Additionally, while the
find input has focus, all non-global hotkeys are swallowed by
`isEditableTarget` (`src/keyboard/keyboard-provider.tsx:48`). Net effect: with
`mod+f` open you can neither create nor step occurrences.

**Plan (needs a semantics choice, recommendation below):** Make the two modes
mutually exclusive with an explicit handoff — selecting text or double-clicking
a token while find is open **closes the find bar** and starts occurrence mode.
That is one gate removal (the early return at `review-screen.tsx:520`) plus
`closeFind()` at occurrence-start, and matches the existing Esc cascade
(selection → find → drawer → inbox, `review-screen.tsx:1533-1550`). The
alternative — both active at once — means two competing highlight sets and two
meanings for `enter`/`n`; not worth it.

**PRs:** One PR. Extend `e2e/occurrences.spec.ts` with a "find open → select
token → occurrences work, find closed" scenario. UI evidence from that spec.

---

## Wave 2 — quick wins

<a id="p04"></a>
### P04 · Hotkey for insert suggestion 🟢

**Intent:** The composer's "Suggestion" action gets a keyboard shortcut.

**Where:** `src/components/review/composer-editor.tsx:206-214` (`insertSuggestion`,
currently button-only at `:293-303`). Composer shortcuts (`mod+b/i/e/k`) are
TipTap keymap entries in the same file.

**Plan:** Add `mod+shift+s` to the TipTap keymap calling `insertSuggestion`
(only when `suggestionText` is non-null, mirroring the button's render guard).
Show the combo on the button via `Kbd` (`src/components/ui/kbd.tsx`) like other
hint-bar entries, and in the help overlay if composer keys are listed there.

**PRs:** One PR. Extend `e2e/composer.spec.ts` (or `multiline.spec.ts` for range
prefill): focus composer, press the combo, assert a `suggestion` code block with
the cursor line's text. UI evidence: screenshot of the hint on the button.

<a id="p05"></a>
### P05 · Comment thread expand/collapse hotkeys 🟢

**Intent:** The active thread (the one `]c`/`[c` landed on) can be expanded and
collapsed from the keyboard.

**Where:** `expanded` is local state inside `CommentThread`
(`src/components/review/comment-thread.tsx:33`); the review screen already
tracks the active thread (`activeThreadRef`) and pokes threads imperatively via
the `replyRequest` nonce mechanism (`comment-thread.tsx:40-49`,
`review-screen.tsx` `useReviewThreadActions`).

**Plan:** Follow the established nonce pattern: add a `toggleRequest?: {rootId,
nonce}` prop to `CommentThread` that flips `expanded`, plumbed exactly like
`replyRequest`. Bind `z` in the review bindings (`z` is unbound; `x` = resolve,
`o` = open on GitHub) to toggle the active thread. Optional second binding
`shift+z` = collapse all (a version counter that resets every thread's local
state via a `key`- or effect-based reset) — drop it if the diff crowds the
budget; it's a separate intent anyway.

**PRs:** One PR for `z` (toggle active). `shift+z` collapse-all as a follow-up
PR only if wanted. Extend `e2e/threads.spec.ts`; UI evidence from it.

<a id="p06"></a>
### P06 · Next/previous chunk keybind 🟢

**Intent:** A keyboard step between diff hunks — coarser than `j`/`k` lines,
finer than `r`/`t` files.

**Key choice (recommendation):** `}` / `{`. Rationale: `n`/`p` are contextually
taken by occurrence mode (`review-screen.tsx:1518`), `]c`/`[c` are comment
sequences so bare `]`/`[` would collide with the 700 ms sequence prefix window
(`keyboard-provider.tsx:29`), and `shift+j/k` is multi-line selection. `}`/`{`
are unbound, are vim's paragraph motion (right mental shape), and need no
sequence handling. Vim's exact diff convention `]c` is already spoken for.

**Where:** The list model (`src/lib/review-items.ts`) already knows item kinds;
hunk headers exist as rows (the cursor mover in `review-screen.tsx`
`buildCursorMover` walks items). The comment navigator (`goToComment`,
`review-screen.tsx:1655-1672`) is the template: an index list + `centerItem`.

**Plan:** Precompute `hunkItems: number[]` in the model alongside
`commentItems`; add `goToHunk(delta)` mirroring `goToComment` but moving the
line cursor to the hunk's first row instead of only centering. Bind `}`/`{` in
the review bindings with `group: "Navigation"` so the help overlay picks it up.

**PRs:** One PR. Unit test the model's hunk index in `src/lib/`; e2e in
`review.spec.ts` (press `}`, assert cursor row). UI evidence from the spec.

<a id="p07"></a>
### P07 · Restore archived (`e`-archived) inbox PRs 🟢🟡

**Intent:** Archived PRs can be seen and un-archived instead of being invisible
until new activity arrives.

**Where:** Archiving is `markSeen(prKey, updatedAt)` — the inbox hides PRs whose
`updatedAt` is not newer than the stored `lastSeen` stamp
(`src/store/app-store.ts:89-108, 294-307`; archive action + undo at
`src/components/inbox/inbox.tsx:185, 374-377`). There is no persistent
"archived list" — only the stamp map — and undo is session-only.

**Plan:** No new storage needed: an "archived" PR is one present in the inbox
payload but filtered out by the `lastSeen` check, so the data is already in the
query cache. Add an inbox view (a section or a toggle, e.g. keybind `u` or a
tab) that lists exactly those filtered-out PRs, with `e` on a row un-archiving
it (delete the `lastSeen` entry via a new `clearSeen(prKey)` store action, which
also makes it persist — unlike today's undo). Reuse `PrListItem`.

**PRs:** One PR if the view is a simple toggle (~250 lines with tests); two if
the inbox layout needs rework (PR1: `clearSeen` + persistent undo replacing the
session-only path; PR2: archived view). Unit-test `clearSeen` in
`app-store.test.ts`; extend `e2e/inbox.spec.ts` (archive → toggle view → restore
→ row is back). UI evidence.

---

## Wave 3 — review surfaces

<a id="p08"></a>
### P08 · Show approvals 🟡

**Intent:** Review verdicts (approved / changes requested) are visible without
opening the info drawer.

**Where:** `PullRequestDetail.reviews: ReviewSummary[]` already ships to the
frontend (`src/types.ts:97-113`) and the info drawer renders verdict pills
(`src/components/review/right-panel.tsx:34-39`). The inbox `PullRequest` type
has **no** review state — list endpoints don't include it.

**Plan, sliced:**
- **PR 1 (frontend-only):** Aggregate `reviews` (latest per reviewer wins;
  GitHub semantics — a later `COMMENTED` does not clear an earlier `APPROVED`,
  match host behavior) and render an approvals pill in the review-screen header
  (`review-screen.tsx:2664`), e.g. `✓ 2 · ± 1` with reviewer avatars in a
  tooltip. Data already fetched; zero backend.
- **PR 2 (inbox, optional — needs decision):** Surfacing approval state on
  inbox rows requires per-PR review data at list time: GitHub GraphQL
  `reviewDecision` on the search query, or N+1 REST calls (rate-limit hostile).
  GitLab list API has `approvals_before_merge`-style fields but real state
  needs `/approvals` per MR. Decide whether inbox badges are worth a GraphQL
  migration for the inbox query before building. Skip until asked.

**PRs:** PR 1 ~150 lines; unit test the aggregation in `src/lib/`; extend
`e2e/review.spec.ts` fixtures with reviews; UI evidence.

<a id="p09"></a>
### P09 · Pipelines / CI status 🟡🔴

**Intent:** The PR's CI state (pass / fail / running) is visible in the review
screen.

**Where:** Nothing CI-shaped exists in the shared types (`src/types.ts`) or
platforms. New surface: GitHub = check-runs + commit statuses for `headSha`
(REST `GET /repos/{o}/{r}/commits/{sha}/check-runs` + `/status`), GitLab =
`GET /projects/:id/merge_requests/:iid/pipelines` (latest pipeline). Shared
shape suggestion: `ciStatus: { state: "success"|"failure"|"pending"|"none",
total, failed, url }` on `PullRequestDetail`, mapped per provider in
`github.rs` / `gitlab.rs` per the seam rules (RUST.md "Platform seam").

**Plan, sliced (stack):**
- **PR 1:** Backend + type + a status pill in the review header, fetched with
  `get_pull_request_detail` (no new command; extends the existing snapshot and
  its cache file). Poll-refreshes for free with the existing 60 s detail cycle.
  Vertical: serde struct → platform impls → `types.ts` → header pill → e2e
  fixture. Watch the budget — if both providers push it over, ship GitHub in
  PR 1 (GitLab returning `none`) and GitLab mapping in PR 2.
- **PR 2 (later):** Per-check list in the info drawer with failure links.

**PRs:** `cargo test` for mapping (fixture JSON → shared shape); e2e via
`e2e/bridge.ts` fixtures; UI evidence. Keep `state: "none"` rendering nothing
so repos without CI stay quiet.

<a id="p10"></a>
### P10 · Edit comments 🔴 (stack of 2)

**Intent:** Your own comments can be edited in place.

**Where:** No update commands exist (RUST.md command list). Hosts: GitHub
`PATCH /pulls/comments/{id}` (review comments) and `PATCH /issues/comments/{id}`
(PR-level); GitLab `PUT /projects/:id/merge_requests/:iid/discussions/:d/notes/:n`.
Current-user login is available via `get_current_user` — needed to gate the
edit affordance to own comments. Composer already round-trips markdown
(`composer-editor.tsx`, `editor.getMarkdown()`).

**Plan, sliced (stack):**
- **PR 1 — inline review comments:** `update_review_comment` command (both
  providers) + `api.ts` wrapper + edit affordance on own comments in
  `CommentThread` (reuse `AddCommentBox`/composer prefetched with the raw
  markdown body — the raw body must come from the API payload, not re-serialized
  HTML) + optimistic update in `use-comments.ts`. Hotkey `E` (shift+e) on the
  active thread's root, mirroring `r` reply.
- **PR 2 — PR-level comments:** same shape for `IssueComment` in the info
  drawer (`right-panel.tsx`).

**PRs:** Each PR: `cargo test` mapping, e2e in `threads.spec.ts` /
drawer spec with bridge fixtures, UI evidence. Note GitLab edit needs the
discussion id — `ReviewComment.threadId` already carries it (`types.ts:84`).

<a id="p11"></a>
### P11 · View full files 🟡 → 🔴

**Intent:** See a changed file's full contents, not just the diff hunks.

**Where:** `get_file_blob` command already exists (RUST.md; used by
`image-diff.tsx`), so the backend is mostly done — verify it returns text blobs
at a given `sha` (`ChangedFile.sha`, `types.ts:69`) and add a size guard.
Syntax highlighting exists (`src/lib/highlight.ts`).

**Plan (recommendation: modal first, inline expansion later):**
- **PR 1 — full-file modal:** Hotkey (suggest `shift+v`; `v` = toggle viewed)
  opens a read-only, virtuoso-backed, highlighted view of the active file at
  head sha, with `use-modal-dialog.ts` semantics and Esc to close. Cheap,
  self-contained, answers "what does the rest of this file look like".
- **PR 2+ (only if the modal isn't enough):** GitHub-style expandable context
  between hunks — splice blob lines into the diff model as collapsible regions.
  Touches `lib/diff.ts`, `review-items.ts`, the list renderer, cursor math, and
  find-in-diff; plan as its own stack when requested. Don't start here.

**PRs:** PR 1 ~250 lines; e2e with a blob fixture in `bridge.ts`; UI evidence.

<a id="p12"></a>
### P12 · "What's new" after an update 🟡

**Intent:** After the app updates, the first launch shows what changed.

**Where:** The update prompt already surfaces `notes` pre-install
(`src/components/update-prompt.tsx`); nothing runs post-install. Version comes
from `tauri.conf.json` / `check_for_update`'s `currentVersion`. Release notes
per version are public on GitHub releases for this repo
(`PauliusKrutkis/pr-flow`, see the updater endpoint in `tauri.conf.json`).
The webview must not fetch the network directly (ARCHITECTURE.md layering), so
notes go through a Rust command.

**Plan:** Store `pr-flow:lastRunVersion` in localStorage. On launch, if it
differs from the current app version (new command or constant exposure of
`app.package_info().version`), fetch that version's release notes via a new
`get_release_notes(tag)` command (public GitHub API, no token needed, graceful
`None` offline) and show a dismissible "What's new in vX.Y.Z" card styled like
`UpdatePrompt`; then write the new version. Render notes with the existing
`Markdown` component.

**PRs:** One PR (~250 lines): command + wrapper + card + e2e (bridge-mock the
command, seed localStorage). `cargo test` optional (thin HTTP passthrough).
UI evidence.

---

## Wave 4 — desktop shell

<a id="p13"></a>
### P13 · App top bar for Linux & Windows 🔴 (stack of 2)

**Intent:** Linux and Windows get an in-app title bar consistent with the Quiet
design instead of the native chrome.

**Where:** `src-tauri/tauri.conf.json:20` sets `titleBarStyle: "Overlay"` —
macOS-only; Linux/Windows currently show native decorations. Tauri v2 path:
`decorations: false` + a custom bar with `data-tauri-drag-region` + window
controls via `@tauri-apps/api/window` (`minimize/toggleMaximize/close`), which
need `core:window:allow-*` permissions in `src-tauri/capabilities/`.

**Plan, sliced (stack):**
- **PR 1 — frameless + functional bar:** Platform-gate decorations (keep macOS
  overlay as-is; runtime `platform()` check or per-platform config). New
  `TitleBar` component rendered only under Tauri on linux/windows (`isTauri`
  guard so the browser e2e runs are unaffected), with drag region, app title,
  and min/max/close. Wire capabilities.
- **PR 2 — behavior polish:** double-click-to-maximize, maximized-state icon
  swap, window-drag edge cases (WebKitGTK drag-region quirks), and layout audit
  so the bar doesn't fight the review header.

**Testing/evidence:** e2e can't exercise Tauri window controls — cover the
component render-gating with a unit test, and attach manual screenshots from a
real `tauri dev` run on Linux (and Windows if available) as evidence. Note in
the PR that this is the app-shell exception to spec-driven evidence.

**Open question (needs decision):** native-looking controls per-OS (Windows
caption buttons vs GNOME-style circles) or one custom Quiet style everywhere?
Recommend one Quiet style — less per-OS CSS, and the app already owns its look.

<a id="p14"></a>
### P14 · Responsive / small-window / zoomed layout 🟡

**Intent:** The app stays usable at `minWidth` 900 px and at high zoom — nothing
overflows or overlaps, starting with the PR header.

**Where:** Review header `review-screen.tsx:2664-2741` (title, branch, meta,
actions in one flex row) and the inbox header; window minimums in
`tauri.conf.json:18-19`; zoom in `src/lib/zoom.ts` (webview zoom multiplies the
problem — 900 px at 1.5× behaves like 600 px).

**Plan:** Audit pass at 900×600 and zoom 1.25/1.5 listing every breakage, then
fix with CSS: `min-w-0` + truncation on the title/branch, collapse low-value
meta (timestamps, counts) behind a container query or `flex-wrap`, let the
sidebar shrink to a floor. Prefer CSS container queries (WebKitGTK ≥ 2.40
supports them) over JS measurement. Keep it CSS-only if possible; if the header
needs restructuring, that's the one behavioral change.

**PRs:** One PR per surface if the audit finds more than the header (header
first). Add a small-viewport Playwright project or per-test
`page.setViewportSize({width: 900, height: 600})` checks in
`e2e/scanability.spec.ts` asserting no horizontal overflow
(`document.documentElement.scrollWidth <= innerWidth`). UI evidence:
screenshots at 1280×800 and 900×600.

---

## Wave 5 — bigger bets

<a id="p15"></a>
### P15 · File tree: folders, indentation, collapse 🔴 (stack of 2, needs decision)

**Intent:** The sidebar groups files by directory with GitHub-style
indentation and collapsible folders.

**Design tension first:** the flat list is an explicit Quiet decision —
`file-sidebar.tsx:51-55` says "directory grouping is intentionally dropped".
**Needs decision:** replace the flat list, or make tree-vs-flat a toggle?
Recommendation: build the tree as the default with a toggle back to flat,
judge in use, then delete the loser (keeping both forever fails knip's spirit).

**Plan, sliced (stack):**
- **PR 1 — grouped render:** Pure-function `buildFileTree(files)` in `src/lib/`
  (unit-tested) producing a nested structure that flattens to the **same file
  order/indices** as today — `selectedIndex`, `r`/`t`, and `onSelect(i)`
  contracts must not change. Render dirs as non-selectable headers with
  indentation; compress single-child directory chains (`a/b/c/` on one row)
  like GitHub.
- **PR 2 — collapse:** Ephemeral per-PR collapse state (component state, not
  persisted), click + `left`/`right` on a focused row to collapse/expand,
  viewed/thread/pending badge roll-up counts on collapsed folders, and
  `revealInList` (`file-sidebar.tsx:90`) auto-expanding ancestors when `r`/`t`
  move into a collapsed folder.

**PRs:** Each ~250 lines. Unit tests for `buildFileTree` + roll-ups; extend
`e2e/review.spec.ts` (collapse a folder, `r` into it, assert it reveals).
UI evidence both PRs.

<a id="p16"></a>
### P16 · More real-time updates 🟡 (webhooks: no)

**Intent:** New activity shows up in well under the current 60 s worst case
without hammering rate limits.

**Reality check:** true webhooks need a publicly reachable endpoint — a desktop
app would need a hosted relay + per-user registration. Out of scope (matches
BACKLOG.md "webhooks — post-MVP"). The right middle ground is cheaper polling:
GitHub returns `304 Not Modified` for conditional requests (`If-None-Match` /
ETag) **without consuming rate limit**, and the notifications API publishes its
own `X-Poll-Interval`.

**Plan, sliced:**
- **PR 1 — conditional inbox polling:** Cache `ETag`/`Last-Modified` per
  endpoint per account in Rust (in-memory map keyed like the cache files,
  RUST.md "On-disk cache"); on 304, return the existing cache. Then drop the
  frontend inbox `refetchInterval` from 60 s to ~15 s (`src/lib/query-client.ts`
  / `use-inbox.ts`) — cheap because most polls are 304s. GitLab: verify ETag
  support per endpoint; where absent, keep that provider at 60 s.
- **PR 2 (optional) — activity-aware detail refresh:** Piggyback on the inbox
  poll — when an open PR's `updatedAt` moves, trigger the detail refetch
  immediately instead of waiting for its own cycle (the "changed externally"
  banner already exists per BACKLOG §7).

**PRs:** `cargo test` for the conditional-request wrapper (mock 304 → cache
served); e2e freshness path already covered by `inbox.spec.ts` — extend if the
interval becomes configurable. Non-UI except the interval constant.

<a id="p17"></a>
### P17 · Apply suggestion (commit from the app) 🔴 (stack of 2, needs validation)

**Intent:** A reviewer can apply a suggestion as a commit to the PR branch
without leaving the app.

**Host reality:** GitLab has a first-class endpoint
(`PUT /suggestions/:id/apply`). GitHub has **no public API** for applying
suggestions — the only path is committing the edit yourself: read the file at
`headSha`, apply the replacement lines, `PUT /repos/{o}/{r}/contents/{path}`
with the branch — which requires push permission and fails on protected
branches or if the branch moved (handle `409`, re-fetch, surface conflicts).

**Plan, sliced (stack):**
- **PR 1 — GitLab native apply:** `apply_suggestion` on the platform seam;
  GitHub arm returns "not supported yet". Wire a button + hotkey on suggestion
  blocks in rendered comments (`markdown.tsx` renders the ```suggestion fence —
  verify how it's displayed today; suggestion **parsing** from comment bodies
  may itself be a prerequisite slice if they currently render as plain code
  blocks). Refetch detail on success.
- **PR 2 — GitHub commit path:** contents-API commit with the guards above,
  clear error surfacing (no push rights / protected branch / stale head).

**Open questions (needs decision before PR 2):** is committing to someone
else's branch from a review tool desirable default behavior? Confirmation
modal wording? Batch-apply multiple suggestions (GitLab supports it) or
one-at-a-time first? Recommend one-at-a-time + confirm modal.

**PRs:** `cargo test` with fixture payloads; e2e with bridge mocks
(apply → thread marked applied). UI evidence.

<a id="p18"></a>
### P18 · Info drawer: expandable / fullscreen 🟢

**Intent:** The info drawer (`i`) can expand beyond its fixed width for long
descriptions and threads.

**Where:** `src/components/review/right-panel.tsx` (drawer; toggled with `i`,
Esc closes — see its file header); width set in `quiet.css`.

**Plan:** Introduce a width mode (`normal | wide`) as component/screen state —
`shift+i` cycles it while open (`i` still plain toggle), wide being ~2× or a
near-fullscreen overlay (recommend ~70 % overlay with the diff dimmed behind;
true fullscreen hides context for no gain). Animate via the existing drawer
transition; keep Esc cascade order intact (`review-screen.tsx:1533`). Persist
the chosen mode in `localStorage` so it sticks per user.

**PRs:** One PR (~150 lines). e2e: open, `shift+i`, assert width class; Esc
still closes. UI evidence: both widths.

---

## Anytime

<a id="p19"></a>
### P19 · Line-comment sweep (Rust) 🟢

**Intent:** Production sources contain zero prose `//` line comments, per the
already-written policy.

**Status:** The rule the original request asked for **already exists** —
ARCHITECTURE.md "Comments" (file-header / function-doc / delete, with listed
tool-directive exceptions). TypeScript is already clean (0 offending `//` lines,
0 JSX `{/* */}`). Remaining: **~25 `//` comments in `src-tauri/src/`**.

**Plan:** For each: delete if narration; promote to `///` on the item or `//!`
in the module header if it documents an invariant; extract a named function if
it labels a section (per the "no `// ---` dividers" rule). No behavior change.

**PRs:** One PR, comment-only diff, `cargo test` green. No e2e/evidence.

<a id="p20"></a>
### P20 · Rich text editor design polish 🟡 (design-led)

**Intent:** The composer (and the info-drawer comment form) look as considered
as the rest of the Quiet direction.

**Where:** `composer-editor.tsx` (chrome + hint bar), `add-comment-box.tsx`
(used inline and in the drawer — the "info comment form could look better"
half), styles in `quiet.css`. Constraint: visual-only — the TipTap behavior,
markdown wire format, and hotkeys shipped recently (BACKLOG §5) must not change.

**Plan:** Run this as a design pass under `docs/DESIGN.md`'s direction (use the
frontend-design skill): focus states, hint-bar rhythm, suggestion-block card,
drawer form spacing/affordance. Produce before/after comps first, then one
implementation PR per surface (composer; drawer form) if both exceed budget
together.

**PRs:** CSS/markup-only; existing `composer.spec.ts` guards behavior;
UI evidence mandatory (before/after screenshots, video if focus/transition
states change).

<a id="p21"></a>
### P21 · Multi-line selection: draw a selection box ⏸ (recommend defer)

**Intent (candidate):** Drag anywhere over the code area to select a comment
range, complementing `shift+j/k` and the gutter `+` drag.

**Why defer:** The code area's drag already means native text selection, which
feeds occurrence highlighting (`occurrenceSpecFromSelection`,
`review-screen.tsx:397-417`) and copy. A selection box needs a modifier
(`alt+drag`) or a mode, adds a third way to do what two shipped mechanisms
(BACKLOG §5 multi-line ranges, 2026-07-06) already do, and GitLab-style gutter
drag is the discoverable mouse path. **Recommendation:** improve gutter-drag
discoverability (cursor affordance, wider hit area) instead; revisit box-drawing
only if range comments still feel hard with a mouse.

**If built anyway:** `alt+drag` starting on the code area maps pointer Y to
rows via the existing hit-testing (`occurrenceOriginFromPoint`,
`review-screen.tsx:326`), reusing the gutter-drag range state; same
one-side/hunk-contiguous constraints. One PR + `multiline.spec.ts` coverage.

---

## Cross-cutting notes

- **Hotkey registry pressure:** P04–P06, P10, P11, P18 all add bindings. Before
  each, check the live map in the review bindings
  (`review-screen.tsx:1334-1550`) and the help overlay; after each, the help
  overlay must show the new key (bindings with `group` do this automatically).
- **Provider parity:** every backend item (P09, P10, P12, P16, P17) goes through
  the platform seam — implement both providers or make the unsupported arm
  explicit; never let `commands.rs` know about a specific host (RUST.md).
- **Evidence discipline:** every UI item cites the e2e spec its evidence must
  come from; screenshots come from Playwright runs, not manual dev-server
  poking (split-pr "UI evidence").
