# PR Flow — backlog

> **Planning only. Nothing here is implemented** — this captures requested
> improvements as a prioritized, actionable backlog (same spirit as the e2e
> scaffold). Each item notes the intent and a rough implementation approach so
> it can be picked up directly. Check items off as they ship.

Legend: 🟢 small · 🟡 medium · 🔴 large/involved · ❓ open question.

---

## 1. Keyboard navigation & code traversal

- [ ] 🟢 **Accelerate scrolling/cursor when a key is held.** Holding `j`/`k`
      should speed up rather than step at a fixed rate. Approach: use
      `KeyboardEvent.repeat` (and/or time-since-first-repeat) to grow the step,
      or switch to a `requestAnimationFrame` momentum loop while the key is down
      (keydown starts it, keyup stops it). Today the keyboard layer fires one
      action per keydown.
- [ ] 🟡 **More code-traversal shortcuts.** `gg` / `G` jump to top / bottom of
      the diff; `{` / `}` (or `[h` / `]h`) jump between hunks; `Ctrl-D` / `Ctrl-U`
      half-page (complementing `Space` / `PageDown`/`PageUp`). Keep them
      discoverable in the `?` overlay and footer.
- [ ] 🟢 **`Tab` / `Shift+Tab` to cycle inbox tabs** (in addition to `1`–`4`).
      Note: must `preventDefault` Tab when not focused in a field so it doesn't
      move DOM focus.

## 2. Fuzzy file finder (⌘T / Ctrl-T)

- [ ] 🟡 **Spotlight/Raycast-style file finder.** A centered overlay to jump to
      any changed file in the open PR, **fuzzy-matched** (path + basename).
      Approach: reuse the command-palette modal shell; add a small fuzzy scorer
      (e.g. `fuzzysort` or `match-sorter`) ranked by basename then path;
      arrows/Enter/Esc; show status glyph + `+/-`. Trigger `mod+t`.
- [ ] 🟢 **Remove the sidebar "Filter files" input** once ⌘T exists (redundant).
- [ ] ❓ **Unify or separate ⌘K and ⌘T.** Raycast-style: one launcher with
      modes, vs. distinct ⌘K (commands) / ⌘T (files). Decide before building.

## 3. Search UI polish (Spotlight feel)

- [ ] 🟡 **Make search feel like Raycast/Spotlight/⌘P:** centered modal, fuzzy
      ranking, result rows with icons/metadata, keyboard-first. Applies to both
      the inbox search and the ⌘T file finder (likely a shared component). The
      current inbox `/` bar is functional but not Spotlight-grade.

## 4. Review workflow

- [ ] 🟢 **Marking viewed should advance to the next file.** Reverses the
      current in-place `v` toggle. ❓ Decide the default — e.g. `v` = mark viewed
      **and advance**, `V` (shift) = toggle in place — or make it a setting.
- [ ] 🟡 **Persist the review draft across navigation.** Pending review comments
      are currently dropped when leaving the PR (`Esc` to inbox). Keep them in
      the store keyed by PR (and ideally warn on discard).

## 5. Comments UX

- [ ] 🟡 **Surface comments better.** Inline review comments render in the diff,
      but the broader conversation isn't easy to scan. Add a **Comments /
      Conversation view** — likely a right-panel tab (or sidebar) listing all
      review + PR-level comments chronologically, each click-to-jump to its line.
- [ ] ❓ **UX decision:** right-panel tab vs. dedicated sidebar vs. overlay. Also
      whether to thread the timeline or group by file/line.

## 6. Unify the "add comment" cursor

- [ ] 🟢 **One `+`, not two.** Today both the mouse hover-`+` and the keyboard
      line-cursor `+` can show at once. Track the **last input modality**: show
      the mouse `+` on hover while using the mouse, and the keyboard-cursor `+`
      while navigating by keyboard; switch automatically on `mousemove` vs
      `keydown`. They can share one affordance.

## 7. Command palette — context actions

- [ ] 🟡 **PR-context commands in ⌘K.** When a PR is open, surface actions driven
      by the current PR: **Approve**, **Request changes**, **Add comment**,
      **Mark all viewed**, **Open on GitHub**, **Copy PR URL**, **Next/Prev
      file**, **Toggle info panel**, etc. The palette already reads the active
      scope's bindings — extend with PR-scoped action commands.

## 8. UI foundations — shadcn/ui

- [ ] 🔴 **Adopt shadcn/ui** for accessible, consistent primitives (dialog,
      command, tooltip, dropdown, etc.). Compatible with Tailwind v4. Would back
      the palette, file finder, submit-review modal, and help overlay, and
      improve accessibility (focus traps, ARIA roles, escape handling). Migrate
      incrementally; keep the dark theme tokens.

## 9. Tooling & quality — Ultracite

- [ ] 🟢 **Add Ultracite** (Biome-based strict lint/format preset):
      `npx ultracite init`. Add a CI lint/format gate. Confirm interplay with
      the existing `tsc` typecheck and the Tailwind/Vite setup.

## 10. Better app icon

- [ ] 🟡 **More professional icon.** The current icon is a quick PR-glyph on a
      gradient. Explore a few directions (mark + wordmark, distinctive shape),
      then regenerate all sizes via `pnpm tauri icon`. Consider light/dark and
      macOS squircle masking.

## 11. Distribution & platform

- [ ] 🔴 **Auto-update.** `tauri-plugin-updater` + signed release artifacts + an
      update manifest (e.g. a `latest.json` served from GitHub Releases).
      Requires generating + storing updater signing keys (public key in
      `tauri.conf.json`, private key in CI secrets).
- [ ] 🟡 **Autopublish / CI releases.** GitHub Actions using
      `tauri-apps/tauri-action` to build, sign, and publish installers on tag
      push (matrix for macOS/Windows/Linux). Pairs with the updater above.
- [ ] 🔴 **Open PR links in the app (deep linking).**
      - Register a custom scheme via `tauri-plugin-deep-link`, e.g.
        `prflow://pr/<owner>/<repo>/<number>` → route straight to the review screen.
      - ❓ Note: a desktop app **cannot** globally hijack `https://github.com/.../pull/...`.
        Realistic options to bridge real GitHub URLs: a small **browser
        extension / bookmarklet** that rewrites a PR URL to the `prflow://`
        scheme, or an "Open in PR Flow" button surfaced elsewhere. Document the
        trade-offs before committing to an approach.

---

## Notes / cross-cutting

- Several items ( vim traversal, ⌘T finder, palette context actions) build on the
  existing scope-aware keyboard layer (`src/keyboard`) — extend, don't replace.
- shadcn adoption (§8) and the search-UI polish (§3) overlap: doing shadcn first
  gives an accessible `command`/`dialog` base for the finder and palette.
- The "viewed → advance" change (§4) intentionally reverses a recent decision;
  confirm the desired default before implementing.
