import {
  Command as CommandIcon,
  HelpCircle,
  Search,
  Ticket,
  User,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import { CommandPalette } from "./components/command-palette.tsx";
import { GlobalSearch } from "./components/global-search.tsx";
import { HelpOverlay } from "./components/help-overlay.tsx";
import { Inbox } from "./components/inbox/inbox.tsx";
import { IssueTrackerDialog } from "./components/issue-tracker-dialog.tsx";
import { PerfOverlay } from "./components/perf-overlay.tsx";
import { ReviewScreen } from "./components/review/review-screen.tsx";
import { ReviewNotifier } from "./components/review-notifier.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { TokenGate } from "./components/token-gate.tsx";
import { Kbd } from "./components/ui/kbd.tsx";
import { Spinner } from "./components/ui/spinner.tsx";
import { UpdatePrompt } from "./components/update-prompt.tsx";
import { useLoadViewed } from "./hooks/use-viewed.ts";
import type { Binding } from "./keyboard/types.ts";
import { useHotkeys } from "./keyboard/use-hotkeys.ts";
import { api } from "./lib/api.ts";
import { applyZoom, clampZoom, loadZoom, ZOOM_STEP } from "./lib/zoom.ts";
import { loadLastRoute, useAppStore } from "./store/app-store.ts";

export default function App() {
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const accounts = useAppStore((s) => s.accounts);
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const setAccounts = useAppStore((s) => s.setAccounts);
  const switchAccount = useAppStore((s) => s.switchAccount);
  const toast = useAppStore((s) => s.toast);
  const setToast = useAppStore((s) => s.setToast);
  const inboxPaneVisible = useAppStore((s) => s.inboxPaneVisible);
  const [trackerOpen, setTrackerOpen] = useState(false);

  const dismissToast = () => {
    setToast(null);
  };
  const closeTracker = () => {
    setTrackerOpen(false);
  };
  const runToastAction = () => {
    toast?.action?.();
    setToast(null);
  };

  useEffect(() => {
    if (!toast) {
      return;
    }
    const t = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(t);
  }, [toast, setToast]);

  useLoadViewed();

  useEffect(() => {
    const z = loadZoom();
    if (z !== 1) {
      applyZoom(z);
    }
  }, []);

  useEffect(() => {
    const timers = new WeakMap<Element, number>();
    function onScroll(e: Event) {
      const el = e.target;
      if (!(el instanceof HTMLElement)) {
        return;
      }
      el.classList.add("is-scrolling");
      const t = timers.get(el);
      if (t) {
        window.clearTimeout(t);
      }
      timers.set(
        el,
        window.setTimeout(() => el.classList.remove("is-scrolling"), 800)
      );
    }
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, []);

  useEffect(() => {
    api
      .hasToken()
      .then((has) =>
        setRoute(
          has ? (loadLastRoute() ?? { name: "inbox" }) : { name: "token" }
        )
      )
      .catch(() => setRoute({ name: "token" }));
    api
      .listAccounts()
      .then(setAccounts)
      .catch(() => undefined);
  }, [setRoute, setAccounts]);

  const accountBindings: Binding[] = [
    ...accounts.slice(0, 9).map(
      (a, i): Binding => ({
        description:
          a.id === activeAccountId
            ? `Account: ${a.login} · ${a.provider} (current)`
            : `Switch to ${a.login} · ${a.provider}`,
        global: true,
        group: "Accounts",
        icon: User,
        keys: `mod+${i + 1}`,
        run: () => switchAccount(a.id),
      })
    ),
    {
      description: "Add account (GitHub / GitLab)",
      global: true,
      group: "Accounts",
      icon: UserPlus,
      keys: "mod+shift+a",
      run: () => setRoute({ name: "token" }),
    },
  ];

  useHotkeys(
    "global",
    [
      {
        description: "Open command palette",
        global: true,
        group: "General",
        icon: CommandIcon,
        keys: "mod+k",
        run: () => useAppStore.getState().togglePalette(),
      },
      {
        description: "Show keyboard shortcuts",
        global: true,
        group: "General",
        icon: HelpCircle,
        keys: "?",
        run: () => useAppStore.getState().toggleHelp(),
      },
      {
        description: "Search pull requests",
        global: true,
        group: "General",
        icon: Search,
        keys: "/",
        run: () => useAppStore.setState({ searchOpen: true }),
      },
      {
        description: "Zoom in",
        global: true,
        group: "View",
        icon: ZoomIn,
        keys: ["mod+=", "mod++"],
        run: () => {
          applyZoom(clampZoom(loadZoom() + ZOOM_STEP));
        },
      },
      {
        description: "Zoom out",
        global: true,
        group: "View",
        icon: ZoomOut,
        keys: "mod+-",
        run: () => {
          applyZoom(clampZoom(loadZoom() - ZOOM_STEP));
        },
      },
      {
        description: "Reset zoom",
        global: true,
        group: "View",
        icon: Search,
        keys: "mod+0",
        run: () => {
          applyZoom(1);
        },
      },
      {
        description: "Issue tracker links (Jira)…",
        global: true,
        group: "General",
        icon: Ticket,
        keys: [],
        run: () => setTrackerOpen(true),
      },
      ...accountBindings,
    ],
    { activate: false }
  );

  const baseScope = route.name === "review" ? "review" : "inbox";
  const showRouteChrome = route.name === "inbox" || route.name === "review";

  const isMac = navigator.userAgent.includes("Macintosh");

  return (
    <div
      className="q-canvas flex h-full flex-col"
      data-pane={inboxPaneVisible ? "detail" : "none"}
      data-route={route.name}
    >
      {isMac && <div className="q-titlebar shrink-0" data-tauri-drag-region />}
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
            routeKey={`${route.owner}/${route.repo}#${route.number}`}
          />
        )}
      </div>

      {showRouteChrome ? <StatusBar baseScope={baseScope} /> : null}
      <PerfOverlay />

      <div aria-live="polite" className="qb-stack qb-stack-host">
        {showRouteChrome ? <UpdatePrompt /> : null}
        {showRouteChrome ? <ReviewNotifier /> : null}
        {!!toast && (
          <div className="qb-toast" role="alert">
            <span aria-hidden className="qb-toast-rail" />
            <div className="qb-toast-body">
              <div className="qb-toast-head">
                <span className="qb-toast-title">{toast.title}</span>
                <button
                  aria-label="Dismiss"
                  className="qb-x"
                  onClick={dismissToast}
                  type="button"
                >
                  <X aria-hidden size={14} />
                </button>
              </div>
              <div className="qb-toast-sub break-words">{toast.message}</div>
              {!!(toast.action || toast.note) && (
                <div className="qb-toast-actions">
                  {!!toast.action && (
                    <button
                      className="qb-toast-open"
                      onClick={runToastAction}
                      type="button"
                    >
                      {toast.actionLabel ?? "Undo"} <Kbd combo="z" />
                    </button>
                  )}
                  {!!toast.note && (
                    <span className="text-faint text-xs">{toast.note}</span>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <IssueTrackerDialog onClose={closeTracker} open={trackerOpen} />
      <CommandPalette baseScope={baseScope} />
      <HelpOverlay baseScope={baseScope} />
      {showRouteChrome ? <GlobalSearch /> : null}
    </div>
  );
}
