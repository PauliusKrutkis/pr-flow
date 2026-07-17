# Architecture

This document captures structural decisions and coding conventions for the
Nod (PR Flow) codebase. For product overview and the runtime diagram, see the
[README](../README.md).

---

## Layering

```
Webview (React)  →  invoke() / typed wrappers (src/lib/api.ts)
                 →  Tauri commands (auth, accounts, commands, update)
                 →  accounts::active_platform
                 →  Platform seam (platform.rs)
                 →  GitHub / GitLab implementations
                 →  storage (JSON cache on disk)
```

The webview never holds tokens or calls host APIs directly. All network I/O
runs in Rust; the frontend consumes serde-shaped JSON via TanStack Query.

**Rust backend detail:** module map, command list, cache files, and “where to
look” guide → **[RUST.md](./RUST.md)**.

Key directories:

| Path | Role |
| ---- | ---- |
| `src/components/` | Screens and UI |
| `src/lib/` | Pure logic (diff parsing, find, highlights) |
| `src/store/` | Zustand UI state (viewed files, pending comments, route) |
| `src/keyboard/` | Global hotkey layer |
| `src-tauri/src/` | Backend — see [RUST.md](./RUST.md) |

---

## Comments

These rules apply to production code (`src/`, Rust
backend).

Do **not** use inline `//` line comments in production source files. Comments
belong in one of three places:

1. **File header** — a single `/** … */` block (TypeScript) or `//! …` module
   doc (Rust) at the top of the file, before imports. Use this for module-level
   rationale: non-obvious invariants, performance constraints, field semantics
   on shared types, or cross-cutting behavior that applies to the whole file.

2. **Function docs** — `/** … */` immediately above a function (or method) when
   the name and signature are not enough. Not on variables, hooks, or React
   state inside a component body.

3. **Nowhere** — if the code is self-explanatory, delete the comment.

### What not to document inline

- **Type or interface members** — no `/** … */` on individual properties inside
  `interface`, `type`, props, or store shapes. Fold non-obvious field meaning
  into the file header (see `src/types.ts`).
- **Exported types and constants** — no separate doc block on `export interface
  Foo`, `export const BAR`, or `export const Foo = forwardRef(…)`; describe them
  in the file header if needed.
- **Component state and refs** — no doc blocks between `useState` / `useRef`
  declarations; put interaction-model notes in the file header once.
- **JSX markup** — no `{/* … */}` section labels in render trees (`{/* file list
  */}`, `{/* ============ CENTER ============ */}`). Layout should be obvious
  from structure and class names; non-obvious UI behaviour belongs in the file
  header.
- **CSS** — no mid-file `/* … */` comments in production stylesheets. One
  file-header block at the top only. `src/quiet.css` is legacy
  and being migrated incrementally.

### Allowed exceptions

These are tool directives, not documentation — keep them as `//` on their own
line:

- `// eslint-disable-next-line …`
- `// @ts-expect-error …` / `// @ts-ignore …`
- `// biome-ignore …`
- `/* ignore */` inside catch blocks that intentionally swallow errors

### Rust

- Module docs: `//!` at the top of the file.
- Item docs: `///` on functions and on struct fields only when the serde/API
  contract is non-obvious (especially fields the frontend depends on).
- No `// ---` section dividers — use blank lines or extract a function.

### TypeScript / React

- One file-header block beats scattered docs anywhere else in the file.
- Block comments (`/** … */`) only — no `//` prose and no `{/* … */}` in JSX.
- JSDoc on `@param` / `@returns` is fine on functions when the behavior is not
  obvious from the signature alone.

### Tests (e2e)

- Keep a file-level scenario block when the test mocks non-obvious behavior.
- Drop step-by-step narration (`// Click submit`, `// Wait for load`) unless
  the step documents a timing/race workaround.

---

## Code view: own implementation, no editor library

**Decision (2026-07-15):** every surface that renders code — the diff, and the
planned full-file context expansion — is built on our own rendering stack
(highlight.js per line + `CodeCell` + the pure matchers in `src/lib/`), not on
an editor component like CodeMirror or Monaco. Reading-and-navigation features
(find bar, occurrence highlighting, future go-to-definition once repo sync
lands) are added to this stack, not bought.

Why:

- **The core surface has no off-the-shelf equivalent.** The review pane is
  find/occurrences over a *lazily mounted, multi-file patch stream* — matches
  computed from patch text, anchored `SIDE:line`, coexisting with comment
  threads, plus-drag, intraline marks, and the overview ruler. Editor merge
  views diff two whole documents; nothing does GitHub-patch hunks across a PR.
  The diff stays custom no matter what, so a library could only ever cover
  secondary surfaces.
- **A second stack is drift by construction.** Adopting CodeMirror for a
  full-file surface means two find UIs, two mark styles, two keyboard models,
  and a theme kept in sync by hand — the exact divergence a single code view
  is meant to prevent. The entire value of any full-file surface is "same
  reading experience as the diff, just more context".
- **It fights the interaction model.** Editor widgets are focus-hungry;
  this app's keyboard system (Tab never moves focus, no focus rings, armed
  highlights) and native `<dialog>` model don't compose with an embedded
  editor's focus trap.
- **The features we want are marks and jumps, not editing.** Go-to-definition
  is token hit-testing (the occurrence code already does text-node column
  math), a mark on hover (same layering as find/occurrence marks), and a jump
  (the existing anchor machinery). Repo sync supplies the data source
  (tree-sitter/LSP over the local checkout); none of it needs an editor.

How the single code view is achieved (headless sharing, not one mega
component — the same split VS Code uses internally, one FindController across
editor and diff editor):

- **One paint unit** — `CodeCell` / `highlightRowHtml`
  (`src/components/review/code-cell.tsx`): the only way a code line reaches
  the DOM. New surfaces must render it.
- **One matcher** — `findMatchRangesInLine` (`src/lib/find-in-diff.ts`); find
  and occurrences both ride it, so "what counts as a hit" cannot fork.
- **One navigation** — anchors + `buildOccNav`/find-step over match lists;
  surfaces differ only in their match *source* and scroll-to-anchor.

Because `code-cell.tsx` deliberately co-locates the `highlightRowHtml` helper
with the `CodeCell` component, React Doctor's `only-export-components` warning
on that file is expected — it is the cost of the single paint unit, not a
regression to "fix".

**Re-evaluation trigger:** if a feature needs the document to restructure
under the reader — code folding, semantic re-highlighting, inline widgets
between arbitrary tokens — we would be rebuilding an editor's
decoration/viewport system. That is the point to reconsider a library, not
before.

---

## State and caching

- **TanStack Query** — in-memory PR/inbox cache; 60s polling + refetch on
  focus.
- **Zustand (`appStore`)** — viewed files, pending review comments, route,
  accounts. Persisted subsets use localStorage or Tauri JSON files.
- **Review memory** — per-PR scroll/cursor position; separate from viewed
  fingerprints.

See [TESTING.md](./TESTING.md) for what to test when touching these layers.

---

## Linting and formatting

[Ultracite](https://www.ultracite.ai/) (Biome preset) is configured at the repo root.

| Command | Purpose |
| ------- | ------- |
| `pnpm check` | Lint + format check (CI) |
| `pnpm fix` | Auto-fix safe issues |
| `pnpm exec ultracite doctor` | Verify setup |

Config: `biome.jsonc` extends `ultracite/biome/{core,react,vitest}`.
