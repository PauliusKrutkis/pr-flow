# PR Flow — backlog

> **Planning only.** Captures requested improvements as a prioritized, actionable
> backlog. Check items off as they ship.

> **Constraint:** Once the release gate is satisfied, **no new backlog items** may
> be added before five external developers have used the app for one week.

Legend: 🟢 small · 🟡 medium · 🔴 large/involved · ⏸ post-MVP · ❓ open question.

**Context:** This is a product plan, not a feature wishlist. Superhuman didn't win
because Gmail links opened in Superhuman — it won because **once you were inside,
it felt incredible.** Foundational = fast cache, keyboard navigation, pleasant
review flow. Entry friction is optimizable later.

**Avoid:** optimizing the last 5% of entry (Slack link interception) before
validating the other 95% (the review experience inside the app).

---

## The real problem

Not: *"How do I intercept every GitHub link?"*

Yes: *"How do I make opening a PR in PR Flow effortless?"*

For v0.1 users (you + ~5 developers), that's already solved:

```
⌘K → "login" → Enter
```

Or resume where you left off. **No Slack link handling required.**

---

## v0.1 — ship this, then stop

- [x] PR list + cached open
- [x] Keyboard navigation
- [x] **`mod+k` PR search** — primary way to open a PR
- [x] Comment + submit review
- [x] **Resume where you left off**
- [ ] Auto-update (before external users)
- [x] Inbox zero-state

**Not in v0.1:** browser extension, link interception, Universal Links, webhooks.

---

## Backlog tiers

### 🚀 Category 1 — Core product (foundational)

*"Why would someone use this?"*

| Item | Section |
| --- | --- |
| **Resume where you left off** | § flow |
| Cache-first + **perf budget** | § perf |
| Keyboard navigation | § shortcuts |
| **`mod+k` search across PRs** | §6 |
| **New review notification** | § notify |
| Code-first layout + Info tab | § layout |
| Viewed workflow + verdict v1 | §4 |
| Orient banner | § delta |
| PR-level comments in Info + badge | §5 |
| Inbox zero-state | § inbox |
| Remove manual refresh | §7 |
| shadcn Phase 1 | §8 |

### 🏗 Category 2 — Product infrastructure

*"Can people realistically adopt it?"*

| Item | Section | When |
| --- | --- | --- |
| **Auto-updates** | §11b | Before external users |
| CI releases + signing | §11b | With auto-update |
| **Commercial launch** | §11c | After §11c release gate |
| **`prflow://` scheme** | §11a | Stage 2 (simple extension); also §11c purchase activation |

### ✨ Category 3 — Delighters (prove the pain first)

| Item | Section | When |
| --- | --- | --- |
| Simple **"Open in PR Flow"** extension | §11a Stage 2 | After daily-use users |
| Link **interception** + native messaging | §11a Stage 3 | Only if users ask |
| Universal Links / wrapper domain | §11a | Unlikely needed if extension suffices |
| **Repo snapshot (sync layers 1–3)** | §9 | Layer 1 after PR #47; during beta |
| New icon · streaks · celebration · Conversation mode | various | Post-MVP |

---

## Release gate

**Must have before DM'ing five developer friends:**

- [ ] Perf budget met
- [x] Keyboard workflow + stable review
- [x] **Resume where you left off**
- [x] **`mod+k` jump to any PR**
- [ ] **Auto-updates**
- [x] Inbox zero-state

**Can wait until users complain:**

- Browser extension (any kind)
- Slack / GitHub link interception
- Universal Links · webhooks · AI · GitLab · Conversation mode · icon

**Ship rule:** If five developers use it for a week and **nobody** says *"I wish
GitHub links opened this"*, you've saved weeks of integration work.

---

## Perceived performance budget (north star)

| Action | Goal |
| --- | ---: |
| Open app | < 300 ms |
| Resume last PR | < 300 ms |
| **`mod+k` → open PR** | < 100 ms |
| Switch PR | < 100 ms |
| Switch file | < 16 ms |
| Command palette | Instant |

