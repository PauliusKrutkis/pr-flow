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

## Full-file context expansion (in place, not a dialog)

Diffs are tunnel vision: one added `if` in a file that already has five reads
very differently from the hunk alone. The fix is a per-file *context dial* on
the existing `FileSection`, not a separate full-file surface (a dialog was
tried on `feat/full-file-modal` and dropped 2026-07-15 — reintroduce only as a
cross-file "peek" for go-to-definition, if ever).

**UX:** a hotkey (`shift+v` is free again) expands the active file in place —
context rows synthesized from the head blob fill in between hunks, **scroll
anchored so the line you were reading does not move**. You can then scroll
above/below the hunks within the file; diff marks stay lit inside the full
file, expanded context renders at reduced ink so changes still pop. Same
hotkey collapses.

- [x] Row synthesis: patch rows + head-blob context rows reusing `DiffRow` +
      `SIDE:line` anchors (GitHub "expand context" taken to its limit).
      Find/occurrences/cursor/ruler ride the row stream unchanged — see
      "Code view" in ARCHITECTURE.md. (`src/lib/expand-file.ts`,
      `useFileExpansion`, shipped 2026-07-15.)
- [x] Comment affordance hidden on synthesized rows (GitHub API only accepts
      patch lines; GitLab 400s on far context lines) — synthetic rows carry an
      anchor but no target.
- [x] `shift+v` toggles; header button ("Full file" ↔ "Diff only") always
      visible, its ⇧V chip revealed on header hover / active file (like the
      inline-comment affordance). Scroll anchored through the swap on the
      **cursor row** (fallback: first visible row) via pre-paint scrollTop
      deltas — never the virtualizer's estimated scrollToIndex — then held a
      few frames against re-measure; the anchored row flashes as the "you are
      here" cue.
