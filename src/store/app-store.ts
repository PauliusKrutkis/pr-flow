import { create } from "zustand";
import { api } from "../lib/api.ts";
import { usePerfStore } from "../lib/perf.ts";
import {
  autoUnviewedKey,
  reconcileViewedEntry,
  UNKNOWN_FINGERPRINT,
  unviewedReconcileToast,
} from "../lib/viewed-fingerprint.ts";
import type {
  AccountInfo,
  AccountsInfo,
  ChangedFile,
  InboxTabKey,
  PendingComment,
  ViewedMap,
} from "../types.ts";

export type Route =
  | { name: "loading" }
  | { name: "token" }
  | { name: "inbox" }
  | { name: "review"; owner: string; repo: string; number: number };

/**
 * We remember the inbox/review screen you were last on (never the token/loading
 * screens) so the next launch reopens it instead of always landing on the inbox.
 */
const LAST_ROUTE_KEY = "pr-flow:lastRoute";
type ResumableRoute = Extract<Route, { name: "inbox" } | { name: "review" }>;

function saveLastRoute(route: Route) {
  if (route.name !== "inbox" && route.name !== "review") {
    return;
  }
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
    if (v?.name === "inbox") {
      return { name: "inbox" };
    }
    if (
      v?.name === "review" &&
      typeof v.owner === "string" &&
      typeof v.repo === "string" &&
      typeof v.number === "number"
    ) {
      return { name: "review", number: v.number, owner: v.owner, repo: v.repo };
    }
  } catch {
    /* fall through */
  }
  return null;
}

/** Which inbox tab you were last on, so a restart doesn't reset it. */
const LAST_TAB_KEY = "pr-flow:lastInboxTab";
const TAB_KEYS: readonly InboxTabKey[] = [
  "reviewRequested",
  "assigned",
  "created",
  "involved",
  "subscribed",
];

function saveLastTab(tab: InboxTabKey) {
  try {
    localStorage.setItem(LAST_TAB_KEY, tab);
  } catch {
    /* ignore quota / private-mode errors */
  }
}

export function loadLastTab(): InboxTabKey | null {
  try {
    const v = localStorage.getItem(LAST_TAB_KEY);
    return (TAB_KEYS as readonly string[]).includes(v ?? "")
      ? (v as InboxTabKey)
      : null;
  } catch {
    return null;
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingViewed: ViewedMap | null = null;
function schedulePersistViewed(map: ViewedMap) {
  pendingViewed = map;
  if (persistTimer) {
    clearTimeout(persistTimer);
  }
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
    api
      .setViewedMap(map)
      .catch((e) => console.error("persist viewed failed", e));
  }
}
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flushPersistViewed);
}

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

/**
 * Archiving hides a PR from the inbox *until it updates again* — the Superhuman
 * "done" move. We store the updatedAt seen at archive time; any newer activity
 * resurfaces the PR on its own.
 */

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

/**
 * Kept in the store (and localStorage) so leaving the review screen — or the
 * app — never loses a drafted comment.
 */

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
  accounts: AccountInfo[];
  activeAccountId: string | null;
  autoUnviewed: Record<string, string[]>;
  addPendingComment: (
    prKey: string,
    c: {
      path: string;
      line: number;
      side: string;
      body: string;
      startLine?: number;
    }
  ) => void;
  clearDismissed: (prKey: string) => void;
  clearPendingComments: (prKey: string) => void;
  closePalette: () => void;
  dismiss: (prKey: string, updatedAt: string) => void;

  dismissed: Record<string, string>;
  goInbox: () => void;
  helpOpen: boolean;
  inboxPaneVisible: boolean;
  inboxSelectedKey: string | null;
  inboxTab: InboxTabKey;
  isDismissed: (prKey: string, updatedAt: string) => boolean;

  issueTrackers: Record<string, string>;
  isUnread: (prKey: string, updatedAt: string) => boolean;
  isViewed: (prKey: string, file: string) => boolean;
  lastDismissedKey: string | null;
  lastSeen: Record<string, string>;

  markSeen: (prKey: string, updatedAt: string) => void;

  openPalette: () => void;
  openReview: (owner: string, repo: string, number: number) => void;
  paletteOpen: boolean;

  pendingComments: Record<string, PendingComment[]>;
  reconcileViewed: (
    prKey: string,
    files: readonly ChangedFile[],
    headSha: string
  ) => string[];
  removePendingComment: (prKey: string, id: string) => void;
  route: Route;
  searchOpen: boolean;
  setAccounts: (info: AccountsInfo) => void;
  setFlash: (message: string | null) => void;
  setHelpOpen: (open: boolean) => void;
  setInboxPaneVisible: (visible: boolean) => void;
  setInboxSelectedKey: (key: string | null) => void;
  setInboxTab: (tab: InboxTabKey) => void;
  setIssueTracker: (accountId: string, url: string | null) => void;

  setRoute: (route: Route) => void;
  setSearchOpen: (open: boolean) => void;
  setToast: (toast: AppToast | null) => void;

  setViewed: (map: ViewedMap) => void;
  switchAccount: (id: string) => void;

  toast: AppToast | null;
  toggleHelp: () => void;
  togglePalette: () => void;
  toggleSearch: () => void;
  toggleViewed: (prKey: string, file: string, fingerprint?: string) => void;
  undoDismiss: () => void;
  viewed: ViewedMap;
  viewedCount: (prKey: string) => number;
}

interface AppToast {
  action?: () => void;
  actionLabel?: string;
  message: string;
  note?: string;
  title: string;
}