- [x] 🟡 Dev overlay: `⚡ Last PR open: 84 ms · Last file switch: 4 ms`
- [x] 🟡 Perf regression tests in CI — `find-perf` / `open-perf` / `scroll-perf`
      e2e budgets (repaint counts + median keystroke / warm-open wall clock /
      stall frames), run on Chromium AND Playwright WebKit (the app ships on
      WebKitGTK; Chromium-only budgets hid engine-shaped lag).
- [ ] 🟡 **Perf e2e against the production build** — today's budgets run on the
      vite dev server, where React's dev runtime + GC noise inflate numbers
      ~2×. Add a Playwright project that runs the perf specs against
      `vite build` + `vite preview` so budgets reflect what users feel, then
      tighten them (~half the current bounds).

### Performance architecture — decisions queued (2026-07-05)

Post-mortem of the find-in-diff perf saga (PR #18): nearly every symptom —
mount stalls, pop-in, phantom scrolling on open, find lag scaling with PR
size — traced to ONE architecture choice (render the whole PR as one DOM and
window it by hand) plus ONE platform reality (Linux ships WebKitGTK: no
scroll anchoring, main-thread overflow scrolling, untested-on engine). The
hand-rolled windowing now works and is guarded by e2e, but it is ~400 lines
of incrementally reinvented virtual list: mounted-section set + IO mounting +
height estimates + idle pre-mounter + input yielding + manual scroll
anchoring + section-offset resume + viewport-scoped find marks.

- [x] 🔴 **Replace hand-rolled windowing with react-virtuoso** — its own PR,
      after #18 merges, driven by the existing e2e suite (behavioral + perf +
      page-error guard). Native sticky group headers, variable heights,
      scroll restore, anchoring. Deletes most of the list above and removes
      two ceilings: the 30k-row pre-mount cap and DOM memory scaling with PR
      size; find/scroll costs become viewport-bounded by construction.
      (CodeMirror 6 per file was considered and ruled out: purpose-built but
      a much deeper integration for marginal gain over virtuoso here.)
- [ ] 🟡 **Real-app perf telemetry** — PerformanceObserver (long tasks +
      event timing) feeding the existing perf overlay/store, so regressions
      show up as numbers from the user's machine instead of bug reports that
      start "feels laggy". Every complaint in the saga arrived through feel;
      CI budgets only test the fixtures we thought of.
- [ ] ⏸ **Electron decision trigger** — keep Tauri, but count the cost:
      every time a WebKitGTK-specific issue burns a day (scroll anchoring,
      compositing, the AppImage EGL workaround), tick this item. If it keeps
      ticking, Chromium-everywhere via Electron is the honest fallback —
      ~10× footprint for perf predictability and dev/prod engine parity. Do
      NOT reach for more engine-specific cleverness first.

---

## Flow & navigation — resume first

```
Continue reviewing · Repository X · PR #431 · File 8 / 17
```

No inbox. Just continue.

- [x] 🔴 **Resume where you left off** — default app open.
- [x] 🟡 Auto-advance to next review-requested PR after submit.
- [x] 🟡 **`Esc` → inbox** — exception, not home.

---

## New review notification (stronger than link interception)

Don't wait for Slack links. **The app is where reviews begin.**

When polling finds a new review request:

```
🔔 New review requested

Fix authentication race condition

Press Enter to open
```

Users may never need to click a GitHub link. Pairs with existing 60s polling —
no webhooks required for v1.

- [x] 🟡 **In-app notification** for new review requests — keyboard-dismissable,
      Enter to open. Desktop notification optional later.
- [x] 🟡 **Badge / inbox highlight** for unseen PRs.

---

## Opening a PR — ranked by stage

### Stage 1 — first users (v0.1) ✅

| Method | Flow |
| --- | --- |
| **`mod+k`** | `⌘K → "123" or "login" → Enter` — under a second, no mouse |
| **Resume** | App opens → continue last PR |
| **Inbox** | `j`/`k` + Enter |

