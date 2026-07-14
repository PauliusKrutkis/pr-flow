# Monorepo conversion + web deployment

> **Status: planned, not started.** PR 1 is buildable now; PR 2 is blocked on
> the open feature branches merging.

## Context

The go-to-market direction (landing page in BACKLOG, future license
activation/restore pages) needs a web presence, and the repo should become a
real pnpm monorepo — today `pnpm-workspace.yaml` is an invalid stub and
everything lives at the root. The `design/rework` branch already uses an
`apps/* + packages/*` layout (design-lab), so converging `main` to the same
shape also unblocks merging design work later.

**Decisions (2026-07-12):**

- **Hosting: Cloudflare Pages** — free tier, per-PR preview deploys, and Pages
  Functions/Workers on the same platform so the future license webhook and
  `/activated` / `/restore` pages live next to the site. (Vercel's Hobby tier
  prohibits commercial use; Pro is ~$20/mo.)
- **Web stack: Astro + Tailwind v4** — static-first, ships ~zero JS for a
  content page (fast landing page = on-brand); React islands can reuse
  Quiet-style components later.
- **The desktop move waits until open PRs merge** — 6+ in-flight branches
  would hit rename conflicts. Hence two PRs, additive first.

## PR 1 — workspace bootstrap + `apps/web` (buildable now; adds files, moves nothing)

1. **`pnpm-workspace.yaml`** — replace the stub with a real workspace:
   `packages: ["apps/*", "packages/*"]` (+ `onlyBuiltDependencies: [esbuild]`
   to resolve the placeholder's intent). The root package (desktop app) stays
   the workspace root package for now — pnpm supports this.
2. **Scaffold `apps/web`** — Astro (minimal template) + Tailwind v4 via
   `@tailwindcss/vite`, package name `@nod/web`. One page
   (`src/pages/index.astro`): hero with the one-liner, download section
   (Homebrew command + GitHub release links), placeholder slot for the demo
   video, footer. Quiet-direction aesthetic (dark, calm, monospace accents —
   reference `apps/design-lab` on `design/rework` for tokens). No CMS, no
   analytics, no extra pages yet.
3. **Deploy — Cloudflare Pages via git integration** (works with the private
   repo through Cloudflare's GitHub App): root directory `apps/web`, build
   `pnpm build`, output `dist`. Zero CI to maintain; every PR gets a preview
   URL; ships on `*.pages.dev` until a domain is bought. Connecting the
   Cloudflare account to the repo is a one-time manual dashboard step.
   Document the setup in a new "Web" section of `docs/RELEASING.md`.
4. **Keep existing checks green** — add `apps/web/**` to `knip.jsonc` ignores
   (root knip isn't workspace-aware yet); desktop vitest/playwright/biome
   configs are untouched by an additive directory.

## PR 2 — move desktop → `apps/desktop` (AFTER open branches merge)

Inventory of every path coupling (done 2026-07-12); the mechanical changes:

- **`git mv` to `apps/desktop/`**: `src/`, `src-tauri/`, `e2e/`,
  `index.html`, `vite.config.ts`, `vitest.config.ts`, `vitest.setup.ts`,
  `playwright.config.ts`, `tsconfig.json`, `tsconfig.node.json`,
  `knip.jsonc`, `doctor.config.json`. `evidence/`, `test-results/`,
  `packaging/`, `docs/`, `skills/`, `.github/` stay at root.
- **`apps/desktop/package.json`** — current root package.json (deps +
  scripts) with name `@nod/desktop`.
- **New root `package.json`** — private orchestrator whose scripts alias
  through (`"test": "pnpm --filter @nod/desktop test"`, same for `dev`,
  `build`, `typecheck`, `e2e`, `check`, `fix`, `knip`, `tauri`). This keeps
  **e2e.yml, lint.yml, the split-pr quality gate, and muscle memory working
  unchanged**.
- **`src-tauri/tauri.conf.json`** — `frontendDist` stays `../dist` (vite
  outDir is now `apps/desktop/dist`); `beforeDevCommand` /
  `beforeBuildCommand` stay `pnpm dev` / `pnpm build` (resolved in
  `apps/desktop`). Verify with a real `tauri dev` + local build.
- **Workflow edits** (the only CI changes): `release.yml` →
  `projectPath: apps/desktop` + rust-cache
  `workspaces: apps/desktop/src-tauri`; `test.yml` → cargo manifest path +
  same rust-cache key; `react-doctor.yml` → `directory: apps/desktop`.
- **Docs/skills path updates**: `README.md`, `AGENTS.md`,
  `docs/ARCHITECTURE.md`, `docs/RUST.md`, `docs/TESTING.md`,
  `docs/RELEASING.md`, `skills/split-pr/SKILL.md` — prepend `apps/desktop/`
  where they reference `src/` / `src-tauri/`.
- `.gitignore`: patterns are unrooted (`dist`, `test-results/`) so they keep
  matching nested paths; verify only.

## Later (recorded, not in scope)

- `packages/ui` promotion from design-lab (design/rework merge).
- Pages Functions for `/activated`, `/restore` + merchant-of-record webhook
  (monetization phase 1) — lives naturally next to `apps/web` on Cloudflare.
- Domain purchase + DNS on Cloudflare.

## Verification

**PR 1:** `pnpm install` clean · `pnpm --filter @nod/web dev` serves the
page · `pnpm --filter @nod/web build` emits `apps/web/dist` · full existing
desktop gate stays green (`pnpm check / typecheck / test / knip / e2e`) ·
Cloudflare Pages preview URL renders.

**PR 2:** full gate green again (incl.
`cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`) ·
`pnpm tauri dev` boots the app · local `pnpm tauri build --bundles app`
produces `Nod.app` · next `v*` tag exercises release.yml (RELEASING.md
already predicts one round of CI fixup; the projectPath change lands in the
same round).
