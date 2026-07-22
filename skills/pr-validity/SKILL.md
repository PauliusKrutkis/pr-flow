---
name: pr-validity
description: Review a PR or branch diff for validity against this repo's conventions — comment placement per docs/ARCHITECTURE.md, unnecessary React effects, hand-rolled UI where shadcn would be richer, performance issues, naming, file/folder placement, readability, and general code quality. Use when the user asks to check, validate, or review a PR or the current branch. Findings are confirmed with the user before anything is fixed.
---

# pr-validity

Review a diff against eight checks, report findings ranked by severity, and **only fix what the user approves**. This skill never edits code before the user has confirmed which findings to act on.

## Scope of the review

Determine what to review, in this order:

1. A PR number or URL given by the user → `gh pr diff <n>` and `gh pr view <n>` for context.
2. Otherwise the current branch → `git diff <base>...HEAD` where base is `main` (or the PR's actual base).
3. Uncommitted work if the user says so → `git diff` + `git diff --staged`.

Review the full file for every touched file, not just the hunks — a diff-only view hides violations the change introduces in context (e.g. an effect whose deps live outside the hunk). Do not review files the PR does not touch.

## Check 1 — Comments match docs/ARCHITECTURE.md

Read `docs/ARCHITECTURE.md` (section "Comments") first; it is the source of truth and overrides this summary. Condensed rules for production code (`src/`, `src-tauri/src/`):

- No inline `//` prose comments. Comments live in exactly three places: one `/** … */` file header (Rust: `//!`), `/** … */` on functions where the signature isn't enough (Rust: `///`), or nowhere.
- No doc blocks on interface/type members, exported consts, `useState`/`useRef` declarations, or JSX (`{/* … */}` section labels are violations).
- No mid-file CSS comments; no `// ---` section dividers in Rust.
- Allowed as-is: `// eslint-disable-next-line`, `// @ts-expect-error`, `// biome-ignore`, `/* ignore */` in intentionally-empty catch blocks.
- Tests (e2e): file-level scenario block OK; step narration (`// Click submit`) is a violation unless it documents a timing/race workaround.

Scan test files too — run this check over `e2e/` specs, not just `src/` and `src-tauri/src/`. Step narration in specs is the most commonly missed violation.

Flag both directions: comments added where they're banned, and deleted code whose non-obvious rationale should have moved to a file header.

## Check 2 — Effect usage (You Might Not Need an Effect)

Apply <https://react.dev/learn/you-might-not-need-an-effect>. An effect is only justified for **synchronizing with something outside React** (subscriptions, DOM measurement, Tauri events, timers, imperative widget APIs). Flag these patterns in added/changed code:

- **Derived state via effect** — `useEffect` that computes a value from props/state and calls a setter. Fix: compute during render (memoize only if provably expensive).
- **Resetting state when a prop changes** — effect watching a prop to reset state. Fix: `key` on the component, or compute-during-render comparison.
- **Event logic in an effect** — effect that reacts to a state flag set by a handler (`useEffect(() => { if (submitted) … })`). Fix: put the logic in the event handler.
- **Effect chains** — effects that set state to trigger other effects. Fix: compute everything in one place (handler or render).
- **Syncing state to props for "initialization"** — `useEffect(() => setX(props.x), [props.x])`. Fix: lift state, key, or fully controlled/uncontrolled.
- **Data fetching via raw effect** — this repo uses TanStack Query for server state; a hand-rolled fetch effect is a violation unless it synchronizes with a non-Query external system.
- **Notifying the parent via effect** — calling `onChange` from an effect after state settles. Fix: call it in the handler that caused the change.

For each flagged effect, state which pattern it matches and the concrete non-effect rewrite. If an effect is legitimate, leave it alone — do not pad the report.

## Check 3 — shadcn vs hand-rolled components

shadcn/ui components ship with keyboard navigation, focus management, ARIA wiring, and polished interaction states that hand-rolled equivalents almost never match. When the diff **introduces or substantially rewrites** a UI primitive — dialog/modal, dropdown/select, tooltip, popover, tabs, accordion, toast, combobox/command palette, context menu, switch/checkbox/radio, slider — flag it and propose the shadcn equivalent, noting concretely what the hand-rolled version is missing (e.g. "no focus trap, Escape doesn't close, no `aria-expanded`").

Repo-specific nuance:

- Reuse first: if an equivalent already exists under `src/components/ui/`, the finding is "use the existing primitive", not "add shadcn".
- Restyling is not a blocker — shadcn components are owned source and can be themed to the Quiet system; say so in the finding.
- Do not flag simple presentational markup (a styled `div`, a badge, a list). The trigger is interactive behavior that's hard to get right, not any custom JSX.

## Check 4 — Performance

Flag with a plausible impact statement, not reflexively:

- Expensive computation in render without memoization when inputs are stable and the component re-renders often (large diff parsing, big list transforms).
- Unstable references (inline objects/arrays/functions) passed to memoized children or used as hook deps, defeating memoization or causing effect churn.
- Missing keys or index-as-key on reorderable lists.
- Large lists rendered without virtualization where the data is unbounded (files in a PR, comment threads).
- TanStack Query misuse: `refetch` in effects, disabled caching, per-item queries in a loop (request waterfalls / N+1 `invoke` calls into the Rust backend).
- Subscribing a component to more Zustand state than it uses (whole-store selectors causing broad re-renders).
- Rust side: cloning large payloads unnecessarily, serializing per-item instead of batching, blocking calls on the main thread.

Skip micro-optimizations with no measurable path to user-visible impact; this app's perf bar is non-mac hardware, so lean toward flagging real render-loop work.

## Check 5 — Naming (variables, functions, files)

- Names say what a thing is or does, at the right level of abstraction: `remainingRetries`, not `n`; `parseDiffHeader`, not `processData`.
- Flag: vague fillers (`data`, `info`, `manager`, `util`, `helper`, `temp`), misleading names (a `get*`/`use*` that mutates, an `is*` that isn't boolean), names that encode type instead of meaning (`userList`, `strName`), and non-universal abbreviations.
- Consistency beats taste: TypeScript uses camelCase (PascalCase for components/types), Rust uses snake_case (PascalCase for types); match the vocabulary already dominant in the codebase (don't introduce `fetch*` where the repo says `load*`).
- Booleans read as predicates (`isReady`, `hasAccess`, `canRetry`); hooks are `use*`; component files are named after their component; Rust modules after their responsibility.
- Naming matters double here because comments are banned (Check 1) — a name that needs a comment to explain it is a naming finding, not a missing-comment finding.

## Check 6 — File and folder placement

Hard layering rules (per ARCHITECTURE.md — violations are blockers):

- Webview never holds tokens or does network I/O; new backend calls go through typed wrappers in `src/lib/api.ts`.
- Pure logic belongs in `src/lib/`, UI state in `src/store/`, reusable primitives in `src/components/ui/`, Rust backend code in `src-tauri/src/`.

Softer placement recommendations (propose a target path and name the convention the current placement breaks):

- Business logic written inline in a component when `src/lib/` is the home for it; store selectors/derivations living in components instead of `src/store/`.
- Utilities duplicated instead of joining the existing shared location; a new folder introduced when an existing one fits the responsibility.
- Test specs that don't sit where the repo's other e2e specs sit.
- Oversized files: when a change pushes a file well past its neighbors' norms, recommend the split and where each piece belongs.

## Check 7 — Readability

- Deep nesting → guard clauses / early returns.
- Long functions or components doing several things → extract a function, subcomponent, or custom hook, with names for each step.
- Boolean expressions that need parsing → explaining variables or predicate functions (this is the self-documenting fix Check 1 demands instead of a comment).
- Clever one-liners, dense chains, or expression golf where a plain version is as fast → propose the plain version.
- Magic numbers/strings → named constants when the meaning isn't obvious in context.
- Long prop or argument lists that make call sites unreadable → a props/params object per the surrounding idiom.
- Duplicated blocks within the diff → extract, but only when the duplication is real (same reason to change), not coincidental similarity.
- Formatting is Biome's job — don't hand-flag style that `pnpm check` fixes.

## Check 8 — General code review

- Correctness: broken edge cases, race conditions, unhandled errors (especially `invoke` rejections), wrong types papered over with `as`.
- Dead code: unexported-but-unused, or exported-and-unwired (knip will catch it — say so).
- Tests: does the PR carry the tests that prove its own change (see TESTING.md)?
- Gate: note whether `pnpm check`, `pnpm typecheck`, `pnpm test`, `pnpm knip` (and `cargo test` if `src-tauri/` changed) pass; run them if the working tree matches the reviewed diff.

## Reporting and confirmation (required)

1. Collect findings from all eight checks. Deduplicate; one finding per root cause.
2. Present them ranked by severity — **blocker** (correctness, layering violation), **should-fix** (convention violations: comments, effects, shadcn, naming, placement, readability, real perf issues), **suggestion** — each with `file:line`, which check it came from, why it matters, and the concrete proposed fix.
3. **Stop and confirm with the user which findings to fix before editing anything.** Use AskUserQuestion (multi-select) when the list is short, or present the numbered list and ask which to apply. "No findings" is a valid outcome — say so and stop.
4. Apply only the approved fixes, then re-run the relevant gate commands and report results. Leave declined findings out of the code; summarize them at the end so they're on record.
