import { useEffect } from "react";
import { Command, HelpCircle, Search, User, UserPlus } from "lucide-react";
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

  useLoadViewed();

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
      ...accountBindings,
    ],
    { activate: false },
  );

  const baseScope = route.name === "review" ? "review" : "inbox";

  return (
    <div className="q-canvas flex h-full flex-col">
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

      <CommandPalette baseScope={baseScope} />
      <HelpOverlay baseScope={baseScope} />
      {(route.name === "inbox" || route.name === "review") && <GlobalSearch />}
      {(route.name === "inbox" || route.name === "review") && <ReviewNotifier />}
      {(route.name === "inbox" || route.name === "review") && <UpdatePrompt />}
    </div>
  );
}