Coworkers paste GitHub links in Slack? **Fine.** User copies PR number or title
into `mod+k`. Keyboard-heavy developers may find this *faster* than mouse →
Slack → browser → app.

### Stage 2 — daily users (after v0.1, if needed)

Simple browser extension — **not interception**. ~10% of interception effort,
most of the value:

- **"Open in PR Flow"** button on GitHub/GitLab PR pages (content script)
- Toolbar button + context menu ("Open in PR Flow")
- Calls **`prflow://pr/owner/repo/123`** — register scheme in Tauri app

No native messaging. No auto-intercept. Easy to build and test.

- [ ] 🟡 **Stage 2 extension** — content script + toolbar + `prflow://` handler.
- [ ] 🟡 **Self-hosted GitLab** — user-configurable host patterns in extension.

### Stage 3 — proven pain only (⏸)

**Only if users say:** *"I keep clicking GitHub links and it's annoying."*

- Intercept navigation before GitHub loads
- Native messaging host (bundled with desktop app)
- Close tab immediately · minimize browser flash

Complex: browser API differences, permissions, Slack in-app browser edge cases.
**Do not build until Stage 2 feedback demands it.**

- [ ] ⏸ **Stage 3 interception** + native messaging.
- [ ] ⏸ Universal Links / wrapper domain — only if extension path fails.
- [ ] ⏸ Userscript — lightweight alternative to full extension.

---

## Orient in 2 seconds

One line when relevant: *"2 files changed."* / *"3 new commits."* — skip when N/A.

- [x] 🟡 Orient banner on PR open.

---

## Inbox zero-state

- [x] 🟢 *"Inbox zero — no review requests"* + recent / waiting state.

---

## PR view layout — code-first

**Code** (default) ↔ **Info** (description + PR comments) via **`Tab`**.

- [ ] 🟡 Code-first · Info tab · comment badge.
- [ ] ⏸ Conversation mode (third Tab).

---

## Shortcut scheme

| Key | Action |
| --- | --- |
| **`n`** / **`p`** | Next / prev file |
| **`j`** / **`k`** (or `↑` / `↓`) | Next / prev line (cursor) |
| **`Space`** | Page down |
| **`]c`** / **`[c`** | Next / prev comment thread |
| **`c`** | Comment on the cursor line |
| **`e`** | Mark viewed + next file |
| **`v`** | Toggle file viewed |
| **`o`** / **`y`** | Open on GitHub · copy PR link |
| **`i`** | Toggle info panel |
| **`s`** | Submit review |
| **`mod+k`** | **Jump to PR** + commands |
| **`Esc`** | Inbox |

> Shipped keys, matching the app. `mod+t`/`mod+f` (files · find) and `Tab`
> (Code ↔ Info) remain proposed — see § layout.

---

## 6. Command palette — search across PRs

Primary navigation. Inbox optional.

```
⌘K → "Fix login" → Enter
⌘K → "123"       → Enter
⌘K → "john"      → Enter  (author)
```

- [x] 🔴 **`mod+k` PR search** — v0.1 blocker.
- [x] 🟡 PR-context actions — after search works.

---

## 4. Review workflow

- [x] 🟢 **`e`** (viewed + next) · **`v`** (toggle viewed) · files via **`n`** / **`p`**
- [ ] ⏸ Persist pending comments — post-MVP; flaky local drafts worse than none.

### 4b. Verdict v1

Subtle **`8 / 12`** · auto-open verdict when all viewed · no animation · no streaks.

---

## 5. Comments UX

Inline → Code view. PR-level → Info tab + badge. ⏸ Conversation mode.

- [x] 🟢 Thread hotkeys — `r` reply / `x` resolve on the hovered or
      `]c`-focused thread; hints fade in on the thread's own action buttons.
- [x] 🟢 Composer hint-bar toolbar — every entry is a clickable hotkey hint,
      not GitHub's 14-icon strip. (First shipped as markdown-symbol wrapping +
      ⌘⇧P preview; superseded days later by the rich composer below after
      "inserting symbols feels like going back" feedback.)
