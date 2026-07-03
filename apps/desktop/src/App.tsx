import { useEffect } from "react";
import {
  Command,
  HelpCircle,
  Search,
  User,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useAppStore, loadLastRoute } from "./store/appStore";
import type { Binding } from "./keyboard/types";
import { useHotkeys } from "./keyboard";
import { useLoadViewed } from "./hooks/useViewed";
import { api } from "./lib/api";
import { TokenGate } from "./components/TokenGate";
import { Inbox } from "./components/inbox/Inbox";
import { ReviewScreen } from "./components/review/ReviewScreen";
import { CommandPalette } from "./components/CommandPalette";
import { HelpOverlay } from "./components/HelpOverlay";
import { GlobalSearch } from "./components/GlobalSearch";
import { ReviewNotifier } from "./components/ReviewNotifier";
import { UpdatePrompt } from "./components/UpdatePrompt";
import { Spinner } from "./components/ui/Spinner";
import { Kbd } from "./components/ui/Kbd";
import { applyZoom, clampZoom, loadZoom, ZOOM_STEP } from "./lib/zoom";

export default function App() {
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const togglePalette = useAppStore((s) => s.togglePalette);
  const toggleHelp = useAppStore((s) => s.toggleHelp);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const accounts = useAppStore((s) => s.accounts);
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const setAccounts = useAppStore((s) => s.setAccounts);
  const switchAccount = useAppStore((s) => s.switchAccount);
  const toast = useAppStore((s) => s.toast);
  const setToast = useAppStore((s) => s.setToast);

  // Toasts self-dismiss (archive undo, failed optimistic actions, …).
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 8_000);
    return () => window.clearTimeout(t);
  }, [toast, setToast]);

  useLoadViewed();

  // Re-apply the persisted zoom factor on boot.
  useEffect(() => {
    const z = loadZoom();
    if (z !== 1) void applyZoom(z);
  }, []);

  // Overlay scrollbars: thumbs are invisible until their container actually
  // scrolls (see index.css). Capture-phase so every scroll container reports.
  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    function onScroll(e: Event) {
      const el = e.target;
      if (!(el instanceof HTMLElement)) return;
      el.classList.add("is-scrolling");
      const t = timers.get(el);
      if (t) window.clearTimeout(t);
      timers.set(
        el,
        window.setTimeout(() => el.classList.remove("is-scrolling"), 800),
      );
    }
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

  // Boot: token gate, or resume the screen you were last on (falling back to
  // the inbox). `setRoute` here intentionally restores the persisted route.
  useEffect(() => {
    api
      .hasToken()
      .then((has) =>
        setRoute(has ? (loadLastRoute() ?? { name: "inbox" }) : { name: "token" }),
      )
      .catch(() => setRoute({ name: "token" }));
    api.listAccounts().then(setAccounts).catch(() => {});
  }, [setRoute, setAccounts]);

  // Accounts in the palette: ⌘1…⌘9 switch, plus an "Add account" entry.
  const accountBindings: Binding[] = [
    ...accounts.slice(0, 9).map(
      (a, i): Binding => ({
        keys: `mod+${i + 1}`,
        description:
          a.id === activeAccountId
            ? `Account: ${a.login} · ${a.provider} (current)`
            : `Switch to ${a.login} · ${a.provider}`,
        group: "Accounts",
        icon: User,
        run: () => switchAccount(a.id),
        global: true,
      }),
    ),
    {
      keys: "mod+shift+a",
      description: "Add account (GitHub / GitLab)",
      group: "Accounts",
      icon: UserPlus,
      run: () => setRoute({ name: "token" }),
      global: true,
    },
  ];

  // Shortcuts available everywhere (registered without changing active scope).
  useHotkeys(
    "global",
    [
      {
        keys: "mod+k",
        description: "Open command palette",
        group: "General",
        icon: Command,
        run: () => togglePalette(),
        global: true,
      },
      {
        keys: "?",
        description: "Show keyboard shortcuts",
        group: "General",
        icon: HelpCircle,
        run: () => toggleHelp(),
        global: true,
      },
      {
        keys: "/",
        description: "Search pull requests",
        group: "General",
        icon: Search,
        run: () => setSearchOpen(true),
        global: true,
      },
      {
        keys: ["mod+=", "mod++"],
        description: "Zoom in",
        group: "View",
        icon: ZoomIn,
        run: () => void applyZoom(clampZoom(loadZoom() + ZOOM_STEP)),
        global: true,
      },
      {
        keys: "mod+-",
        description: "Zoom out",
        group: "View",
        icon: ZoomOut,
        run: () => void applyZoom(clampZoom(loadZoom() - ZOOM_STEP)),
        global: true,
      },
      {
        keys: "mod+0",
        description: "Reset zoom",
        group: "View",
        icon: Search,
        run: () => void applyZoom(1),
        global: true,
      },
      ...accountBindings,
    ],
    { activate: false },
  );

  const baseScope = route.name === "review" ? "review" : "inbox";

  // macOS runs with titleBarStyle: Overlay — the traffic lights float over our
  // canvas, and this slim strip gives them room and acts as the drag handle.
  const isMac = navigator.userAgent.includes("Macintosh");

  return (
    <div className="q-canvas flex h-full flex-col" data-route={route.name}>
      {isMac && <div data-tauri-drag-region className="q-titlebar shrink-0" />}
      <div className="min-h-0 flex-1">
        {route.name === "loading" && (
          <div className="flex h-full items-center justify-center">
            <Spinner label="Loading…" />
          </div>
        )}
        {route.name === "token" && <TokenGate />}
        {route.name === "inbox" && <Inbox />}
        {route.name === "review" && (
          <ReviewScreen
            key={`${route.owner}/${route.repo}#${route.number}`}
            owner={route.owner}
            repo={route.repo}
            number={route.number}
          />
        )}
      </div>

      {/* THE alert host: every transient surface (update prompt, new-review
          toast, archive undo, failure flashes) stacks here — bottom-right of
          the content column (offset from the inbox reading pane via CSS). */}
      <div className="qb-stack qb-stack-host" aria-live="polite">
        {(route.name === "inbox" || route.name === "review") && <UpdatePrompt />}
        {(route.name === "inbox" || route.name === "review") && <ReviewNotifier />}
        {toast && (
          <div className="qb-toast" role="alert">
            <span className="qb-toast-rail" aria-hidden />
            <div className="qb-toast-body">
              <div className="qb-toast-head">
                <span className="qb-toast-title">{toast.title}</span>
                <button
                  type="button"
                  className="qb-x"
                  onClick={() => setToast(null)}
                  aria-label="Dismiss"
                >
                  <X size={14} aria-hidden />
                </button>
              </div>
              <div className="qb-toast-sub break-words">{toast.message}</div>
              {(toast.action || toast.note) && (
                <div className="qb-toast-actions">
                  {toast.action && (
                    <button
                      type="button"
                      className="qb-toast-open"
                      onClick={() => {
                        toast.action?.();
                        setToast(null);
                      }}
                    >
                      {toast.actionLabel ?? "Undo"} <Kbd combo="z" />
                    </button>
                  )}
                  {toast.note && (
                    <span className="text-xs text-faint">{toast.note}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <CommandPalette baseScope={baseScope} />
      <HelpOverlay baseScope={baseScope} />
      {(route.name === "inbox" || route.name === "review") && <GlobalSearch />}
    </div>
  );
}
