import { create } from "zustand";
import { api } from "../lib/api";
import type { InboxTabKey, ViewedMap } from "../types";

export type Route =
  | { name: "loading" }
  | { name: "token" }
  | { name: "inbox" }
  | { name: "review"; owner: string; repo: string; number: number };

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
  viewed: {},
  lastSeen: loadLastSeen(),
  inboxTab: "reviewRequested",
  inboxSelectedKey: null,

  setRoute: (route) => set({ route }),
  openReview: (owner, repo, number) => {
    flushPersistViewed();
    set({ route: { name: "review", owner, repo, number }, paletteOpen: false });
  },
  goInbox: () => {
    flushPersistViewed();
    set({ route: { name: "inbox" } });
  },
  setInboxTab: (tab) => set({ inboxTab: tab }),
  setInboxSelectedKey: (key) => set({ inboxSelectedKey: key }),

  openPalette: () => set({ paletteOpen: true }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen })),
  setHelpOpen: (open) => set({ helpOpen: open }),
  toggleHelp: () => set((s) => ({ helpOpen: !s.helpOpen })),

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
