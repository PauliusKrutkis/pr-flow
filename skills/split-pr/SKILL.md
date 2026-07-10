---
name: split-pr
description: Split a large branch or work-in-progress diff into a sequence of small, independently testable pull requests. Use when the user asks to split a PR, break up a branch, ship a big change as reviewable PRs, or asks whether a diff is too large. Also defines the quality gate every PR must pass (CI green, knip green, size budget, UI evidence).
---

# split-pr

Turn one large change into a sequence of small PRs that are each independently reviewable, testable, and CI-green.

## Core rules (the gate)

Every PR produced by this skill MUST satisfy all of the following before it is opened:

1. **One intent per PR.** A reviewer can state what the PR does in one sentence. If the description needs "and also", split further.
2. **Soft size budget: ~300 changed lines** of hand-written, non-test diff. This is a guideline, not a hard cap:
   - Excluded from the count: lockfiles (`pnpm-lock.yaml`), generated files, snapshots, pure renames/moves, test code.
   - Exceeding the budget is allowed but must be justified in one sentence in the PR description (e.g. "mechanical rename across 40 files").
3. **Independently testable.** The PR contains or updates the tests that prove its own change. A PR whose behavior can only be verified by a later PR in the stack is sliced wrong.
4. **Full gate passes locally** before opening the PR:
   ```sh
   pnpm check      # biome/ultracite lint + format
   pnpm typecheck  # tsc --noEmit
   pnpm test       # vitest unit tests
   pnpm knip       # no dead/unwired code
   pnpm e2e        # playwright, required when src/ UI or e2e/ changed
   ```
   If `src-tauri/` changed, also run `cargo test` in `src-tauri/`.
5. **knip must be green in every PR.** This is the anti-dead-code rule and it shapes how you slice (see "Slicing strategy").
6. **UI PRs require visual evidence** (see "UI evidence").

## Slicing strategy

Prefer **vertical slices**: every PR wires its new code into the app end to end, so nothing is dead and knip stays green naturally.

- Good slice: "Add thread-collapse toggle: store action + component + e2e test."
- Bad slice: "Add types and store scaffolding for thread collapse" (nothing uses it; knip fails; reviewer cannot judge it).

Ordering heuristics for planning slices out of a big diff:

1. **Pure refactors first** (renames, extractions, moves that change no behavior). These shrink the later diffs and are fast to review.
2. **Behavior changes next**, one user-visible capability per PR, each with its tests.
3. **Cleanup last** (removing old code paths, flags, dead exports).

**Fallback: stacked PRs.** If a vertical slice is still far over budget, split it into a stack where each PR's base branch is the previous PR's branch (not `main`). Rules for stacks:

- Each PR in the stack must still pass the full gate against its own base.
- knip must be green at every level; if PR N introduces something only PR N+1 uses, move that code into PR N+1 instead of ignoring the knip error. Do not add knip ignores or `@lintignore` tags to paper over stack ordering.
- Note the stack position in each PR description: "Stack 2/4, based on `<branch>`".
- Merge order is bottom-up; after each merge, rebase the rest of the stack.

**Never slice horizontally by layer** ("all types", "all store changes", "all components"). It defeats testability and knip.

## Procedure

Given a large branch, diff, or described change:

1. **Measure.** Run `git diff --stat <base>...HEAD` (base is usually `main`). Report total lines and per-file breakdown, excluding lockfiles/generated files from the budget count.
2. **Plan the slices.** Read the diff and group hunks by intent using the ordering heuristics above. Present the plan as a numbered list: slice name, files/hunks included, estimated line count, test plan, and whether it is UI (needs evidence). Get user approval before rewriting any branches.
3. **Build each slice** on a fresh branch from the correct base:
   - Use `git checkout -b <slice-branch> <base>` then apply the relevant hunks (`git checkout <source-branch> -- <files>` for whole files, `git apply` with extracted patches, or interactive staging for mixed files).
   - Never mutate the user's original branch; it stays untouched as the source of truth.
