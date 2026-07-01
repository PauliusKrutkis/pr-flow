import { create } from "zustand";
import { api } from "../lib/api";
import { usePerfStore } from "../lib/perf";
import type { InboxTabKey, ViewedMap } from "../types";

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
  toggleViewed: (prKey: string, file: string) => void;
  viewedCount: (prKey: string) => number;

  // unread tracking
  markSeen: (prKey: string, updatedAt: string) => void;
  isUnread: (prKey: string, updatedAt: string) => boolean;
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
  isViewed: (prKey, file) => (get().viewed[prKey] ?? []).includes(file),
  toggleViewed: (prKey, file) => {
    const current = get().viewed[prKey] ?? [];
    const next = current.includes(file)
      ? current.filter((f) => f !== file)
      : [...current, file];
    const map = { ...get().viewed, [prKey]: next };
    set({ viewed: map });
    schedulePersistViewed(map);
  },
  viewedCount: (prKey) => (get().viewed[prKey] ?? []).length,

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
}));
