# PR Flow — design brief & rework

> **Purpose.** This document is the starting point for a focused **design
> rework**. It captures what PR Flow *is*, the design principles it should hold
> to, the current visual language, and an inventory of **every view** in the
> app — so the rework has one shared reference. It is a living brief, not a spec;
> code lands in follow-up PRs against this branch.

---

## The product

> **Keyboard-first + cache-first PR review is faster and more satisfying than
> the GitHub web UI** — closer to triaging an inbox than navigating a website.

PR Flow is a small desktop app (**Tauri 2 + React 19 + TypeScript + Tailwind
v4**) for the loop you do every day: open a review request, read the diff, leave
a comment, move on. No AI, no git operations, no team features.

**Who it's for:** developers who live in the keyboard and review PRs daily.
**The core loop:** `resume / ⌘K / inbox → read diff → comment → submit → next`.

The design north star is **Superhuman, not Gmail**: the win isn't a clever entry
point, it's that *once you're inside, it feels incredible* — instant, quiet, and
fully keyboard-drivable.

---

## Design principles

1. **Keyboard-first, mouse-optional.** Every action has a key. The mouse is a
   convenience, never a requirement. Shortcuts are discoverable (persistent
   legend + `?` overlay) without being loud.
2. **Instant.** Cache-first: anything seen before paints immediately; the
   network reconciles in the background. The UI should never block on a spinner
   for cached content. (Perf budget: open < 300 ms, switch PR < 100 ms, switch
   file < 16 ms.)
3. **Calm, low-chrome.** Content (the diff) dominates; chrome recedes. Dark,
   GitHub-familiar palette. No animation for its own sake, no celebration, no
   streaks.
4. **No nags.** Notifications and prompts are dismissable and never steal the
   flow. Freshness is automatic (polling + focus refetch), not a button.
5. **Honest states.** Every async surface has a deliberate loading, empty, and
   error state — not an implicit infinite spinner.
6. **No loading states — optimistic everywhere.** The user's action is always
   right until the network proves otherwise: comments, replies, and review
   submissions apply to the UI instantly and reconcile in the background; a
   failure rolls back and says so (flash toast), it never blocks up front.
   Buttons never enter a "Submitting…" mode. The only acceptable "loading" is
   a cold cache, and even then we paint the shell with whatever we already
   know (inbox metadata) plus a quiet skeleton — full-screen spinners are a
   design bug. Corollary: drafts (pending comments) are never lost to
   navigation or restarts; they persist until explicitly submitted or
   discarded.

---

## Current visual language

GitHub-dark inspired. Tokens are defined once in `src/index.css` (`@theme`) and
Tailwind v4 generates the utilities (`bg-surface`, `text-muted`, `border-line`…).

| Token | Value | Role |
| --- | --- | --- |
| `bg` | `#0d1117` | app background |
| `surface` | `#161b22` | panels, headers, toolbars |
| `surface-2` | `#1c2128` | nested surfaces, hunk headers |
| `elevated` | `#21262d` | hover, inline code |
| `line` / `line-strong` | `#30363d` / `#444c56` | borders, scrollbar |
| `fg` | `#e6edf3` | primary text |
| `muted` / `faint` | `#7d8590` / `#545d68` | secondary / tertiary text |
| `accent` / `accent-fg` | `#2f81f7` / `#fff` | selection, primary actions |
| `success` / `danger` / `warning` | `#3fb950` / `#f85149` / `#d29922` | additions / deletions · errors · drafts |

- **Type:** system UI sans for chrome; `--font-mono` for diffs, line numbers,
  counts, and keycaps.
- **Radius:** single `--radius-card` (0.5rem) for cards/modals.
- **Diff:** add/del rows tint `success`/`danger` at 15% (30% on the gutter);
  syntax highlighting (highlight.js github-dark) layers on top, transparent bg.
- **Scrollbars:** slim, `line-strong` thumb on transparent track.

**Gap the rework should close:** these tokens are applied ad hoc with raw
Tailwind classes per component — there is no shared component layer, so spacing,
density, focus rings, and state styling drift between views.

---

## View inventory

Every surface in the app today, grouped by where it lives. Each is a candidate
for the rework; the goal is to make them feel like one system.

### Primary screens

