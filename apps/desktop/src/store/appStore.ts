import { create } from "zustand";
import { api } from "../lib/api";
import { usePerfStore } from "../lib/perf";
import {
  UNKNOWN_FINGERPRINT,
  reconcileViewedEntry,
} from "../lib/viewedFingerprint";
import type {
  AccountInfo,
  AccountsInfo,
  ChangedFile,
  InboxTabKey,
  PendingComment,
  ViewedMap,
} from "../types";

export type Route =
  | { name: "loading" }
  | { name: "token" }
  | { name: "inbox" }
  | { name: "review"; owner: string; repo: string; number: number };

// ---- last-route persistence ("resume where you left off") --------------------
// We remember the inbox/review screen you were last on (never the token/loading
// screens) so the next launch reopens it instead of always landing on the inbox.
const LAST_ROUTE_KEY = "pr-flow:lastRoute";
type ResumableRoute = Extract<Route, { name: "inbox" } | { name: "review" }>;

function saveLastRoute(route: Route) {
  if (route.name !== "inbox" && route.name !== "review") return;
  try {
    localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify(route));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/** The screen to resume on launch, if any. Validated to a known shape. */
export function loadLastRoute(): ResumableRoute | null {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_ROUTE_KEY) ?? "null");
    if (v?.name === "inbox") return { name: "inbox" };
    if (
      v?.name === "review" &&
      typeof v.owner === "string" &&
      typeof v.repo === "string" &&
      typeof v.number === "number"
    ) {
      return { name: "review", owner: v.owner, repo: v.repo, number: v.number };
    }
  } catch {
    /* fall through */
  }
  return null;
}

// ---- viewed-file persistence (debounced write to the Rust JSON file) ----
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingViewed: ViewedMap | null = null;
function schedulePersistViewed(map: ViewedMap) {
  pendingViewed = map;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(flushPersistViewed, 400);
}
function flushPersistViewed() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (pendingViewed) {
    const map = pendingViewed;
    pendingViewed = null;
    api.setViewedMap(map).catch((e) => console.error("persist viewed failed", e));
  }
}
// Best-effort flush of a pending write before the window goes away.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPersistViewed);
}

