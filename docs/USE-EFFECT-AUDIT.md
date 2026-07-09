# useEffect Audit and Migration Plan

Audit of every `useEffect` / `useLayoutEffect` call site in `src/`, classified per
[You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect).
This is a planning document: nothing here has been migrated yet.

Stack context relevant to the suggestions: React 19 (with `useEffectEvent`,
already used in `keyboard-provider.tsx`), React Compiler enabled,
`@tanstack/react-query` v5 (shared `queryClient` + `queryKeys`), `zustand` v5,
`react-virtuoso`, Tauri 2 IPC (`api.*`).

## Tally

| Verdict | Count |
|---|---|
| Justified (external system sync: DOM, timers, focus, subscriptions, imperative APIs) | 36 |
| Migratable | 13 |
| Removable / dead or redundant | 2 |
| **Total** | **51** |

## Migration candidates (prioritized)

| # | Location | Problem | Suggested fix | Effort |
|---|---|---|---|---|
| 1 | `hooks/use-token-gate.ts:80` | Manual fetch of OAuth config into `useState`, no race guard | Two `useQuery` calls with `staleTime: Infinity`; delete both `useState`s | Low |
| 2 | `hooks/use-viewed.ts:14` | One-time app-init load of viewed map inside a hook | Run at bootstrap (`main.tsx` or next to the store): `api.getViewedMap().then((m) => useAppStore.getState().setViewed(...))`; delete the hook | Low |
| 3 | `components/review/review-screen.tsx:2191` | Sets `activeThreadRef.current = null` on mount; ref already initializes to `null` | Delete the effect | Low |
| 4 | `components/review/review-screen.tsx:2280` | Manual "latest ref" `useLayoutEffect` for `selectLine`, duplicated by `useLatest(selectLine)` on the next line | Delete the layout effect + `selectLineRef`, use the existing `selectLineLatestRef` everywhere (incl. `useReviewFind`) | Low-Med |
| 5 | `keyboard/use-hotkeys.ts:23` | Manual latest-ref effect (`ref.current = bindings` every render) | `const getBindings = useEffectEvent(() => bindings)` and pass it to `registerSource`; collapses two effects into one | Low |
| 6 | `hooks/use-inbox.ts:13` + `hooks/use-subscribed.ts:13` + `hooks/use-pull-request-detail.ts:23` | Disk-cache seeding of the query cache bolted onto component mounts; races the network fetch, re-runs per consumer | Hydrate once at app bootstrap (or adopt TanStack Query's persister). For PR detail, reuse the seeding logic already in `prefetchPullRequest` and call it from the navigation event | Med |
| 7 | `app.tsx:92` | Bootstrap fetch (`hasToken`, `listAccounts`) with `.then` chains, imperative `setRoute` | Model as `useQuery`s (or module-level init in `main.tsx`) and derive the initial route from query state | Med |
| 8 | `components/inbox/watch-repos-dialog.tsx:219` | Hand-rolled debounced repo search with manual `requestSeq` race protection | `useDebouncedValue` + `useQuery({ queryKey: ["repoSearch", q], enabled: q.length >= 2, placeholderData: keepPreviousData })`; map `searching` to `isFetching`/`isPlaceholderData` | Med |
| 9 | `components/inbox/inbox.tsx:270` (+ cleanup at 273) | Mirrors render-derived `paneVisible` into zustand one render late | Let consumers derive it from the shared query + selection (small `useInboxPaneVisible()` hook), or move selection into the store and make it a selector; the 273 cleanup effect then disappears | Med |
| 10 | `hooks/use-viewed-file-reconcile.ts:46` | Chained state-in-effect (`lastReconcileKey` dedupe + `setChangedSinceViewed`); only the toast is a real side effect | setState-during-render "previous key" pattern for the dedupe/derived set; keep a minimal effect for the toast. Consider merging with the effect at line 68 (same key) | Med |
| 11 | `components/review/comment-thread.tsx:40` | Parent command (`ReplyRequest` nonce object) converted to state in an effect | Imperative handle registry keyed by `rootId` that the parent calls from its event handler; removes the nonce + rAF machinery. Borderline: virtuoso row mount/unmount is why the nonce pattern exists | Med |
| 12 | `components/review-notifier.tsx:71` | Diff-on-data-arrival effect (known-set compare, localStorage persist, toast) | Move to the query layer: `queryClient.getQueryCache().subscribe(...)` pushing notifications into the store. Borderline; defensible as-is since data arrives from a background poll | Med |
| 13 | `hooks/use-inbox-detail-nudge.ts:18` | Cross-cache invalidation on data arrival, ref-based dedupe | Optional: query-cache subscriber registered once at bootstrap (would cover all stale details, not just the open one). Acceptable as a component effect; at minimum narrow deps to `pr?.updatedAt` | Med |

## Justified usages

These synchronize with external systems (DOM events, native `<dialog>`, timers,
focus, scroll, query/zustand stores, Tauri, perf instrumentation) and should stay
as effects. Minor hardening notes included where useful.

### App shell and keyboard

| Location | What it does | Notes |
|---|---|---|
| `app.tsx:54` | 8s toast auto-dismiss timer with cleanup | Same pattern as `review-notifier.tsx:118`; extract a shared `useTimeout`/`useAutoDismiss` hook |
| `app.tsx:64` | Applies persisted zoom to the document on mount | Could move to module init in `main.tsx` to avoid a flash of unzoomed UI |
| `app.tsx:71` | Capturing window scroll listener toggling `is-scrolling` classes | Per-element debounce timers are not cleared on unmount (benign at app root) |
| `keyboard/keyboard-provider.tsx:302` | Global `keydown` listener paired with `useEffectEvent` (line 275) | Idiomatic React 19 pattern, model for the rest of the codebase |
| `keyboard/use-hotkeys.ts:27` | Registers binding source / pushes scope with symmetric cleanup | Deps correct; stays even after candidate #5 collapses line 23 into it |

### Dialogs, focus, and inputs

| Location | What it does | Notes |
|---|---|---|
| `hooks/use-modal-dialog.ts:7` | `dialog.showModal()` on mount | Bug: doc comment promises close-on-unmount but there is no cleanup; add `return () => dialog.close()` |
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

### Timers and instrumentation

| Location | What it does | Notes |
|---|---|---|
| `components/review-notifier.tsx:118` | 12s toast auto-dismiss timer | Shared hook candidate with `app.tsx:54` |
| `components/markdown.tsx:89` | Unmount cleanup of copy-feedback timer set in the `onCopy` handler | Handler-owned state change is already correct; effect is cleanup-only |
| `components/review/review-screen.tsx:3211` | Same copy-timer unmount cleanup in `BranchChip` | Same pattern as `markdown.tsx:89` |
| `components/review/review-screen.tsx:2314` | Post-paint perf mark (`completeFile()`) via rAF on mount | rAF not cancelled on unmount; harmless but tidier with cleanup |
| `components/review/review-screen.tsx:2429` | Centralized unmount cleanup of all screen-level timers/rAF refs | Correct |

### Data-driven sync (no user event exists)

| Location | What it does | Notes |
|---|---|---|
| `hooks/use-review-head-sha-sync.ts:14` | Perf mark + review-memory write + "PR updated" toast on headSha change | Depend on `pr?.headSha` instead of whole `pr` |
| `hooks/use-viewed-file-reconcile.ts:68` | Writes reconciled viewed-map into zustand when headSha changes | Borderline; merge with the line-46 effect (candidate #10) and narrow deps |

### DOM measurement, scroll, and caches

| Location | What it does | Notes |
|---|---|---|
| `components/inbox/inbox.tsx:251` | Scrolls selected row into view on `selectedIndex` change | Selection changes from multiple sources; effect centralizes the scroll |
| `components/inbox/inbox.tsx:258` | 180ms debounced prefetch of selected PR + neighbors | Cleanup correct; `prefetchQuery` dedupes retriggering |
| `components/review/review-list.tsx:927` | Measures mono column width (rAF + `document.fonts.ready`), module-level cache | Could be `useLayoutEffect` to avoid a one-frame unmeasured paint |
| `components/review/review-screen.tsx:589` | `selectionchange` + `click` document listeners for occurrence highlighting | Canonical subscription with full cleanup |
| `components/review/review-screen.tsx:1137` | rAF loop restoring virtuoso scroll position on mount | Correct |
| `components/review/review-screen.tsx:2287` | Warms the highlight cache with cancel cleanup | `[filesForHighlightRef]` dep is cosmetic; if `detail` can resolve after mount, key on `detail?.files` |
| `components/review/review-screen.tsx:2490` | `useLayoutEffect` restoring a captured DOM selection pre-paint | Uncertainty: runs mount-only (`[]`) while `occRestoreRef` is written on every occ-spec commit; verify whether it should key on `[occSpec]` |

## Dead or buggy effects (fix or delete regardless of migration)

| Location | Issue | Action |
|---|---|---|
| `components/inbox/watch-repos-dialog.tsx:213` | Scrolls `[data-armed="true"]` into view with `[]` deps, but `armed` starts `null`, so it never matches | Add `armed` to deps if keeping the armed row visible is desired; otherwise delete |
| `components/inbox/search-pane.tsx:118` | Scrolls `[data-active="true"]` into view with `[]` deps; `sel` is 0 at mount so it is a no-op, and it never re-runs on arrow keys | Depend on `sel` (like `inbox.tsx:251`) or delete |
| `components/review/pr-search.tsx:209` | Mount-only active-row scroll; selection changes on arrow keys are not kept in view | Move the scroll into the keydown handler or key on `[sel]` |
| `hooks/use-modal-dialog.ts:7` | Missing the close-on-unmount cleanup its comment promises | Add `return () => dialog.close()` |

## Suggested migration order

1. Quick wins, no behavior change: candidates 3, 4, 5 (delete dead/redundant latest-ref effects) plus the dead-effect fixes above.
2. Low-risk query adoption: candidates 1 and 2.
3. Shared hooks: `useAutoFocus`, `useTimeout`; fold dialog focus into `useModalDialog`.
4. Cache hydration rework (candidate 6) as one PR since the three hooks share the pattern.
5. Bootstrap/route rework (candidate 7).
6. The borderline event-vs-effect cases (candidates 8-13), each individually, only if they cause real bugs or churn.
