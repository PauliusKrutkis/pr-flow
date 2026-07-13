# Releasing Nod

Everything about shipping desktop builds: cutting a release, testing
auto-updates, Homebrew, going public, and the [commercial launch](#commercial-launch)
plan (GitHub-as-license, browser-brokered activation — no license keys).

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
| Apple notarization | ⬜ **Required before paid launch (Phase 1)** — Apple Developer cert ($99/yr). Until then macOS users clear quarantine after install (`xattr -dr com.apple.quarantine /Applications/Nod.app`) or right-click → Open. (Homebrew 6 removed `--no-quarantine`.) An app that needs an `xattr` incantation to open is not shippable to paying customers — notarization is a Phase 1 gate, not a nice-to-have. |
| Commercial launch (Phase 0 + 1) | ⬜ See [Commercial launch](#commercial-launch) below. |

## Repo visibility vs auto-updates

**The repo is public** (`PauliusKrutkis/pr-flow`). Installed apps can fetch
`latest.json` from GitHub Releases without auth — the updater works as-is.

If the code should go private again later, use a **public releases-only repo**
(e.g. `PauliusKrutkis/nod-releases`): point `plugins.updater.endpoints` and
the workflow's release target at it (`tauri-action` accepts `owner`/`repo`
inputs). Code stays private; only installers are public. Reconcile visibility
**before the first external user** — a private main repo breaks the updater
unless you split releases.

For local testing without publishing anything, see [Testing auto-updates
locally](#testing-auto-updates-locally-no-public-anything) below.

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
- [x] **Repo visibility** — public (`PauliusKrutkis/pr-flow`). If the code goes
  private later, split to a public releases-only repo (above).
- [x] Homebrew tap + `TAP_DEPLOY_KEY` secret (see one-time setup table).
- [ ] First tagged release: expect one round of CI fixup on the Windows/Linux
  builders (first full build on those runners).

---

## Web (landing page)

The marketing site lives in `apps/web` — an Astro + Tailwind v4 static build
(package `@nod/web`). It ships ~zero JS and reuses the app's "Quiet" design
tokens so the site reads as an extension of the product.

```bash
pnpm --filter @nod/web dev      # local dev server
pnpm --filter @nod/web build    # static output → apps/web/dist
pnpm --filter @nod/web check    # astro check (types + templates)
```

### Deploy — Cloudflare Pages (git integration)

Hosting is **Cloudflare Pages**, connected to this repo through Cloudflare's
GitHub App (works with the private repo). It's a one-time dashboard step; after
that every push builds and every PR gets a preview URL. No CI workflow to
maintain.

| Setting          | Value        |
| ---------------- | ------------ |
| Root directory   | `apps/web`   |
| Build command    | `pnpm build` |
| Output directory | `dist`       |

Until a domain is bought the site ships on `*.pages.dev`. Future
`/activated` / `/restore` pages and the license webhook will live alongside it
as Pages Functions (see [Commercial launch](#commercial-launch)).

## Commercial launch

Paid distribution layered on top of the existing updater feed, signing chain,
and CI releases (most of the hard infrastructure is already done).

### Product decision: no license keys

**Rejected:** copy-paste license keys in a receipt email. It breaks the
product philosophy (keyboard-first, zero friction, instant feel) and feels like
software from 2005.

**Chosen:** OAuth-style activation — the browser is the broker, like GitHub
sign-in today but for purchase. User pays → clicks **Open Nod** → app receives
a signed token via deep link → done. No key, no paste, no support tickets about
lost keys.

**Identity:** GitHub is the license. The app already authenticates with GitHub
OAuth for its core function; reuse that `github_id` as the license identity.
No separate accounts, passwords, or restore-by-email flow for the common case.

```
Sign in with GitHub  →  app knows github_id
Purchase (MoR checkout, linked to same GitHub)  →  webhook stores license
Next launch  →  GET /license/:github_id  →  { active, updates_until }
```

Multi-device restore: user is already signed into GitHub in the app → license
lookup just works. No activation step on a second machine.

Fallback restore (email-only buyers, support): a lightweight web page queries
the merchant-of-record API by email and redirects back with a signed token —
same deep-link path, no keys.

### What you need (surprisingly little)

| Piece | What | Where |
| --- | --- | --- |
| **Landing page** | Static site — speed video, download links to GitHub release assets, buy button → MoR checkout. No backend. | Cloudflare Pages (preferred — Worker lives next to it) or Vercel. Custom domain (~$15/yr) — `nod.something`, not `*.vercel.app`, before anyone sees it. |
| **Payments** | Merchant of record (MoR), **not** raw Stripe. MoR hosts checkout, processes cards, handles global VAT/sales tax. ~5% + ~50¢/sale. | Paddle, Lemon Squeezy (Stripe-owned), or **Polar** (dev-focused, GitHub-native — good audience fit). Paddle requires site approval → landing page comes first regardless. |
| **License server** | One Cloudflare Worker — three endpoints, tiny KV or D1 for `github_id → license` mapping. Not zero-state, but minimal. | Same Cloudflare account as the landing page. |
| **Auth** | None new. GitHub OAuth (already in the app) **is** the license identity. | Existing `auth.rs` + compile-time OAuth secrets. |
| **In-app (Rust)** | Trial, license verify, updater gating, deep-link handler. | `src-tauri/` — see below. |

No traditional backend. No user database you operate — the MoR is the customer
record; the Worker holds only `github_id → { updates_until, order_id }`.

### Cloudflare Worker endpoints

```
POST /purchase-webhook     MoR order.created → verify signature → store license by github_id
GET  /activate             Post-checkout success page → sign token → redirect prflow://purchase?token=…
GET  /license/:github_id   App polls on launch → { active, updates_until }
GET  /restore              Email fallback → MoR lookup → same prflow:// redirect
```

Webhook flow: checkout collects GitHub username (or user signs in with GitHub
on the success page) → webhook maps purchase to `github_id` → Worker stores it.

Activation token payload (Ed25519-signed by the Worker, verified in-app with an
embedded public key — same mental model as updater signatures, second keypair):

```json
{
  "order_id": "…",
  "github_id": 12345,
  "updates_until": "2028-09-01",
  "signature": "…"
}
```

Renewals: second MoR product ("+1 year of updates") → webhook updates
`updates_until` for the same `github_id`.

### In-app work (Rust)

- **`ed25519-dalek` verify** with embedded public key (parallel to existing
  updater minisign chain).
- **Trial:** first-launch timestamp in config dir; on expiry → purchase prompt
  with checkout link (no key field).
- **Deep link:** `prflow://purchase?token=…` via `tauri-plugin-deep-link`
  (also used by §11a extension flow in the backlog). App verifies token,
  stores license locally, dismisses prompt.
- **Launch check:** `GET /license/:github_id` when signed in (cache locally;
  refresh periodically). Offline grace with cached `updates_until`.
- **Updater gating:** `latest.json` stays fully static; client checks local
  `updates_until` before offering an update. Gating is client-side — fine under
  the no-DRM stance.
- **`nod-keygen` CLI** (optional): same signing crate for manual/support grants
  and refund fixes.

### User flows

**Trial expired → purchase**

```
Your trial has ended.
[ Purchase ]  →  browser opens MoR checkout  →  pay
Thanks!  [ Open Nod ]  →  prflow://purchase?token=…
App: ✓ Purchase verified. Welcome back.
```

**Second machine (common case — signed into GitHub)**

```
Install Nod → Sign in with GitHub → license auto-resolves on launch
```

**Restore (fallback — email only)**

```
[ Restore purchase ]  →  browser: enter email  →  [ Open Nod ]
```

Raycast-style goal: user almost forgets licensing exists.

### Phases, sequencing, and cost

**Phase 0 — free beta (now)**

- Custom domain + static landing page (speed video + GitHub release download
  links).
- No MoR, no Worker, no license code — none of it earns anything until
  retention is proven.
- Gate: own §11c release gate in the backlog (five external devs, one week).
- Cost: ~$15/yr (domain). Fixed monthly: $0.

**Phase 1 — retention proven (~1 week engineering)**

Prerequisites in order:

1. Apple Developer account + notarization (hard gate — see one-time setup).
2. MoR account + product setup (needs approved landing page for Paddle).
3. Cloudflare Worker (webhook + activate + license lookup).
4. In-app: verify / trial / gating / `prflow://purchase` handler (~2–3 days).
5. Wire checkout → GitHub identity on success page.

Running costs: domain + Apple $99/yr + per-sale MoR fees. Fixed monthly: $0
(domain amortized; no database host).

### Commercial launch checklist

**Phase 0**

- [ ] Domain + DNS
- [ ] Static landing page (Astro or Vite + existing Tailwind language)
- [ ] Download buttons → GitHub release assets
- [ ] §11c release gate satisfied

**Phase 1**

- [ ] Apple Developer cert → signing + notarization (drop `xattr` from install docs)
- [ ] MoR account + product(s) — base license + renewal SKU
- [ ] Cloudflare Worker deployed (`/purchase-webhook`, `/activate`, `/license/:id`, `/restore`)
- [ ] Ed25519 license signing keypair (separate from updater minisign key)
- [ ] `tauri-plugin-deep-link` — `prflow://purchase` handler
- [ ] Trial + purchase prompt UI
- [ ] Updater gating on `updates_until`
- [ ] Checkout success page with **Open Nod** button
- [ ] GitHub identity linked at purchase (checkout field or success-page OAuth)
