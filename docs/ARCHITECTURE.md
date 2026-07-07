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

Do **not** use inline `//` line comments in source files. Comments belong in
one of three places:

1. **File header** — a single `/** … */` block (TypeScript) or `//! …` module
   doc (Rust) at the top of the file, before imports. Use this for module-level
   rationale: non-obvious invariants, performance constraints, or cross-cutting
   behavior that applies to the whole file.

2. **Item docs** — `/** … */` on exported functions, types, and non-obvious
   constants (TS), or `/// …` on public items (Rust). Only when the name alone
   does not convey the behavior.

3. **Nowhere** — if the code is self-explanatory, delete the comment.

### Allowed exceptions

These are tool directives, not documentation — keep them as `//` on their own
line:

- `// eslint-disable-next-line …`
- `// @ts-expect-error …` / `// @ts-ignore …`
- `// biome-ignore …`
- `/* ignore */` inside catch blocks that intentionally swallow errors

### Rust

- Module docs: `//!` at the top of the file.
- Item docs: `///` on structs, fields, and functions where semantics matter
  (especially serde fields the frontend depends on).
- No `// ---` section dividers — use blank lines or extract a function.

### TypeScript / React

- Prefer one file-header block over scattered state comments in large
  components. Complex interaction models (cursor vs selection vs find bar)
  belong in the module doc or on the owning hook/function.
- Do not restate what a variable name already says (`// Per-file comment
  buckets` above `commentsByFile` adds nothing).
- Block comments (`/** … */`) only — no `//` prose.

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