- [x] 🟡 **Rich composer (TipTap v3)** — WYSIWYG surface, markdown wire
      format (`editor.getMarkdown()` feeds the same API payloads). ⌘B/⌘I/⌘E
      toggle real marks, ⌘K links the selection via an inline url input,
      markdown typing shortcuts (`**bold**`, `- `, ``` ) autoconvert, and the
      suggestion is a real block that round-trips to the ```suggestion fence.
      Pending cards render markdown now (raw body would reintroduce the
      symbols). Watch WebKitGTK contenteditable quirks in the wild.
- [x] 🔴 **Multi-line comment ranges (GitLab-style)** — shipped as specced
      (2026-07-06): `shift+j/k` (+ shift+arrows) grow a one-side,
      hunk-contiguous "fat cursor" from the line cursor; gutter `+` drag
      builds the same range (pointer capture + hit-testing); `Esc`/plain
      movement collapses it; `c` opens the composer under the END row with a
      `Lines 12–15` header; Suggestion prefills every selected row; pending
      cards carry a range chip; wire format is `start_line`/`start_side` on
      GitHub and `line_range` on GitLab. Caveats: GitLab's multiline
      `line_code` is under-documented — the payload is best-effort and falls
      back to a single-line anchor if the host rejects it (verify against a
      real GitLab); existing comments' ranges (`start_line` from the API)
      are not yet displayed on threads — follow-up.

### 5c. Mutation spam safeguards

Resolve/unresolve is fixed (`requestResolveThread` coalesces in-flight toggles
while keeping optimistic UI). Same class of bug elsewhere: composers and submit
already accept `pending` / `busy`, but review screen hardcodes them to `false`,
and several paths call `mutate` with no in-flight guard.

- [ ] 🟡 **Submit review** — wire `submitReview.isPending` to `SubmitReviewModal`
      `busy`; block duplicate submit while in flight (modal closes early today;
      `openSubmit` can reset and re-fire).
- [ ] 🟡 **Reply to thread** — wire `reply.isPending` to `ReviewList`
      `addPending` (currently hardcoded `false`); optional intent coalescing if
      spam remains possible before `isPending` flips.
- [ ] 🟡 **Inline "Comment now"** — wire `addReviewComment.isPending` to
      `addPending`; `handleSecondary` must `await onAddComment` (fire-and-forget
      today lets ⌘↵ double-submit through instantly).
- [ ] 🟢 **Issue comment (Info drawer)** — wire `addIssueComment.isPending` to
      `AddCommentBox` `pending` in `right-panel.tsx` (hardcoded `false`).

---

## 7. Data freshness

60s polling + refetch on focus. No **`r`** key. No sync UI.

- [x] 🟢 Remove manual refresh.
- [x] 🟡 Banner when open PR changes externally.
- [ ] 🟡 **GitHub cheap-polling via the Notifications API (P16 PR2)** — the
      ETag/304 conditional-request cache (PR #49) lets GitLab + every REST GET
      re-poll for free and drops the inbox interval to 15s, but GitHub's inbox
      is a GraphQL POST that can't do conditional requests, so each GitHub poll
      still spends rate-limit budget. It's comfortably within the 5000 pts/hr
      budget at 15s (focus-only), so this is an optimisation, not a fix. Keep
      GraphQL for the rich inbox, but gate it behind GitHub's Notifications REST
      API (`GET /notifications` — supports ETag, returns `X-Poll-Interval`):
      poll notifications cheaply as a change-detector and run the full GraphQL
      inbox only when they signal activity, with a slow (~60s) GraphQL baseline
      as a floor (notifications don't cover every review-requested PR). Do NOT
      move the GitHub inbox to REST search — its separate 30 req/min limit +
      loss of the single-query rich fields makes it worse.
- [ ] ⏸ Webhooks — post-MVP.

---

## 8. shadcn/ui — Phase 1

- [ ] 🟡 `command`, `dialog`, `tooltip` — incremental with MVP modals.

---

## 9. Repo snapshot — sync layers (decided 2026-07-12)

Extend cache-first from "PR metadata + diffs" to **the file tree at head SHA**.
Not a new direction — the existing thesis applied deeper. Tarball download
(one API call, `GET /repos/{owner}/{repo}/tarball/{sha}`), extracted into the
cache keyed by commit SHA like everything else. **No git operations** — the
README promise holds. Converts every future context feature from a project
(fetch + cache + loading state) into a local file read.

Three layers, three separate decision points — only layer 3 is a real bet:

- [ ] 🔴 **Layer 1 — snapshot service** (after PR #47 merges; buildable during
      beta, changes no user-visible surface). Rust background threads: check
      repo size via API first (over ~100 MB → skip, stay on-demand — degrade,
      never block), download tarball on PR open, extract to cache, evict old
      SHAs (keep last N per repo) from day one. Wire the full-file modal
      (`shift+v`, PR #47) to read local-first with fallback to the existing
      `get_file_blob` when the snapshot isn't ready. Ships dark; if the
      snapshot fails the app behaves exactly as today.
      **Perf guard:** snapshot ready < 10 s after PR open; zero impact on
      open / scroll / file-switch budgets (e2e-enforced).
- [ ] 🟡 **Layer 2 — consumption**: whole-repo search (ripgrep-style in Rust,
      ms over the extracted tree) · hunk-context expansion (P11 PR 2) reading
      local files. Each small, each shippable independently. New pushes
      re-download the full tarball (no deltas) — fine at PR cadence.
- [ ] ⏸ **Layer 3 — symbol index** (tree-sitter): go-to-definition from the
      diff (peek popover → full-file modal at line), find references for a
      changed symbol. ~50–100k lines/sec/core to parse, index cached per SHA,
      incremental via file-hash diff against the previous snapshot. **Only
      build if beta users live in `shift+v` / repo search** — the sync
      decision does not commit to this. Explicitly navigation, not AI: no
      embeddings, no LLM anywhere.

Ruled out: real git clone (shallow/partial) — efficient deltas + blame, but
breaks "no git operations", needs gitoxide/libgit2 + token-in-transport +
repo-dir management. Revisit only if a feature genuinely needs history.

---

## 11. Distribution & adoption

### 11a. Opening PRs from GitHub/GitLab links — staged

**Raw `https://github.com/.../pull/N` links cannot be OS-hijacked** (you don't
own github.com). Options exist on a **complexity ladder** — climb only as users
prove the need.

| Stage | What | Slack click → app? | Build when |
| --- | --- | --- | --- |
| **1** | `mod+k` + resume + notifications | N/A — don't use Slack link | **v0.1** |
| **2** | Extension: "Open in PR Flow" on PR page | Browser → one click → app | Daily users |
| **3** | Interception + native messaging | Brief flash → app | Users ask for it |

**Stage 2 UX (good enough):** user clicks GitHub link in Slack → lands on GitHub
→ clicks **"Open in PR Flow"** (or toolbar) → app opens. One extra click, ~10%
of Stage 3 effort.

**Stage 3 UX (best for raw links):** click → brief browser flash → app. Only
worth it after validation.

- [ ] 🟡 **`prflow://` scheme** — register via `tauri-plugin-deep-link`; used by
      Stage 2 extension button.
- [ ] 🟡 **Link-open hydration** — when app opens from any source: cache-first
      paint, restore file/scroll/viewed.
- [ ] ⏸ Stage 2 extension (content script + toolbar + context menu).
- [ ] ⏸ Stage 3 interception + native messaging.
- [ ] ⏸ Universal Links / wrapper domain.

### 11b. Auto-updates

- [~] 🔴 Before external users — `tauri-plugin-updater` + CI releases.
      *Plugin + in-app prompt scaffolded; real signing key, feed & CI signing remain (see README "Auto-updates").*
- [ ] ⏸ Crash reporting.

### 11c. Commercial launch

Full plan in [`docs/RELEASING.md` — Commercial launch](./RELEASING.md#commercial-launch).

**Philosophy:** no license keys. GitHub identity is the license. Browser-brokered
activation (`prflow://purchase?token=…`) — Raycast-style **Open Nod** after
checkout. One Cloudflare Worker; MoR (Polar / Paddle / Lemon Squeezy) for
payments and tax.

**Release gate (Phase 0 — free beta):** same as [Release gate](#release-gate)
above. Do not build MoR / Worker / license code until five external developers
have used the app for one week and retention is plausible.

**2026-07-18:** Started the license-server (Pages Functions) skeleton ahead
of this gate — owner call, logged here rather than silently checking off
`Release gate` items that aren't actually done (`Perf budget met` still has
an open item: production-build perf e2e). Landing page (§0) and MoR account
+ real secrets are still gated as written.

| Phase | What | When |
| --- | --- | --- |
| **0** | Domain + static landing page (video, GitHub release downloads). No payments. | After release gate |
| **1** | MoR + Worker + in-app trial/gating + notarization | Retention proven (~1 week eng.) |

- [ ] 🟡 **Phase 0** — landing page on custom domain (~$15/yr).
- [ ] 🔴 **Phase 1** — Apple notarization (hard prerequisite; drop `xattr` docs).
- [ ] 🔴 **Phase 1** — MoR product + checkout linked to GitHub identity.
- [ ] 🟡 **Phase 1** — Cloudflare Worker (`/purchase-webhook`, `/activate`,
      `/license/:github_id`, `/restore`).
- [ ] 🟡 **Phase 1** — `prflow://purchase` deep link + Ed25519 token verify in Rust.
- [ ] 🟡 **Phase 1** — Trial (first-launch timestamp) + purchase prompt UI.
- [ ] 🟡 **Phase 1** — Updater gating on local `updates_until` (static `latest.json`).
- [ ] ⏸ `nod-keygen` CLI for manual/support grants.

**Rejected:** deterministic license keys (stateless, simple engineering, ugly UX —
conflicts with zero-friction product goal).

---

## Post-MVP backlog

AI · GitLab · Slack integration · streaks · celebration · Conversation mode ·
webhooks · icon · Ultracite · vim jumps · persist pending comments · Stage 3
link interception · Universal Links.

---

## Suggested build order

### v0.1 (validate the inside)

1. Resume where you left off
2. Keyboard nav + perf budget
3. **`mod+k` PR search**
4. Comment + submit review
5. New review notification (polling-based)
6. Auto-update
7. Inbox zero-state · orient banner

### After five friends use it for a week

8. shadcn Phase 1 · code-first layout · Info tab
9. **Repo snapshot layer 1** (§9) — invisible infra, safe to build while
   friends test; layers 2–3 gated on their `shift+v` / search usage
10. **Listen** — if *"GitHub links"* comes up → Stage 2 extension
11. If still painful → Stage 3 interception

### Explicitly do not build before user feedback

- Link interception · native messaging · Universal Links
- Webhooks · streaks · celebration · Conversation mode · AI

---

## Notes / cross-cutting

- **Inside > entry.** Polish review flow before Slack link magic.
- **`mod+k` is the v0.1 answer** to "coworker pasted a GitHub link" — PR number
  or title, Enter, done.
- **Notifications > interception** — app tells you about new reviews; you don't
  need Slack to be the entry point.
- Stage 2 extension is a **delighter**, not foundational — ship without it.
- Stage 3 is **technically cool** but high maintenance — zero users have asked yet.
- First testers will complain about comment jumps, Escape, slowness, memory — not
  missing link interception.

## Parked ideas (2026-07-02)

- **Subscribed repos**: watch chosen repositories (not just PRs involving you) —
  a fifth inbox source, likely per-account repo picker + polling. Shape TBD.
- **Watch repos spam** — `setWatchedRepos` fires per toggle with no debounce or
  in-flight guard (unlike viewed-map persist). Debounce or coalesce rapid
  watch/unwatch in the repos dialog.
