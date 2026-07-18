---
name: release
description: Cut a new Nod (Tauri desktop app) release — bump the version, draft user-facing release notes from everything that shipped since the last tag, tag and push to trigger the signed multi-platform build, then post the curated notes onto the GitHub release so the in-app "What's new" card and release history show real changelog copy instead of the generic placeholder. Use when the user asks to cut/ship/publish a release, bump the app version, or write release notes.
---

# release

Automates the full desktop release: version bump → drafted changelog → tag/push →
signed build → curated release notes on GitHub, which is what the in-app
"What's new" card (`src/components/whats-new.tsx`) and release history
(`src/components/release-history.tsx`) read from.

## The gap this closes

`.github/workflows/release.yml` always publishes the GitHub release with a
**static** body: `"See the assets below to install this version. The app
auto-updates from here on."` It has no changelog content. Every past release
(`gh release view v0.2.0/v0.1.3/v0.1.0 --json body`) has real bullet-point
notes anyway — those were added by hand afterwards with `gh release edit`.
This skill does that edit as part of the same flow instead of leaving it as a
manual follow-up.

`src-tauri/src/update.rs::list_releases` fetches public releases and passes
`body` straight through as `notes`. `e2e/whats-new.spec.ts` encodes the exact
contract this feeds: a release needs `tag` (`vX.Y.Z`), `publishedAt`, and
non-empty `notes` for the card and history view to show anything.

## Version source of truth

The shipped version comes from `src-tauri/tauri.conf.json`'s `"version"`
field — Tauri uses it in the built binary, and `get_app_version` in
`src-tauri/src/update.rs` surfaces it via `app.package_info().version`. This
is what the What's-new gate and release-history "current" dot compare
against.

`package.json` and `src-tauri/Cargo.toml` also carry a `version` field but
**past releases only bumped `tauri.conf.json`** (check `git show --stat` on
any `release: vX.Y.Z` commit — one file changes). As a result they're
currently stale (`0.1.0`) while `tauri.conf.json` is at `0.2.0`. Bump all
three in lockstep going forward — it's more correct and costs nothing — but
don't be surprised the first time this skill runs that it's also fixing
pre-existing drift.

## Procedure

### 0. Pre-flight

- `git status` — the tree must be clean before you commit a version bump. If
  it shows anything unexpected (unmerged paths, unrelated staged changes),
  **stop and surface it to the user** rather than committing around it or
  resolving it yourself — it's not part of this task.
- `git fetch --tags` and `git tag --sort=-creatordate | head -1` (or
  `gh release list --limit 1`) to find the last released version.
- Confirm you're releasing from the branch the user intends (usually `main`,
  fully pushed/up to date with origin).

### 1. Pick the next version

Ask the user for patch/minor/major if it's not obvious, or infer from what
shipped (see step 2): a release with only fixes → patch; any new
user-visible feature → minor. This repo is pre-1.0, so breaking changes still
bump minor, not major, unless the user says otherwise. Compute
`vX.Y.Z` from the last tag.

### 2. Draft the release notes

Gather what shipped since the last tag:

```sh
git log <lastTag>..HEAD --no-merges --oneline
gh pr list --state merged --search "merged:>=<lastReleaseDate>" --json number,title,body
```

Write 3-8 bullets in the voice of past releases (read a couple with
`gh release view vX.Y.Z --json body` for calibration): short noun phrases for
features, `Fixed: ...` for bug fixes, newest/most-user-visible first. Only
include things a user would notice — skip refactors, test/CI/docs-only
changes, internal chores. End with the standard closing line:

```
See the assets below to install this version. The app auto-updates from here on.
```

**Show the drafted notes to the user before doing anything irreversible.**
This copy ships publicly and is what every user sees in-app on their next
update — it's worth a quick edit pass, not a rubber stamp.

### 3. Bump the version

Update all three files to the agreed `X.Y.Z` (no `v` prefix in these files,
tags get the `v`):

- `src-tauri/tauri.conf.json` → `"version"`
- `package.json` → `"version"`
- `src-tauri/Cargo.toml` → `[package] version`

Then refresh the lockfile's entry for the local package (offline — it's a
path package, nothing to fetch):

```sh
cd src-tauri && cargo update -p pr-flow --offline
```

### 4. Run the gate

Same bar as any other change to this repo:

```sh
pnpm check && pnpm typecheck && pnpm test && pnpm knip
cd src-tauri && cargo check
```

A version bump shouldn't break any of these, but confirm before tagging —
once the tag is pushed, the build is public and the tag should never be
force-moved (see Judgment calls).

### 5. Commit

```sh
git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "release: vX.Y.Z"
```

Matches the existing commit convention (`git log --oneline | grep '^release:'`).

### 6. Confirm, then tag and push

**Pushing a tag is the irreversible, public step** — it kicks off signed
builds for 4 targets, creates a public GitHub release, and (if
`TAP_DEPLOY_KEY` is set) pushes a commit to the public `homebrew-tap` repo.
Confirm explicitly with the user before this step, showing exactly what will
run:

```sh
git push origin <branch>
git tag vX.Y.Z
git push origin vX.Y.Z
```

### 7. Watch the build

The release workflow takes ~9-10 minutes historically. Watch it rather than
polling blind:

```sh
gh run list --workflow=release.yml --limit 1 --json databaseId -q '.[0].databaseId'
gh run watch <id>
```

Report per-platform matrix failures if any job fails — do not proceed to
step 8 until the release exists (`gh release view vX.Y.Z` succeeds).

### 8. Post the curated notes

The workflow just created the release with the generic placeholder body.
Overwrite it with the drafted notes from step 2:

```sh
gh release edit vX.Y.Z --notes "$(cat <<'EOF'
<drafted bullets>

See the assets below to install this version. The app auto-updates from here on.
EOF
)"
```

### 9. Verify

```sh
gh release view vX.Y.Z --json body,assets,publishedAt
```

- `body` has the curated notes, not the placeholder.
- `assets` includes installers for macOS (both archs), Windows, Linux, plus
  `latest.json` (the updater manifest — its absence means the in-app
  auto-updater won't see this release).
- If `TAP_DEPLOY_KEY` is configured, spot-check the `update-tap` job in the
  same workflow run succeeded (it no-ops quietly if the secret is unset).

At this point the release is fully live: existing installs will see it via
`check_for_update`, and on next launch `WhatsNew` will show these exact notes
because `releasesSince` reads this release's `body`.

## Judgment calls

- **Version drift on first run**: if `package.json`/`Cargo.toml` are behind
  `tauri.conf.json`, bump all three to the new version anyway (don't try to
  "catch up" to the old `tauri.conf.json` value first — just converge on the
  new target version).
- **Never force-push or retag** an already-pushed version tag, even to fix a
  typo in release notes — `gh release edit` can still fix the notes after the
  fact (step 8 covers this), and the build/updater manifest is already
  public. If the *code* itself is broken, cut a new patch version instead.
- **Dirty or unexpected git state**: stop and ask rather than committing
  around it (see step 0). Don't resolve unrelated unmerged paths as a side
  effect of this skill.
- **Notes quality over speed**: past release notes are hand-curated,
  user-facing prose, not commit-log dumps. A generated draft that reads like
  `git log` output is a worse outcome than pausing to ask the user which
  changes actually matter.