export const useAppStore = create<AppState>((set, get) => ({
  accounts: [],
  activeAccountId: null,
  autoUnviewed: {},
  addPendingComment: (prKey, c) => {
    const id = `p${Date.now()}-${pendingIdCounter}`;
    pendingIdCounter += 1;
    const map = {
      ...get().pendingComments,
      [prKey]: [...(get().pendingComments[prKey] ?? []), { id, ...c }],
    };
    set({ pendingComments: map });
    savePending(map);
  },
  clearDismissed: (prKey) => {
    const map = { ...get().dismissed };
    delete map[prKey];
    set({ dismissed: map, lastDismissedKey: null });
    saveDismissed(map);
  },
  clearPendingComments: (prKey) => {
    const map = { ...get().pendingComments };
    delete map[prKey];
    set({ pendingComments: map });
    savePending(map);
  },
  closePalette: () => set({ paletteOpen: false }),
  dismiss: (prKey, updatedAt) => {
    const map = { ...get().dismissed, [prKey]: updatedAt };
    set({ dismissed: map, lastDismissedKey: prKey });
    saveDismissed(map);
  },

  dismissed: loadDismissed(),
  goInbox: () => {
    flushPersistViewed();
    saveLastRoute({ name: "inbox" });
    set({ route: { name: "inbox" } });
  },
  helpOpen: false,
  inboxPaneVisible: false,
  inboxSelectedKey: null,
  inboxTab: loadLastTab() ?? "reviewRequested",
  isDismissed: (prKey, updatedAt) => {
    const at = get().dismissed[prKey];
    if (!at) {
      return false;
    }
    return new Date(updatedAt).getTime() <= new Date(at).getTime();
  },

  issueTrackers: loadTrackers(),
  isUnread: (prKey, updatedAt) => {
    const seen = get().lastSeen[prKey];
    if (!seen) {
      return true;
    }
    return new Date(updatedAt).getTime() > new Date(seen).getTime();
  },
  isViewed: (prKey, file) => file in (get().viewed[prKey] ?? {}),
  lastDismissedKey: null,
  lastSeen: loadLastSeen(),

  markSeen: (prKey, updatedAt) => {
    const map = { ...get().lastSeen, [prKey]: updatedAt };
    set({ lastSeen: map });
    saveLastSeen(map);
  },

  openPalette: () => set({ paletteOpen: true }),
  openReview: (owner, repo, number) => {
    flushPersistViewed();
    usePerfStore.getState().markOpenStart();
    const route: Route = { name: "review", number, owner, repo };
    saveLastRoute(route);
    set({ paletteOpen: false, route, searchOpen: false });
  },
  paletteOpen: false,

  pendingComments: loadPending(),
  reconcileViewed: (prKey, files, headSha) => {
    const res = reconcileViewedEntry(get().viewed[prKey], files, headSha);
    if (!res.changed) {
      return [];
    }
    const map = { ...get().viewed, [prKey]: res.entry };
    if (res.unviewed.length > 0) {
      const key = autoUnviewedKey(prKey, headSha);
      const prev = get().autoUnviewed[key] ?? [];
      const merged = Array.from(new Set([...prev, ...res.unviewed]));
      set({
        autoUnviewed: { ...get().autoUnviewed, [key]: merged },
        toast: unviewedReconcileToast(res.unviewed),
        viewed: map,
      });
    } else {
      set({ viewed: map });
    }
    schedulePersistViewed(map);
    return res.unviewed;
  },
  removePendingComment: (prKey, id) => {
    const map = {
      ...get().pendingComments,
      [prKey]: (get().pendingComments[prKey] ?? []).filter((p) => p.id !== id),
    };
    set({ pendingComments: map });
    savePending(map);
  },
  route: { name: "loading" },
  searchOpen: false,
  setAccounts: (info) =>
    set({ accounts: info.accounts, activeAccountId: info.activeId }),
  setFlash: (message) =>
    set({
      toast: message ? { message, title: "Something didn't stick" } : null,
    }),
  setHelpOpen: (open) => set({ helpOpen: open }),
  setInboxPaneVisible: (inboxPaneVisible) => set({ inboxPaneVisible }),
  setInboxSelectedKey: (key) => set({ inboxSelectedKey: key }),
  setInboxTab: (tab) => {
    saveLastTab(tab);
    set({ inboxTab: tab });
  },
  setIssueTracker: (accountId, url) => {
    const map = { ...get().issueTrackers };
    const cleaned = url?.trim();
    if (cleaned) {
      map[accountId] = cleaned;
    } else {
      delete map[accountId];
    }
    set({ issueTrackers: map });
    saveTrackers(map);
  },

  setRoute: (route) => {
    saveLastRoute(route);
    set({ route });
  },
  setSearchOpen: (open) => set({ searchOpen: open }),
  setToast: (toast) => set({ toast }),

  setViewed: (map) => set({ viewed: map }),
  switchAccount: (id) => {
    if (get().activeAccountId === id) {
      return;
    }
    saveLastRoute({ name: "inbox" });
    api
      .setActiveAccount(id)
      .then(() => window.location.reload())
      .catch((e) => console.error("switch account failed", e));
  },

  toast: null,
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
  toggleViewed: (prKey, file, fingerprint = UNKNOWN_FINGERPRINT) => {
    const next = { ...(get().viewed[prKey] ?? {}) };
    if (file in next) {
      delete next[file];
    } else {
      next[file] = fingerprint;
    }
    const map = { ...get().viewed, [prKey]: next };
    set({ viewed: map });
    schedulePersistViewed(map);
  },
  undoDismiss: () => {
    const key = get().lastDismissedKey;
    if (!key) {
      return;
    }
    const map = { ...get().dismissed };
    delete map[key];
    set({ dismissed: map, lastDismissedKey: null });
    saveDismissed(map);
  },
  viewed: {},
  viewedCount: (prKey) => Object.keys(get().viewed[prKey] ?? {}).length,
}));
