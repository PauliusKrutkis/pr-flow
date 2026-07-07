# Test strategy

Starting point for unit + integration coverage. This document is the plan —
no tests are implemented yet. E2E lives in its own effort; this covers the
layers under it, ordered by how much regression risk each area has actually
shown during development.

## Why now

The last few iterations broke in exactly the places a unit layer would have
caught cheaply: per-line syntax highlighting (block-comment continuations),
diff parsing edge cases, keyboard sequence handling, and cross-provider JSON
mapping (GitLab → the shared model). All of these are pure functions or
near-pure modules today — high value, low setup cost.

## Tooling (proposed)

| Layer | Runner | Notes |
| --- | --- | --- |
| TS unit + component | [Vitest](https://vitest.dev) + `@testing-library/react` + jsdom | Native Vite integration (we're on Vite 7); `pnpm --filter @pr-flow/desktop test` |
| Rust unit + integration | `cargo test` (built-in) | Fixture JSON under `src-tauri/tests/fixtures/`; no new deps beyond `serde_json` already present |
| CI | Extend `.github/workflows` with a `test` job on PRs | Typecheck + vitest + cargo test; no bundling |

Vitest over Jest: shares the Vite pipeline/config, no transform drift, faster
watch mode.

## Coverage map — TypeScript (`apps/desktop/src`)

### Priority 1 — pure logic (unit)

| Module | What to pin down |
| --- | --- |
| `lib/diff.ts` | `parsePatch`: hunk headers, add/del/context numbering, `\ No newline` metadata, empty/undefined patch, multi-hunk offsets, `changedRowCount` |
| `lib/highlight.ts` | language resolution by extension/basename; block-comment continuation heuristic (`* …`, `*/`, false-positive guard for `*ptr`); `highlightLineWithMatch` mark wrapping across token boundaries; HTML escaping of un-highlightable input |
| `components/ui/highlight.tsx` | `fuzzyIndices` (match/no-match/empty query); `HighlightMatch` multi-occurrence segmentation |
| `store/app-store.ts` | archive semantics (`dismiss`/`undoDismiss`/`isDismissed` resurfacing on newer `updatedAt`); unread (`markSeen`/`isUnread`); route persistence (`loadLastRoute` validation of malformed JSON) |
| `lib/review-memory.ts` | debounced write, merge-on-update, corrupt-storage fallback |
| `lib/time.ts` | relative formatting boundaries |

### Priority 2 — keyboard & interaction model (component/integration)

The app's core value is the keyboard layer; regressions here are UX-fatal but
invisible to typecheck.

| Area | What to pin down |
| --- | --- |
| `keyboard/keyboard-provider.tsx` | scope precedence (active vs global), two-key sequences (`]c`) + timeout, editable-target bypass, modifier combos (`mod+k`, shift-stripped alt combo), unbound-Tab swallowing, first-match-wins source ordering |
| `DiffViewer` cursor model | rAF-coalesced j/k (fake timers), hover→cursor sync, pointer-intent gate (hover with unmoved coordinates is ignored while a keyboard hold is active), boundary exit → `onCursorExit`, seed placement (`first`/`last`), jump landing + flash |
| `ReviewScreen` file navigation | active-index hysteresis (eager down / reluctant up), Tab wrap-around, `e` mark-viewed-and-advance, windowing set only grows |
| `Inbox` | archive flow end-to-end with the store (row disappears, cursor lands on neighbor, `z` restores), tab cycling incl. Shift |
| `PrSearch` | files fuzzy mode, text mode snippets (±2 context, hunk boundaries), anchor computation (LEFT/RIGHT), MAX_LINES cap |
| `CommandPalette` | entries reflect live bindings of the active scope; filter; run closes |

Component tests should drive real `KeyboardEvent`s through the provider rather
than calling handlers directly — the dispatch path is where the bugs were.

### Priority 3 — hooks with a mocked `api` (integration)

`useInbox` / `usePullRequestDetail` cache seeding (disk cache wins only when
query cache is empty), `useComments` mutation → query invalidation. Mock
`lib/api.ts` at the module boundary; no Tauri runtime needed.

## Coverage map — Rust (`apps/desktop/src-tauri`)

### Priority 1 — provider mapping (unit, fixture-driven)

The GitLab/GitHub → shared-model mappers are the highest-risk untested code
(hand-mapped JSON, live-untestable without accounts). Make mapper functions
`pub(crate)` where needed and feed them captured API fixtures:

| Module | What to pin down |
| --- | --- |
| `github.rs` | `pr_from_pull`, `pr_from_graphql`, `file_from`, `comment_from` — defaults on missing/null fields |
| `gitlab.rs` | `mr_to_pr` (iid→number, `references.full` owner/name split incl. subgroups, state mapping opened/merged), `file_from_diff` (new/deleted/renamed, diff stats), `note_to_comment` (root vs reply threading, LEFT/RIGHT from position), `enc` percent-encoding (`/`→`%2F`, unicode), `diff_stats` |
| `accounts.rs` | `account_id` sanitization, `normalize_host` (default hosts, scheme-less input, trailing slash) |

### Priority 2 — storage & migration (integration, tempdir)

Legacy `token.json` → `accounts.json` migration (with unreachable network →
placeholder login path), `load`/`save` round-trip, corrupt-file fallback,
per-account cache naming. Needs a small `AppHandle`-free refactor: extract the
path-independent logic or inject the config dir.

### Priority 3 — auth plumbing

`wait_for_code` / `handle_connection` request parsing (state mismatch, error
params, non-callback paths) against a loopback `TcpStream`.

## Explicitly out of scope here

- E2E flows (separate PR/effort).
- Visual regression on the Quiet design system.
- Live-network provider tests (fixtures stand in; a manual GitLab smoke
  checklist can live in `docs/RELEASING.md` later).

## Suggested landing order

1. Vitest scaffolding + `lib/diff` + `lib/highlight` (pure, immediate value).
2. Rust mapper fixtures (gitlab.rs especially — it has never run against real data).
3. KeyboardProvider dispatch suite.
4. DiffViewer cursor model with fake timers.
5. Store/hooks integration; CI job once 1–2 exist.