| View | File | Purpose & key elements |
| --- | --- | --- |
| **Auth / Token gate** | `components/TokenGate.tsx` | First-run. "Sign in with GitHub" (OAuth loopback) + PAT fallback; OAuth "needs setup" hint. |
| **Inbox** | `components/inbox/Inbox.tsx`, `PRListItem.tsx` | Home. Four tabs (Review requests · Assigned · Created · Involved) with counts; `j/k` cursor; unread dots; transient `/` search; **zero-state**. |
| **Review** | `components/review/ReviewScreen.tsx` | The heart of the app. Header (title, state/draft badge, `+/−`, viewed count, pending count, Review/Open). Composes the panels below. |

### Review sub-surfaces

| View | File | Purpose & key elements |
| --- | --- | --- |
| **File sidebar** | `review/FileSidebar.tsx` | The changed-file tree; per-file `+/−` and viewed state; cursor follows `n`/`p`. |
| **Diff viewer** | `review/DiffViewer.tsx` | Syntax-highlighted, collapsible hunks; a **line cursor** (`j`/`k`); gutter `+` to comment (`c`). |
| **Comment thread** | `review/CommentThread.tsx` | Grouped inline threads (root + replies) anchored to a line; reply box. |
| **Add-comment box** | `review/AddCommentBox.tsx` | Inline composer: "add to review" (batch) vs "comment now". |
| **Info panel** | `review/RightPanel.tsx` | PR description (markdown) + PR-level comment composer. Toggled with `i`. |
| **Submit review modal** | `review/SubmitReviewModal.tsx` | Approve / Request changes / Comment, with the batched pending count. |

### Global overlays & chrome

| View | File | Purpose |
| --- | --- | --- |
| **Command palette** | `components/CommandPalette.tsx` | `⌘K` — run any command or jump to any PR by number / title / author. |
| **Help overlay** | `components/HelpOverlay.tsx` | `?` — shortcut cheatsheet, generated from live bindings. |
| **Status bar** | `components/StatusBar.tsx` | Persistent footer legend of context-relevant keys. |
| **Markdown** | `components/Markdown.tsx` | Shared sanitized markdown renderer (`.md` styles in `index.css`). |
| **UI primitives** | `components/ui/` | `Badge`, `EmptyState`, `Kbd`, `Spinner` — the seeds of a component layer. |

### Incoming surfaces (in flight on the `docs/backlog` PR)

These ship just ahead of this rework and must be designed into the system, not
bolted on: **new-review notification toast**, **orient / "PR updated" banners**,
**"Update available" prompt**, and the **dev perf overlay**.

---

## Interaction model

- **Scope-aware keyboard layer** (`src/keyboard/`): bindings register per scope
  (`inbox`, `review`, `palette`, `help`, plus `global`); only the active scope's
  single-key bindings fire, with `⌘K` / `?` always available. This is the
  product's differentiator — the rework must keep it front and centre, and keep
  the **legend + `?` overlay** in sync with reality.
- **Two ways in:** resume the last PR, or `⌘K` to jump. Inbox is the fallback,
  reachable with `Esc`.

---

## What the rework will address

Concrete goals for the follow-up PRs (each small, on this branch):

1. **Consolidate the design system.** Promote the ad-hoc token usage into a thin
   component layer (buttons, inputs, cards, badges, modal shell, tooltip) so
   spacing, density, focus rings, and disabled/hover states are consistent.
   → adopt **shadcn/ui Phase 1** (`command`, `dialog`, `tooltip`) incrementally,
   replacing the hand-rolled palette/help/submit modals.
2. **Code-first layout + Info tab.** Make the diff the default; move description
   + PR-level comments behind a `Tab` toggle (Code ↔ Info) with a comment badge,
   replacing the always-on side panel.
3. **A real type & spacing scale.** Define steps instead of per-component
   `text-xs`/`px-3` guesses; tighten the review header and sidebar density.
4. **Consistent state design.** One visual language for loading / empty / error
   across inbox, review, panels, and the new banners/toasts.
5. **Motion & focus.** Minimal, purposeful transitions; a single visible
   focus-ring treatment; audit tab order and `aria` roles for the overlays.
6. **Iconography & app identity.** A coherent icon set + the new app icon.
7. **Light theme (stretch).** The tokens are already centralized; prove they can
   drive a light variant.

**Non-goals for this rework:** new features (notifications, link interception,
webhooks, AI, GitLab), and anything the product backlog defers until five
external developers have used the app for a week. This is purely look, feel, and
the component layer.

---

## Open questions

- shadcn brings Radix + more dependencies — is the bundle/keyboard-ownership
  trade-off worth it, or do we grow our own `ui/` primitives instead?
- Code ↔ Info as a `Tab` toggle vs. a togglable side panel — which better fits
  wide desktop windows?
- Do we want a light theme at all for a tool that's almost always full-screen
  and dark?
