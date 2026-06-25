import { useEffect } from "react";
import { useAppStore } from "./store/appStore";
import { useHotkeys } from "./keyboard";
import { useLoadViewed } from "./hooks/useViewed";
import { api } from "./lib/api";
import { TokenGate } from "./components/TokenGate";
import { Inbox } from "./components/inbox/Inbox";
import { ReviewScreen } from "./components/review/ReviewScreen";
import { CommandPalette } from "./components/CommandPalette";
import { HelpOverlay } from "./components/HelpOverlay";
import { StatusBar } from "./components/StatusBar";
import { Spinner } from "./components/ui/Spinner";

export default function App() {
  const route = useAppStore((s) => s.route);
  const setRoute = useAppStore((s) => s.setRoute);
  const togglePalette = useAppStore((s) => s.togglePalette);
  const toggleHelp = useAppStore((s) => s.toggleHelp);

  useLoadViewed();

  // Boot: token gate vs inbox.
  useEffect(() => {
    api
      .hasToken()
      .then((has) => setRoute(has ? { name: "inbox" } : { name: "token" }))
      .catch(() => setRoute({ name: "token" }));
  }, [setRoute]);

  // Shortcuts available everywhere (registered without changing active scope).
  useHotkeys(
    "global",
    [
      {
        keys: "mod+k",
        description: "Open command palette",
        group: "General",
        run: () => togglePalette(),
        global: true,
      },
      {
        keys: "?",
        description: "Show keyboard shortcuts",
        group: "General",
        run: () => toggleHelp(),
        global: true,
      },
    ],
    { activate: false },
  );

  const baseScope = route.name === "review" ? "review" : "inbox";

  const showStatusBar = route.name === "inbox" || route.name === "review";

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        {route.name === "loading" && (
          <div className="flex h-full items-center justify-center">
            <Spinner label="Loading…" />
          </div>
        )}
        {route.name === "token" && (
          <TokenGate onAuthenticated={() => setRoute({ name: "inbox" })} />
        )}
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

      {showStatusBar && <StatusBar baseScope={baseScope} />}

      <CommandPalette baseScope={baseScope} />
      <HelpOverlay baseScope={baseScope} />
    </div>
  );
}