// ---- last-seen tracking (local-only unread indicator, stored in localStorage) ----
const LAST_SEEN_KEY = "pr-flow:lastSeen";
function loadLastSeen(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(LAST_SEEN_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function saveLastSeen(map: Record<string, string>) {
  try {
    localStorage.setItem(LAST_SEEN_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

// ---- archived PRs ("e" in the inbox) -----------------------------------------
// Archiving hides a PR from the inbox *until it updates again* — the Superhuman
// "done" move. We store the updatedAt seen at archive time; any newer activity
// resurfaces the PR on its own.
const DISMISSED_KEY = "pr-flow:dismissed";
function loadDismissed(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function saveDismissed(map: Record<string, string>) {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

// ---- pending review comments (drafts batched until submit) -------------------
// Kept in the store (and localStorage) so leaving the review screen — or the
// app — never loses a drafted comment.
const PENDING_KEY = "pr-flow:pendingComments";
function loadPending(): Record<string, PendingComment[]> {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function savePending(map: Record<string, PendingComment[]>) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode errors */
  }
}
let pendingIdCounter = 0;

// ---- issue tracker bases (per account) ---------------------------------------
const TRACKERS_KEY = "pr-flow:issueTrackers";
function loadTrackers(): Record<string, string> {
  try {
    const v = JSON.parse(localStorage.getItem(TRACKERS_KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}
function saveTrackers(map: Record<string, string>) {
  try {
    localStorage.setItem(TRACKERS_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

interface AppState {
  route: Route;
  paletteOpen: boolean;
  helpOpen: boolean;
  /** Global "/" PR search (jump to any PR), available on every screen. */
  searchOpen: boolean;
  viewed: ViewedMap;
  lastSeen: Record<string, string>;
  // Inbox view state, kept here so it survives navigating into/out of a PR.
  inboxTab: InboxTabKey;
  /** prKey of the highlighted PR, so the cursor follows the PR (not an index). */
  inboxSelectedKey: string | null;
  /**
   * Whether the inbox reading pane is actually on screen. Keys the toast-host
   * offset (`data-pane` on the app root): alerts dodge the pane only when it
   * exists — an empty inbox keeps them in the corner.
   */
  inboxPaneVisible: boolean;
  setInboxPaneVisible: (visible: boolean) => void;

  // navigation
  setRoute: (route: Route) => void;
  openReview: (owner: string, repo: string, number: number) => void;
  goInbox: () => void;
  setInboxTab: (tab: InboxTabKey) => void;
  setInboxSelectedKey: (key: string | null) => void;

  // overlays
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  setHelpOpen: (open: boolean) => void;
  toggleHelp: () => void;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;

  // viewed-file state
  setViewed: (map: ViewedMap) => void;
  isViewed: (prKey: string, file: string) => boolean;
  /**
   * `fingerprint` is the file's current content fingerprint, stamped onto the
   * mark so a later content change can be detected. Callers without one (none
   * today) fall back to UNKNOWN, which reconciliation upgrades in place.
   */
  toggleViewed: (prKey: string, file: string, fingerprint?: string) => void;
  /**
   * Checks every viewed mark of a PR against its current files: content
   * mismatches are unviewed (returned), migrated legacy marks silently adopt
   * the current fingerprint. Persists only when something actually changed.
   */
  reconcileViewed: (
    prKey: string,
    files: readonly ChangedFile[],
    headSha: string,
  ) => string[];
  viewedCount: (prKey: string) => number;

  // unread tracking
  markSeen: (prKey: string, updatedAt: string) => void;
  isUnread: (prKey: string, updatedAt: string) => boolean;

  // archive ("done until it updates")
  dismissed: Record<string, string>;
  /** The most recent archive, so `z` can undo it. */
  lastDismissedKey: string | null;
  dismiss: (prKey: string, updatedAt: string) => void;
  undoDismiss: () => void;
  isDismissed: (prKey: string, updatedAt: string) => boolean;

  // accounts
  accounts: AccountInfo[];
  activeAccountId: string | null;
  setAccounts: (info: AccountsInfo) => void;
  /** Switch the backend's active account, then reload so every cache swaps. */
  switchAccount: (id: string) => void;

  // pending review comments, keyed by prKey
  pendingComments: Record<string, PendingComment[]>;
  addPendingComment: (
    prKey: string,
    c: {
      path: string;
      line: number;
      side: string;
      body: string;
      startLine?: number;
    },
  ) => void;
  removePendingComment: (prKey: string, id: string) => void;
  clearPendingComments: (prKey: string) => void;

  /**
   * The single transient alert. Everything transient (archive undo, failed
   * optimistic actions, …) goes through here so alerts always appear in the
   * one shared host (bottom-right of the content column).
   */
  toast: AppToast | null;
  setToast: (toast: AppToast | null) => void;

  /**
   * Issue-tracker linking (e.g. Jira): ticket IDs like SCR-2891 in titles
   * become links to the configured base URL. Keyed per account.
   */
  issueTrackers: Record<string, string>;
  setIssueTracker: (accountId: string, url: string | null) => void;
  /** Convenience for failure messages. */
  setFlash: (message: string | null) => void;
}

export interface AppToast {
  title: string;
  message: string;
  actionLabel?: string;
  action?: () => void;
  /** Extra line under the action row. */
  note?: string;
}

export const useAppStore = create<AppState>((set, get) => ({
  route: { name: "loading" },
  paletteOpen: false,
  helpOpen: false,
  searchOpen: false,
  viewed: {},
  lastSeen: loadLastSeen(),
  inboxTab: "reviewRequested",
  inboxSelectedKey: null,
  inboxPaneVisible: false,
  setInboxPaneVisible: (inboxPaneVisible) => set({ inboxPaneVisible }),

  setRoute: (route) => {
    saveLastRoute(route);
    set({ route });
  },
  openReview: (owner, repo, number) => {
    flushPersistViewed();
    usePerfStore.getState().markOpenStart();
    const route: Route = { name: "review", owner, repo, number };
    saveLastRoute(route);
    set({ route, paletteOpen: false, searchOpen: false });
  },
  goInbox: () => {
    flushPersistViewed();
    saveLastRoute({ name: "inbox" });
    set({ route: { name: "inbox" } });
  },
  setInboxTab: (tab) => set({ inboxTab: tab }),
  setInboxSelectedKey: (key) => set({ inboxSelectedKey: key }),

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setHelpOpen: (open) => set({ helpOpen: open }),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  setSearchOpen: (open) => set({ searchOpen: open }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),

  setViewed: (map) => set({ viewed: map }),
  isViewed: (prKey, file) => file in (get().viewed[prKey] ?? {}),
  toggleViewed: (prKey, file, fingerprint = UNKNOWN_FINGERPRINT) => {
    const next = { ...(get().viewed[prKey] ?? {}) };
    if (file in next) delete next[file];
    else next[file] = fingerprint;
    const map = { ...get().viewed, [prKey]: next };
    set({ viewed: map });
    schedulePersistViewed(map);
  },
  reconcileViewed: (prKey, files, headSha) => {
    const res = reconcileViewedEntry(get().viewed[prKey], files, headSha);
    if (!res.changed) return [];
    const map = { ...get().viewed, [prKey]: res.entry };
    set({ viewed: map });
    schedulePersistViewed(map);
    return res.unviewed;
  },
  viewedCount: (prKey) => Object.keys(get().viewed[prKey] ?? {}).length,

  markSeen: (prKey, updatedAt) => {
    const map = { ...get().lastSeen, [prKey]: updatedAt };
    set({ lastSeen: map });
    saveLastSeen(map);
  },
  isUnread: (prKey, updatedAt) => {
    const seen = get().lastSeen[prKey];
    // Unseen entirely, or updated since we last opened it.
    if (!seen) return true;
    return new Date(updatedAt).getTime() > new Date(seen).getTime();
  },

  dismissed: loadDismissed(),
  lastDismissedKey: null,
  dismiss: (prKey, updatedAt) => {
    const map = { ...get().dismissed, [prKey]: updatedAt };
    set({ dismissed: map, lastDismissedKey: prKey });
    saveDismissed(map);
  },
  undoDismiss: () => {
    const key = get().lastDismissedKey;
    if (!key) return;
    const map = { ...get().dismissed };
    delete map[key];
    set({ dismissed: map, lastDismissedKey: null });
    saveDismissed(map);
  },
  isDismissed: (prKey, updatedAt) => {
    const at = get().dismissed[prKey];
    // Archived, and the PR hasn't updated since — newer activity resurfaces it.
    if (!at) return false;
    return new Date(updatedAt).getTime() <= new Date(at).getTime();
  },

  pendingComments: loadPending(),
  addPendingComment: (prKey, c) => {
    const id = `p${Date.now()}-${pendingIdCounter++}`;
    const map = {
      ...get().pendingComments,
      [prKey]: [...(get().pendingComments[prKey] ?? []), { id, ...c }],
    };
    set({ pendingComments: map });
    savePending(map);
  },
  removePendingComment: (prKey, id) => {
    const map = {
      ...get().pendingComments,
      [prKey]: (get().pendingComments[prKey] ?? []).filter((p) => p.id !== id),
    };
    set({ pendingComments: map });
    savePending(map);
  },
  clearPendingComments: (prKey) => {
    const map = { ...get().pendingComments };
    delete map[prKey];
    set({ pendingComments: map });
    savePending(map);
  },

  issueTrackers: loadTrackers(),
  setIssueTracker: (accountId, url) => {
    const map = { ...get().issueTrackers };
    const cleaned = url?.trim();
    if (cleaned) map[accountId] = cleaned;
    else delete map[accountId];
    set({ issueTrackers: map });
    saveTrackers(map);
  },

  toast: null,
  setToast: (toast) => set({ toast }),
  setFlash: (message) =>
    set({
      toast: message ? { title: "Something didn't stick", message } : null,
    }),

  accounts: [],
  activeAccountId: null,
  setAccounts: (info) =>
    set({ accounts: info.accounts, activeAccountId: info.activeId }),
  switchAccount: (id) => {
    if (get().activeAccountId === id) return;
    // Land on the inbox after the reload — the previous account's last route
    // (e.g. a PR) doesn't exist in the new one.
    saveLastRoute({ name: "inbox" });
    api
      .setActiveAccount(id)
      .then(() => window.location.reload())
      .catch((e) => console.error("switch account failed", e));
  },
}));
