# Architecture

This document captures structural decisions and coding conventions for the
Nod (PR Flow) codebase. For product overview and the runtime diagram, see the
[README](../README.md).

---

## Layering

```
Webview (React)  →  invoke() / typed wrappers (src/lib/api.ts)
                 →  Tauri commands (src-tauri/src/commands.rs)
                 →  Platform seam (platform.rs)
                 →  GitHub / GitLab implementations
```

The webview never holds tokens or calls host APIs directly. All network I/O
runs in Rust; the frontend consumes serde-shaped JSON via TanStack Query.

Key directories:

| Path | Role |
| ---- | ---- |
| `apps/desktop/src/components/` | Screens and UI |
| `apps/desktop/src/lib/` | Pure logic (diff parsing, find, highlights) |
| `apps/desktop/src/store/` | Zustand UI state (viewed files, pending comments, route) |
| `apps/desktop/src/keyboard/` | Global hotkey layer |
| `apps/desktop/src-tauri/src/` | Backend: auth, cache, platform APIs |

---

## Comments

These rules apply to production code (`apps/desktop/`, `packages/`, Rust
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
  into the file header (see `apps/desktop/src/types.ts`).
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
  file-header block at the top only. `apps/desktop/src/quiet.css` is legacy
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

## State and caching

- **TanStack Query** — in-memory PR/inbox cache; 60s polling + refetch on
  focus.
- **Zustand (`appStore`)** — viewed files, pending review comments, route,
  accounts. Persisted subsets use localStorage or Tauri JSON files.
- **Review memory** — per-PR scroll/cursor position; separate from viewed
  fingerprints.

See [TESTING.md](./TESTING.md) for what to test when touching these layers.
