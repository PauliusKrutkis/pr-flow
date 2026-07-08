# Releasing Nod

Everything about shipping desktop builds: cutting a release, testing
auto-updates (no public repo needed), Homebrew, and the checklist for going
public later.

## TL;DR — cut a release

```bash
# 1. Bump the app version (this is what the updater compares against)
#    src-tauri/tauri.conf.json  →  "version": "0.1.1"

# 2. Commit, tag, push
git commit -am "release: v0.1.1"
git push
git tag v0.1.1 && git push origin v0.1.1
```

The `v*` tag triggers `.github/workflows/release.yml`, which:

1. Builds bundles on macOS (arm64 + x64), Windows (`.msi`) and Linux
   (`.deb` / `.AppImage`).
2. Signs the updater artifacts (`.app.tar.gz` + `.sig`, etc.) with the
   minisign key from the repo secrets.
3. Publishes a GitHub Release with all assets **plus `latest.json`** — the
   manifest the in-app updater polls
   (`https://github.com/PauliusKrutkis/pr-flow/releases/latest/download/latest.json`).
4. Bumps the Homebrew tap (only when the `TAP_REPO_TOKEN` secret exists —
   skipped quietly otherwise).

Installed apps poll that manifest, show the "Update available" prompt, and
install + relaunch in one click.

## One-time setup (already done / still to do)

| Item | Status |
| --- | --- |
| Updater signing keypair | ✅ `~/.tauri/prflow.key` (passwordless). **Back this file up** (password manager / secure storage). If it's lost, installed apps can never verify another update — the chain is dead and users must reinstall manually. |
| Public key in `tauri.conf.json` | ✅ `plugins.updater.pubkey` |
| Repo secrets | ✅ `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty) |
| Homebrew tap repo | ✅ `PauliusKrutkis/homebrew-tap` (public), seeded with the v0.1.0 cask. The release workflow pushes bumps over SSH via the `TAP_DEPLOY_KEY` secret — a deploy key that can write only to that one repo. Cask template: `packaging/homebrew/Casks/nod.rb`. |
| OAuth in released builds | ✅ Baked in at compile time (`option_env!` in auth.rs): secrets `PRFLOW_GH_CLIENT_ID` / `PRFLOW_GH_CLIENT_SECRET` are set; the repo **variable** `NOD_GITLAB_CLIENT_ID` activates GitLab sign-in once the gitlab.com app is registered (`gh variable set NOD_GITLAB_CLIENT_ID`). Runtime `.env` still overrides in dev. Note: a client secret inside a desktop binary is extractable — a known, accepted trade-off for GitHub OAuth apps (GitHub CLI does the same); GitLab uses PKCE and has no secret at all. |
| Apple notarization | ⬜ Optional — needs an Apple Developer cert ($99/yr). Until then macOS users clear quarantine after install (`xattr -dr com.apple.quarantine /Applications/Nod.app`) or right-click → Open. (Homebrew 6 removed `--no-quarantine`.) |

## Private repo vs auto-updates

**The repo is currently private.** Releases still build and publish fine, but
GitHub requires auth to download private release assets — so installed apps
**cannot fetch `latest.json` while the repo is private**. Options, in order of
effort:

1. **Test locally** (below) — full update loop, nothing public. Use this now.
2. **Public releases-only repo** — create e.g. `PauliusKrutkis/<name>-releases`
   (public, empty), point `plugins.updater.endpoints` and the workflow's
   release target at it (`tauri-action` accepts `owner`/`repo` inputs). Code
   stays private; only installers are public. Good end state if the code
   should stay closed.
3. **Make this repo public** — simplest, once the name/icon are settled.

## Testing auto-updates locally (no public anything)

The updater doesn't care where `latest.json` lives — point it at localhost and
drive the whole loop on your machine:

1. **Build + install the "old" version** (0.1.0):

   ```bash
   cd /path/to/pr-flow
   TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/prflow.key)" pnpm tauri build --bundles app
   cp -r "src-tauri/target/release/bundle/macos/Nod.app" /Applications/
   ```

2. **Point the updater at localhost** — temporarily, in `tauri.conf.json`:

   ```jsonc
   "updater": {
     "endpoints": ["http://localhost:8000/latest.json"],
     "dangerousInsecureTransportProtocol": true,   // http allowed for the test
     "pubkey": "…unchanged…"
   }
   ```

   ⚠️ This edit must be in the *installed* 0.1.0 build — so make it **before**
   step 1, and revert both settings after the test.

3. **Build the "new" version**: bump `version` to `0.1.1` in
   `tauri.conf.json`, rebuild with the same command. Collect from
   `src-tauri/target/release/bundle/macos/`:
   - `Nod.app.tar.gz`
   - `Nod.app.tar.gz.sig`

4. **Serve a manifest**. In an empty dir next to the copied `.tar.gz`
   (rename it `update.tar.gz` to avoid space-escaping), create `latest.json`:

   ```json
   {
     "version": "0.1.1",
     "notes": "Local update test",
     "pub_date": "2026-07-02T00:00:00Z",
     "platforms": {
       "darwin-aarch64": {
         "signature": "<paste the full contents of Nod.app.tar.gz.sig>",
         "url": "http://localhost:8000/update.tar.gz"
       }
     }
   }
   ```

   Then `python3 -m http.server 8000` in that dir.

5. **Launch the installed 0.1.0 app** → the update prompt appears (the app
   checks on launch and on an interval) → Install → it verifies the signature,
   swaps the bundle, and relaunches as 0.1.1.

6. **Revert** the endpoint + `dangerousInsecureTransportProtocol` before any
   real build.

## Local builds (for handing someone a one-off)

```bash
cd /path/to/pr-flow
TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/prflow.key)" pnpm tauri build --bundles app
```

Gotchas learned the hard way:

- The bundler wants the key **contents** in `TAURI_SIGNING_PRIVATE_KEY`; the
  `_PATH` variant is not read at build time.
- The DMG step (`--bundles dmg` / default `all`) scripts Finder via
  AppleScript and **fails in non-interactive shells**. Use `--bundles app`
  locally; CI runners build DMGs fine.

## Before going public — checklist

- [x] **Name: Nod** — renamed 2026-07-02 (`productName`, identifier
  `com.pauliuskrutkis.nod`, cask `nod.rb`, workflow asset names `Nod_…`,
  README, window title). The identifier names the config dir, so it had to be
  final before the first real release — it now is. Note: the *repo* is still
  `pr-flow`; renaming it on GitHub is optional (GitHub redirects old URLs,
  including release downloads, so the updater endpoint keeps working).
- [x] **Icon: the keycap** (resting variant from the original design exploration,
  view 9) — `app-icon.svg` is the source; platform sizes in
  `src-tauri/icons/` were regenerated with `pnpm tauri icon`. To change it
  later: edit the SVG, export 1024×1024 PNG, re-run `pnpm tauri icon <png>`.
- [ ] Decide repo visibility (public vs releases-only repo, above).
- [ ] Create the Homebrew tap + `TAP_REPO_TOKEN` secret.
- [ ] (Optional) Apple Developer cert → signing + notarization, then drop
  the `xattr` step from the install docs.
- [ ] First tagged release: expect one round of CI fixup on the Windows/Linux
  builders (first full build on those runners).