4. **Run the full gate** (rules 4-5 above). Fix failures within the slice's intent; if a fix belongs to another slice, move the hunk there and re-plan.
5. **Capture, host, and embed UI evidence** if the slice touches UI — upload to the `pr-evidence` release and put the resulting URLs in the body (see "UI evidence"). A bare `evidence/*.png` path in the description does not render.
6. **Open the PR** with `gh pr create`, base set correctly (main, or previous stack branch). Description template:

   ```markdown
   ## What
   <one sentence of intent>

   ## Why
   <context; link to the umbrella issue/branch>

   ## Test plan
   - [ ] pnpm check / typecheck / test / knip green
   - [ ] pnpm e2e green (if UI)
   - <specific tests added/updated and what they prove>

   ## Evidence (UI PRs)
   ![<caption>](https://github.com/<owner>/<repo>/releases/download/pr-evidence/<asset>.png)
   <one embedded image per screenshot; for video, link the asset: [▶ <caption>](…/pr-evidence/<asset>.webm)>

   Stack: N/M, based on `<base-branch>` (omit if standalone)
   Size note: <justification, only if over ~300 line budget>
   ```
7. **Repeat** for each slice. For stacks, remind the user of the bottom-up merge order and rebase obligation.

Do not push or open PRs without the user's go-ahead on the plan.

## UI evidence

A PR counts as a UI PR if it changes anything rendered (components, styles, layout) under `src/`.

### Capture

- **Screenshots: always.** Capture from the Playwright run at 1280x800 (the configured viewport), showing the changed surface before/after where meaningful. Use `page.screenshot()` in the relevant spec or `--update-snapshots` artifacts.
- **Video: only when interaction or animation changed** (hover, drag, transitions, scrolling behavior, keyboard flows). Run the relevant spec with video enabled:
  ```sh
  pnpm exec playwright test <spec> --project=chromium
  ```
  with `use: { video: 'on' }` passed via a temporary config override or `--config` variant; use the resulting `test-results/**/video.webm`.
- Every UI slice must include or extend a Playwright e2e spec in `e2e/` that exercises the changed UI; the evidence must come from that spec run, not from manually poking the dev server.
- Remember e2e runs on its own port (default 14205, `E2E_PORT` to override) and never reuses a running server.
- Save captured files under `evidence/` with a slice-scoped prefix so asset names never collide across PRs (e.g. `p05-collapsed.png`, `chunk-keybind-cursor.png`).

### Host, then embed (required — a bare file path never renders)

A PR description does **not** resolve repo-relative paths, and `gh pr create` cannot upload files. Listing `evidence/foo.png` as text produces nothing on GitHub. Every asset must be uploaded to a stable URL and embedded with that URL. This skill uses a single rolling GitHub **release** (`pr-evidence`) as the asset host — it never merges into any branch, so nothing pollutes a PR diff.

1. Ensure the release exists (once per repo; harmless if it already does):
   ```sh
   gh release view pr-evidence >/dev/null 2>&1 || \
     gh release create pr-evidence --title "PR evidence" \
       --notes "Rolling asset host for split-pr UI evidence. Not a real release." --latest=false
   ```
2. Upload the slice's assets (`--clobber` lets you re-upload after re-capturing):
   ```sh
   gh release upload pr-evidence evidence/p05-collapsed.png evidence/p05-expanded.png --clobber
   ```
3. Build each asset's URL as `https://github.com/<owner>/<repo>/releases/download/pr-evidence/<asset>` (derive `<owner>/<repo>` from `gh repo view --json nameWithOwner -q .nameWithOwner`), and embed it in the PR body:
   - **Images** embed inline with `![caption](url)`.
   - **Video** does **not** get an inline player from a release URL — GitHub only auto-embeds a `<video>` for its own `user-attachments` uploads. Link it instead: `[▶ caption](url)`. If an inline player is genuinely needed, drag the `.webm`/`.mp4` into the PR body in the web UI as a one-off and use the resulting `user-attachments` URL.
4. Verify after opening: `gh pr view <n> --web` and confirm each image actually renders (not a broken-image icon).

## Judgment calls

- If the whole change already fits the budget and gate, say so and open a single PR; do not split for the sake of splitting.
- Mixed mechanical + behavioral changes in one file: split the mechanical part (rename/move) into its own earlier slice so the behavioral diff reads clean.
- Test-only or docs-only changes have no size budget concern but still need the gate (minus e2e evidence).
- If a slice cannot be made independently testable no matter how you cut it, tell the user which slices must merge together and why, rather than shipping an untestable PR.