- [ ] ❓ Open: does expanding lock j/k / scroll into the file, or stay part of
      the continuous scroll? Shipped continuous (fewer modes; matches "review
      pane is one scroll"); revisit after using it.

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

### 4c. Viewed sync with host (cross-device)

Viewed marks today are local-only: `toggleViewed` → debounced `set_viewed_map`
→ `viewed_{accountId}.json` on disk. Fingerprints power auto-unview on push,
but ticks do not follow you to github.com or another machine.

- [ ] 🟡 **GitHub host sync** — hybrid, cache-first:
  - On PR open, hydrate from GraphQL `viewerViewedState` on changed files
    (needs PR node ID on `PullRequest`; detail fetch may need a GraphQL path
    alongside the REST files list).
  - On toggle, keep optimistic local update + fingerprint; background
    `markFileAsViewed` / `unmarkFileAsViewed` mutations.
  - Merge rule: host wins on load when online; local `viewed_*.json` stays as
    offline cache and reconcile fallback.
  - GitLab: no public API today (gitlab.com is localStorage too) — keep local
    fingerprints only until upstream ships reviewed-files endpoints.

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

### 5d. Comment-management follow-ups (post-comment-feature)

Edit / delete / reply / resolve / unresolve now work end-to-end in **both**
surfaces — inline threads (`comment-thread.tsx`, all five actions via
`review-list.tsx` `MappedCommentThread` callbacks) and the Info drawer
(`right-panel.tsx` add / edit / delete of issue comments; reply/resolve stay
inline by design). These are cleanups, not new scope.

- [ ] ⏸ 🟢 **Dedupe comment-row UI** — the own-guard + Edit/Delete two-step
      confirm block is implemented near-identically twice: `ConversationItem`
      in `right-panel.tsx` and the comment map in `comment-thread.tsx`. Extract
      a shared `CommentTools` (own-guard + Edit/`Delete?` buttons, blur/mouseleave
      disarm) and `CommentBody` (`editing ? AddCommentBox : Markdown`); ~40 lines
      deduped. Do it **after** the edit/delete/drawer branches land, not before —
      they were stacked.
- [ ] ⏸ 🟢 **E2E for reply / resolve / unresolve** — edit and delete are covered
      (`comment-edit.spec.ts`, `comment-delete.spec.ts`, `drawer-comment.spec.ts`),
      but reply, resolve, and unresolve are wired yet unverified by any spec. Add
      inline-thread coverage for all three.

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
- [ ] ⏸ Crash reporting — see [July 2026 batch · Sentry](#july-2026-batch).

### 11c. Commercial launch

Full plan in [`docs/RELEASING.md` — Commercial launch](./RELEASING.md#commercial-launch).

**Philosophy:** no license keys. GitHub identity is the license. Browser-brokered
activation (`prflow://purchase?token=…`) — Raycast-style **Open Nod** after
checkout. One Cloudflare Worker; MoR (Polar / Paddle / Lemon Squeezy) for
payments and tax.

**Release gate (Phase 0 — free beta):** same as [Release gate](#release-gate)
above. Do not build MoR / Worker / license code until five external developers
have used the app for one week and retention is plausible.

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

## July 2026 batch

> Ship via the [split-pr skill](../.claude/skills/split-pr/SKILL.md) — one intent
> per PR, ~300-line soft budget, `pnpm check` / tests / knip green (+ e2e and UI
> evidence for UI changes; `cargo test` when `src-tauri/` changes).

### Wave 1 — bug fixes

- [ ] 🟢 **P01** — GitHub OAuth on Windows opens Documents
      folder instead of the browser (`tauri_plugin_opener::open_url`).
- [ ] 🟢 **P02** — File-tree active/focus ring persists
      after `r`/`t` when a file was mouse-clicked (blur on click; audit inbox rows).
      *Also covers:* remove `qf-focusable` focus ring on file sidebar buttons.
- [ ] 🟢 **P03** — Occurrence navigation blocked while find
      (`mod+f`) is open — explicit handoff (select token → close find → start
      occurrences).
- [ ] 🟢 **Next occurrence scroll** — stepping `n`/`p` in occurrence mode should
      not scroll when the match is already fully visible.
- [ ] 🟢 **Search pane height** — inbox search panel lost height; match the
      `mod+k` command palette sizing.
- [ ] 🟢 **GitHub org OAuth restrictions** — `[pr-flow] API error 403` when an org
      (e.g. Decodo) enables OAuth App access restrictions; surface a clear
      in-app message with the GitHub docs link and what the admin must allow.

### Wave 2 — quick wins

- [x] 🟢 **P04** — Hotkey for insert suggestion — **done** as `mod+shift+g`
      (`composer-editor.tsx`), not `mod+shift+s`.
- [x] 🟢 **P05** — Comment thread expand/collapse hotkey — **done**; `z` toggles
      the active thread (`review-screen.tsx`).
- [x] 🟢 **P06** — Next/previous diff hunk keybind — **done** a different way:
      `f` / `g` (Fast down/up) cover jumping through the diff.
- [x] 🟢 **P07** — Restore archived (`e`-archived) inbox
      PRs — **done** (archived view toggle + restore).
- [ ] 🟢 **`e` skips viewed files** — when marking viewed + next, jump to the
      next *unviewed* file instead of blindly advancing (next may already be
      viewed).
- [ ] 🟢 **Pending comment discard hotkey** — keyboard shortcut for discard;
      improve discard button visibility (border/contrast is too subtle today).
- [x] 🟢 **Go to next/previous comment** — **done**; `]c` / `[c` bound in the
      Comments group (`review-screen.tsx`).

### Wave 3 — review surfaces

- [ ] 🟡 **P08** — Show approvals / changes-requested in
      the review header (data already on detail payload).
- [ ] 🟡 **P09** — Pipelines / CI status pill in review
      header (+ per-check list in drawer later).
- [ ] 🔴 **P10** — Edit own comments (inline review
      comments first, PR-level in info drawer second).
- [ ] 🟡 **P11** — View full file at head SHA (`shift+v`
      modal first; hunk context expansion later — ties to §9 snapshot layer 1).
- [ ] 🟡 **P12** — "What's new" card on first launch after
      an update (release notes via Rust command).
- [ ] 🟢 **Distinct file header** — hard to tell when starting a new file; make
      the file header row more visually distinct in the diff list.
- [x] 🟢 **Info drawer author avatars** — **done**; discussion rows render
      `<Avatar>` per comment author (`right-panel.tsx`).
- [ ] 🟢 **Copy comment text** — copy action for comment bodies in Code threads
      and Info drawer; fix text selection where comment markdown blocks
      selection unintentionally.

### Wave 4 — desktop shell

- [ ] 🔴 **P13** — Custom title bar for Linux & Windows
      (frameless + Quiet drag region + window controls).
- [ ] 🟡 **P14** — Responsive / small-window / zoomed
      layout (900 px min, PR header first).

### Wave 5 — bigger bets

- [ ] 🔴 **P15** — File tree: folders, indentation,
      collapse (needs decision: replace flat list vs toggle).
- [ ] 🟡 **P16** — Faster inbox via conditional polling
      (ETag/304 → ~15 s interval); optional activity-aware detail refresh (see
      also §7 GitHub notifications gate).
- [ ] 🔴 **P17** — Apply suggestion as commit (GitLab
      native first; GitHub contents-API path second — needs product decision).
- [ ] 🟢 **P18** — Info drawer wide mode (`shift+i` while
      open).

### Anytime — hygiene & design

- [ ] 🟢 **P19** — Rust line-comment sweep (~25 `//` in
      `src-tauri/src/`).
- [ ] 🟡 **P20** — Rich text editor design polish
      (composer + info-drawer form; visual-only).
- [ ] ⏸ **P21** — Multi-line selection box via drag
      (defer; improve gutter-drag discoverability instead).
- [ ] 🟢 **Rust tests — split into files** — break up large inline `#[cfg(test)]`
      modules into separate test files where it aids navigation.
- [x] **Split-pr skill — PR evidence in description** — skill should attach
      Playwright screenshots / UI evidence to the PR body, not just local
      artifacts.
- [ ] 🟡 **useEffect migration** — full audit below; prioritize quick wins
      (dead/redundant effects) then query adoption. Candidate #2 (bootstrap
      viewed map) shipped on main.

### Keyboard, focus & composer UX

- [ ] 🟡 **`Tab` cycles files** — `Tab` should move to the next/previous changed
      file unless a focused control captures it; today it opens comment reply in
      some contexts. Reconcile with § layout Code ↔ Info (`Tab`) — may need
      `shift+Tab` or a different Info toggle once file cycling ships.
- [ ] 🟡 **Focus comment threads from keyboard** — arrow keys and `f`/`g` should
      be able to focus a comment thread; focused thread activates the reply box
      and shows reply/resolve hints (same as hover). `f`/`g` must not skip the
      inline comment composer when it is open.
- [ ] 🟡 **Composer: suggestions** — tab completion inside suggestion blocks,
      syntax highlighting for suggestion fences; pairs with P04 hotkey and P20
      polish.
- [ ] 🟡 **Comment-now vs add-to-review UX** — remember last choice between
      "comment now" and "add to review", or replace tabs with two explicit
      buttons if that reads clearer.
- [ ] 🟡 **Hover cursors** — cursor should change over interactive regions
      (gutter, threads, links); audit against editor-like affordances elsewhere
      in the app.
- [ ] 🟡 **Reply in Info tab** — thread reply from the info drawer, not just
      read-only PR-level comments there today.

### Inbox & activity semantics

- [ ] 🟡 **Own mutations shouldn't re-activate inbox** — commenting or submitting
      a review bumps the PR in the inbox as if new external activity arrived;
      suppress or de-prioritize self-authored updates.

### Tooling, observability & investigation

- [ ] 🟡 **Sentry** — error reporting for production builds (§11b crash reporting).
- [ ] 🟡 **PR validity skill** — agent skill to check PR quality: commenting
      patterns, `useEffect` usage, shadcn usage, split-pr gate compliance.
- [ ] ⏸ **Whole-repo context index** — investigate local code index for search /
      navigation / future AI features; aligns with §9 repo snapshot layers 2–3
      (ripgrep search now, tree-sitter symbols later — no embeddings/LLM unless
      users ask).
- [ ] ⏸ **File/code autocomplete in comments** — `@file` / path completion in
      the composer; depends on §9 snapshot or live blob access.

---

## useEffect audit and migration plan

Audit of every `useEffect` / `useLayoutEffect` call site in `src/`, classified per
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).
Planning only — check items off as they ship.

Stack context relevant to the suggestions: React 19 (with `useEffectEvent`,
already used in `keyboard-provider.tsx`), React Compiler enabled,
`@tanstack/react-query` v5 (shared `queryClient` + `queryKeys`), `zustand` v5,
`react-virtuoso`, Tauri 2 IPC (`api.*`).

### Tally

| Verdict | Count |
|---|---|
| Justified (external system sync: DOM, timers, focus, subscriptions, imperative APIs) | 36 |
| Migratable | 13 |
| Removable / dead or redundant | 2 |
| **Total** | **51** |

### Migration candidates (prioritized)

| # | Location | Problem | Suggested fix | Effort |
|---|---|---|---|---|
| 1 | ~~`hooks/use-token-gate.ts:80`~~ | ~~Manual fetch of OAuth config into `useState`, no race guard~~ | ~~Two `useQuery` calls with `staleTime: Infinity`; delete both `useState`s~~ | Low · **done** (two `useQuery` calls, no `useState`) |
| 2 | ~~`hooks/use-viewed.ts:14`~~ | ~~One-time app-init load of viewed map inside a hook~~ | ~~Run at bootstrap (`main.tsx` or next to the store)~~ | Low · **done** |
| 3 | ~~`components/review/review-screen.tsx:2191`~~ | ~~Sets `activeThreadRef.current = null` on mount; ref already initializes to `null`~~ | ~~Delete the effect~~ | Low · **done** (effect no longer present) |
| 4 | ~~`components/review/review-screen.tsx:2280`~~ | ~~Manual "latest ref" `useLayoutEffect` for `selectLine`, duplicated by `useLatest(selectLine)` on the next line~~ | ~~Delete the layout effect + `selectLineRef`~~ — **won't do**: there is no duplicate `useLatest(selectLine)`. `selectLineRef` is created empty *before* `useReviewFind` and filled after, but `selectLine` reads `findOpenRef` (a `useReviewFind` output) — a genuine init cycle `useLatest` can't express. The empty-ref-then-fill layout effect is required. | Low-Med |
| 5 | ~~`keyboard/use-hotkeys.ts:23`~~ | ~~Manual latest-ref effect (`ref.current = bindings` every render)~~ | ~~`const getBindings = useEffectEvent(() => bindings)`~~ — **won't do**: the source getter is called during render by the command palette (`command-palette.tsx:87`) and help overlay (`help-overlay.tsx:94`) to enumerate bindings; `useEffectEvent` throws when invoked outside an effect/event, so the ref is required. | Low |
| 6 | `hooks/use-inbox.ts:13` + `hooks/use-subscribed.ts:13` + `hooks/use-pull-request-detail.ts:23` | Disk-cache seeding of the query cache bolted onto component mounts; races the network fetch, re-runs per consumer | Hydrate once at app bootstrap (or adopt TanStack Query's persister). For PR detail, reuse the seeding logic already in `prefetchPullRequest` and call it from the navigation event | Med |
| 7 | `app.tsx:92` | Bootstrap fetch (`hasToken`, `listAccounts`) with `.then` chains, imperative `setRoute` | Model as `useQuery`s (or module-level init in `main.tsx`) and derive the initial route from query state | Med |
| 8 | `components/inbox/watch-repos-dialog.tsx:219` | Hand-rolled debounced repo search with manual `requestSeq` race protection | `useDebouncedValue` + `useQuery({ queryKey: ["repoSearch", q], enabled: q.length >= 2, placeholderData: keepPreviousData })`; map `searching` to `isFetching`/`isPlaceholderData` | Med |
| 9 | `components/inbox/inbox.tsx:270` (+ cleanup at 273) | Mirrors render-derived `paneVisible` into zustand one render late | Let consumers derive it from the shared query + selection (small `useInboxPaneVisible()` hook), or move selection into the store and make it a selector; the 273 cleanup effect then disappears | Med |
| 10 | `hooks/use-viewed-file-reconcile.ts:46` | Chained state-in-effect (`lastReconcileKey` dedupe + `setChangedSinceViewed`); only the toast is a real side effect | setState-during-render "previous key" pattern for the dedupe/derived set; keep a minimal effect for the toast. Consider merging with the effect at line 68 (same key) | Med |
| 11 | `components/review/comment-thread.tsx:40` | Parent command (`ReplyRequest` nonce object) converted to state in an effect | Imperative handle registry keyed by `rootId` that the parent calls from its event handler; removes the nonce + rAF machinery. Borderline: virtuoso row mount/unmount is why the nonce pattern exists | Med |
| 12 | `components/review-notifier.tsx:71` | Diff-on-data-arrival effect (known-set compare, localStorage persist, toast) | Move to the query layer: `queryClient.getQueryCache().subscribe(...)` pushing notifications into the store. Borderline; defensible as-is since data arrives from a background poll | Med |
| 13 | `hooks/use-inbox-detail-nudge.ts:18` | Cross-cache invalidation on data arrival, ref-based dedupe | Optional: query-cache subscriber registered once at bootstrap (would cover all stale details, not just the open one). Acceptable as a component effect; at minimum narrow deps to `pr?.updatedAt` | Med |

### Justified usages

These synchronize with external systems (DOM events, native `<dialog>`, timers,
focus, scroll, query/zustand stores, Tauri, perf instrumentation) and should stay
as effects. Minor hardening notes included where useful.

#### App shell and keyboard

| Location | What it does | Notes |
|---|---|---|
| `app.tsx:54` | 8s toast auto-dismiss timer with cleanup | Same pattern as `review-notifier.tsx:118`; extract a shared `useTimeout`/`useAutoDismiss` hook |
| `app.tsx:64` | Applies persisted zoom to the document on mount | Could move to module init in `main.tsx` to avoid a flash of unzoomed UI |
| `app.tsx:71` | Capturing window scroll listener toggling `is-scrolling` classes | Per-element debounce timers are not cleared on unmount (benign at app root) |
| `keyboard/keyboard-provider.tsx:302` | Global `keydown` listener paired with `useEffectEvent` (line 275) | Idiomatic React 19 pattern, model for the rest of the codebase |
| `keyboard/use-hotkeys.ts:27` | Registers binding source / pushes scope with symmetric cleanup | Deps correct; stays even after candidate #5 collapses line 23 into it |

#### Dialogs, focus, and inputs

| Location | What it does | Notes |
|---|---|---|
| `hooks/use-modal-dialog.ts:7` | `dialog.showModal()` on mount | Close-on-unmount deliberately omitted (React removal closes it; explicit `close()` misfires under StrictMode) — doc comment now explains this |
| `components/command-palette.tsx:105` | rAF focus of input on mount | See "focus dedup" note below |
| `components/command-palette.tsx:109` | Scrolls active row into view on `activeIndex` change | Could use a ref on the active row instead of `querySelector` |
| `components/token-gate.tsx:185` | rAF focus of host input on panel mount | `autoFocus` would likely suffice (not a dialog/portal) |
| `components/token-gate.tsx:328` | rAF focus of token input on panel mount | Same as above |
| `components/issue-tracker-dialog.tsx:54` | rAF focus of URL input on dialog mount | See "focus dedup" note below |
| `components/inbox/watch-repos-dialog.tsx:209` | rAF focus after `showModal()` | Cancel the rAF in cleanup |
| `components/inbox/search-pane.tsx:114` | rAF focus after `showModal()` | Could be folded into `useModalDialog` |
| `components/review/pr-search.tsx:205` | rAF focus of search input on mount | Cancel the rAF in cleanup; or `autoFocus` |
| `components/review/right-panel.tsx:65` | Focus panel on open, blur/restore on close | Correct as-is |
| `components/review-notifier.tsx:126` | Saves/restores `document.activeElement` around toast | Correct save/restore with `isConnected` guard |
| `components/review-notifier.tsx:150` | `<dialog>.show()`/`.close()` for toast card | Could merge with the 126 effect (same dependency and lifetime) |

Focus dedup: the rAF-focus-on-mount effect is duplicated 5x
(`command-palette:105`, `token-gate:185/328`, `issue-tracker-dialog:54`,
`pr-search:205`, plus the two dialog variants). All individually justified, but a
shared `useAutoFocus(ref)` hook, or the native `autoFocus` attribute where no
`<dialog>`/portal is involved, would remove them wholesale.

#### Timers and instrumentation

| Location | What it does | Notes |
|---|---|---|
| `components/review-notifier.tsx:118` | 12s toast auto-dismiss timer | Shared hook candidate with `app.tsx:54` |
| `components/markdown.tsx:89` | Unmount cleanup of copy-feedback timer set in the `onCopy` handler | Handler-owned state change is already correct; effect is cleanup-only |
| `components/review/review-screen.tsx:3211` | Same copy-timer unmount cleanup in `BranchChip` | Same pattern as `markdown.tsx:89` |
| `components/review/review-screen.tsx:2314` | Post-paint perf mark (`completeFile()`) via rAF on mount | rAF not cancelled on unmount; harmless but tidier with cleanup |
| `components/review/review-screen.tsx:2429` | Centralized unmount cleanup of all screen-level timers/rAF refs | Correct |

#### Data-driven sync (no user event exists)

| Location | What it does | Notes |
|---|---|---|
| `hooks/use-review-head-sha-sync.ts:14` | Perf mark + review-memory write + "PR updated" toast on headSha change | Depend on `pr?.headSha` instead of whole `pr` |
| `hooks/use-viewed-file-reconcile.ts:68` | Writes reconciled viewed-map into zustand when headSha changes | Borderline; merge with the line-46 effect (candidate #10) and narrow deps |

#### DOM measurement, scroll, and caches

| Location | What it does | Notes |
|---|---|---|
| `components/inbox/inbox.tsx:251` | Scrolls selected row into view on `selectedIndex` change | Selection changes from multiple sources; effect centralizes the scroll |
| `components/inbox/inbox.tsx:258` | 180ms debounced prefetch of selected PR + neighbors | Cleanup correct; `prefetchQuery` dedupes retriggering |
| `components/review/review-list.tsx:927` | Measures mono column width (rAF + `document.fonts.ready`), module-level cache | Could be `useLayoutEffect` to avoid a one-frame unmeasured paint |
| `components/review/review-screen.tsx:589` | `selectionchange` + `click` document listeners for occurrence highlighting | Canonical subscription with full cleanup |
| `components/review/review-screen.tsx:1137` | rAF loop restoring virtuoso scroll position on mount | Correct |
| `components/review/review-screen.tsx:2287` | Warms the highlight cache with cancel cleanup | `[filesForHighlightRef]` dep is cosmetic; if `detail` can resolve after mount, key on `detail?.files` |
| `components/review/review-screen.tsx:2490` | `useLayoutEffect` restoring a captured DOM selection pre-paint | Uncertainty: runs mount-only (`[]`) while `occRestoreRef` is written on every occ-spec commit; verify whether it should key on `[occSpec]` |

### Dead or buggy effects (fix or delete regardless of migration)

| Location | Issue | Action |
|---|---|---|
| ~~`components/inbox/watch-repos-dialog.tsx:213`~~ | ~~Scrolls `[data-armed="true"]` into view with `[]` deps, but `armed` starts `null`, so it never matches~~ | **Done** — effect now keys on `[armed]` |
| ~~`components/inbox/search-pane.tsx:118`~~ | ~~Scrolls `[data-active="true"]` into view with `[]` deps; `sel` is 0 at mount so it is a no-op, and it never re-runs on arrow keys~~ | **Done** — effect now keys on `[sel]` |
| ~~`components/review/pr-search.tsx:209`~~ | ~~Mount-only active-row scroll; selection changes on arrow keys are not kept in view~~ | **Done** — effect now keys on `[sel]` |
| ~~`hooks/use-modal-dialog.ts:7`~~ | ~~Missing the close-on-unmount cleanup its comment promises~~ | **No longer relevant** — close-on-unmount is now deliberately omitted; the doc comment explains React removal closes the dialog and an explicit `close()` would misfire under StrictMode |

### Suggested migration order

1. Quick wins, no behavior change: candidates 4, 5 (delete redundant latest-ref effects). ~~Candidate 3~~ and the dead-effect fixes above are **done**.
2. Low-risk query adoption: ~~candidate 1~~ and candidate 2 both **done**.
3. Shared hooks: `useAutoFocus`, `useTimeout`; fold dialog focus into `useModalDialog`.
4. Cache hydration rework (candidate 6) as one PR since the three hooks share the pattern.
5. Bootstrap/route rework (candidate 7).
6. The borderline event-vs-effect cases (candidates 8-13), each individually, only if they cause real bugs or churn.

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

## Tech debt

- [ ] **Split `ReviewScreenInner`** in `review-screen.tsx` into smaller
  components so React Doctor's `no-giant-component` passes without the
  `test-noise` tag ignore in `doctor.config.json` — remove that ignore once done.
- [ ] **E2E composer submit is macOS-red (`Control+Enter` vs `Mod`)** — the
  Tiptap composer binds submit to `Mod-Enter` (`composer-editor.tsx`), which
  ProseMirror resolves to **Cmd on macOS, Ctrl on Linux/Windows**. The e2e
  specs hardcode `page.keyboard.press("Control+Enter")`, so they pass on Linux
  CI but silently no-op on macOS (composer stays open, `e2e:lastReview` never
  written) — `multiline.spec.ts:45/59/63/173`, `composer.spec.ts:70/85`,
  `review.spec.ts:488`. Fix: replace those with the platform-agnostic
  `ControlOrMeta+Enter` (precedent: `release-history.spec.ts:25` already uses
  `ControlOrMeta+k`). Test-only; verified via probes (button click + `Meta+Enter`
  submit; `Control+Enter` doesn't). Pre-existing, reproduces on clean `main`.

## Inbox (2026-07-15)

- [ ] **`ctrl+c` copy on click-highlighted word** — copy doesn't fire when a word
      is highlighted via click; investigate editor-level selection handling for a
      better approach (unsure whether to follow a standard here).
- [ ] **Check for updates action** — explicit user-triggered update check.
- [ ] **Info comment section design rework**.
- [ ] **Theming: CSS file vs Tailwind variables** — is theming really a CSS file
      rather than Tailwind variables? Consider using TW everywhere for better
      optimization.
- [ ] **Command palette "Add comment" item** — add an "Add comment" action to
      the existing `mod+k` command palette (only in PR context). It opens a small
      dialog to quickly scribble a note — skipping the need to comment inline in
      code or open the info drawer and scroll to the comment area.
- [ ] **Hide empty tabs**.

## Inbox (2026-07-18)

- [ ] **Private repos don't show up** — on certain setups (org restrictions,
      token scopes, etc.) private repos may be missing from the list; needs
      manual debugging to find the root cause.
- [ ] **Unfocused-window hotkeys/sidebar stale** — when the app window isn't
      focused, scrolling still works but hotkeys that only surface on
      focus/hover don't appear, and the sidebar's active-file highlight stops
      updating.
- [x] **Tooltips on buttons** — many buttons only have a `title` attribute
      today; add real tooltips. Converted icon-only affordances (find bar,
      right-panel widen/close/jump-to-thread, copy-path/viewed-toggle, CI
      pill, ticket links, inbox watch/archived/tab, header show-files/info,
      branch chips) to the existing `<Tooltip>` component. Left native
      `title` where a visible label/`<Kbd>` hint already shows (composer
      toolbar, thread expand/collapse — by existing design) or where the
      button can be `disabled` (submit-review approve/request-changes —
      disabled elements don't reliably fire the pointer/focus events the
      custom Tooltip relies on) and on file-tree/file-header rows (native
      title for truncated-path overflow, not an action hint).
- [ ] **Multi-line comment highlighting is partial** — block comments
      (`/* ... */`) only grey out the first line instead of the whole
      comment, e.g.:
      ```
      /* Head-blob fixtures for full-file expansion (get_file_blob). fuzzy.ts must
      agree with PATCH line-for-line on the new side — expandFileRows validates —
      and carries extra tail lines that only exist when expanded. */
      ```
