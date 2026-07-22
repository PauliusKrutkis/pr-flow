/**
 * Tabs hide when empty (and not active) so the bar reflects where work
 * actually is; digit hotkeys (1-5) still reach a hidden tab directly, so
 * InboxTabButton keeps its digit hint tied to the tab's fixed position in
 * TABS rather than its slot among the visible ones. cycleTab walks only the
 * visible tabs, falling back to index 0 when the active tab is itself
 * hidden. Watching repos is a separate action (the "w" hotkey, command
 * palette, and docked Watch button all open the same dialog), so the
 * Watching tab follows the same visibility rule as every other tab.
 *
 * On cold start, if the active tab turns out empty, `autoTabSelected` guards
 * a one-shot correction to the first tab with content — a module-level flag
 * rather than a ref, since Inbox unmounts/remounts on every Esc-to-inbox
 * visit and re-running the correction on each remount would boomerang a
 * deliberate visit to an empty tab back to whichever tab has content.
 */
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CornerDownLeft,
  Eye,
  Link,
  Undo2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInbox } from "../../hooks/use-inbox.ts";
import { prefetchPullRequest } from "../../hooks/use-pull-request-detail.ts";
import { useSubscribed } from "../../hooks/use-subscribed.ts";
import { useHotkeys } from "../../keyboard/use-hotkeys.ts";
import { cn } from "../../lib/cn.ts";
import { formatAbsolute, formatRelativeTime } from "../../lib/time.ts";
import { useAppStore } from "../../store/app-store.ts";
import type { InboxData, InboxTabKey, PullRequest } from "../../types.ts";
import { prKey } from "../../types.ts";
import { Markdown } from "../markdown.tsx";
import { Avatar } from "../ui/avatar.tsx";
import { Kbd } from "../ui/kbd.tsx";
import { Spinner } from "../ui/spinner.tsx";
import { TicketTitle } from "../ui/ticket-title.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { PRListItem } from "./pr-list-item.tsx";
import { WatchReposDialog } from "./watch-repos-dialog.tsx";

const TABS: { key: InboxTabKey; label: string; hint: string }[] = [
  {
    hint: "PRs where your review was requested. PRs you opened appear under “Created”.",
    key: "reviewRequested",
    label: "Review requests",
  },
  { hint: "PRs assigned to you.", key: "assigned", label: "Assigned" },
  { hint: "PRs you opened.", key: "created", label: "Created" },
  {
    hint: "PRs that involve or mention you.",
    key: "involved",
    label: "Involved",
  },
  {
    hint: "Every open PR in the repositories you watch — involved or not.",
    key: "subscribed",
    label: "Watching",
  },
];

const EMPTY: InboxData = {
  assigned: { count: 0, prs: [] },
  created: { count: 0, prs: [] },
  involved: { count: 0, prs: [] },
  reviewRequested: { count: 0, prs: [] },
};

let autoTabSelected = false;

const keyFor = (pr: PullRequest) =>
  prKey({ name: pr.name, number: pr.number, owner: pr.owner });

const isHidden = (pr: PullRequest, at: string | undefined) =>
  !!at && new Date(pr.updatedAt).getTime() <= new Date(at).getTime();

function inboxZeroTitle(tab: InboxTabKey, activeTabLabel: string): string {
  if (tab === "reviewRequested") {
    return "All clear";
  }
  if (tab === "subscribed") {
    return "Not watching anything yet";
  }
  return `Nothing in “${activeTabLabel}”`;
}

function prStateClass(pr: PullRequest): string {
  if (pr.draft) {
    return "q-pill-draft";
  }
  if (pr.merged) {
    return "q-pill-merged";
  }
  return "q-pill-open";
}

function prStateLabel(pr: PullRequest): string {
  if (pr.draft) {
    return "Draft";
  }
  if (pr.merged) {
    return "Merged";
  }
  return "Open";
}

export function Inbox() {
  const { data, isLoading, isError, error, refetch } = useInbox();

  const openReview = useAppStore((s) => s.openReview);
  const markSeen = useAppStore((s) => s.markSeen);
  const isUnread = useAppStore((s) => s.isUnread);

  const tab = useAppStore((s) => s.inboxTab);
  const setTab = useAppStore((s) => s.setInboxTab);
  const selectedKey = useAppStore((s) => s.inboxSelectedKey);
  const setSelectedKey = useAppStore((s) => s.setInboxSelectedKey);

  const listRef = useRef<HTMLDivElement>(null);
  const [listMode, setListMode] = useState<"keyboard" | "mouse">("mouse");
  const [showArchived, setShowArchived] = useState(false);

  const dismissed = useAppStore((s) => s.dismissed);
  const dismiss = useAppStore((s) => s.dismiss);
  const clearDismissed = useAppStore((s) => s.clearDismissed);
  const undoDismiss = useAppStore((s) => s.undoDismiss);
  const setToast = useAppStore((s) => s.setToast);

  const { data: subscribedData } = useSubscribed();
  const [watchOpen, setWatchOpen] = useState(false);

  const buckets = {
    ...(data ?? EMPTY),
    subscribed: subscribedData ?? { count: 0, prs: [] },
  };

  const archivedList = buckets[tab].prs.filter((pr) =>
    isHidden(pr, dismissed[keyFor(pr)])
  );
  const filtered = showArchived
    ? archivedList
    : buckets[tab].prs.filter((pr) => !isHidden(pr, dismissed[keyFor(pr)]));

  const visibleCounts = (() => {
    const m = {} as Record<InboxTabKey, number>;
    for (const t of TABS) {
      const bucket = buckets[t.key];
      const hidden = bucket.prs.filter((pr) =>
        isHidden(pr, dismissed[keyFor(pr)])
      ).length;
      m[t.key] = Math.max(0, bucket.count - hidden);
    }
    return m;
  })();

  const tabsLoaded = data !== null;
  const visibleTabs = TABS.filter(
    (t) => !tabsLoaded || visibleCounts[t.key] > 0 || t.key === tab
  );

  const inboxDataLoaded = data !== undefined && subscribedData !== undefined;
  useEffect(() => {
    if (autoTabSelected || !inboxDataLoaded) {
      return;
    }
    autoTabSelected = true;
    if (visibleCounts[tab] > 0) {
      return;
    }
    const firstNonEmpty = TABS.find((t) => visibleCounts[t.key] > 0);
    if (firstNonEmpty) {
      setTab(firstNonEmpty.key);
    }
  }, [inboxDataLoaded, visibleCounts, tab, setTab]);

  const selectedIndex = (() => {
    if (!selectedKey) {
      return 0;
    }
    const i = filtered.findIndex((pr) => keyFor(pr) === selectedKey);
    return i < 0 ? 0 : i;
  })();

  const openPR = (pr: PullRequest) => {
    setSelectedKey(keyFor(pr));
    markSeen(keyFor(pr), pr.updatedAt);
    openReview(pr.owner, pr.name, pr.number);
  };

  const open = (index: number) => {
    const pr = filtered[index];
    if (pr) {
      openPR(pr);
    }
  };

  const selectTab = (key: InboxTabKey) => {
    setTab(key);
    setSelectedKey(null);
  };

  const cycleTab = (dir: number) => {
    const order = visibleTabs.map((t) => t.key);
    if (order.length === 0) {
      return;
    }
    const i = order.indexOf(tab);
    const from = i < 0 ? 0 : i;
    selectTab(order[(from + dir + order.length) % order.length]);
  };

  const moveTo = (index: number) => {
    const pr = filtered[index];
    if (pr) {
      setSelectedKey(keyFor(pr));
    }
  };

  const next = () => {
    setListMode("keyboard");
    moveTo(Math.min(selectedIndex + 1, filtered.length - 1));
  };

  const prev = () => {
    setListMode("keyboard");
    moveTo(Math.max(selectedIndex - 1, 0));
  };

  const archiveSelected = () => {
    const pr = filtered[selectedIndex];
    if (!pr) {
      return;
    }
    const fallback = filtered[selectedIndex + 1] ?? filtered[selectedIndex - 1];
    setSelectedKey(fallback ? keyFor(fallback) : null);
    dismiss(keyFor(pr), pr.updatedAt);
    setToast({
      action: undoDismiss,
      actionLabel: "Undo",
      message: pr.title,
      note: "Back when it updates",
      title: "Archived",
    });
  };

  const restoreSelected = () => {
    const pr = filtered[selectedIndex];
    if (!pr) {
      return;
    }
    const fallback = filtered[selectedIndex + 1] ?? filtered[selectedIndex - 1];
    setSelectedKey(fallback ? keyFor(fallback) : null);
    clearDismissed(keyFor(pr));
    setToast({
      message: pr.title,
      note: "Back in your inbox",
      title: "Restored",
    });
  };

  const archiveOrRestoreSelected = () => {
    if (showArchived) {
      restoreSelected();
    } else {
      archiveSelected();
    }
  };

  const toggleArchived = () => {
    setShowArchived((v) => !v);
    setSelectedKey(null);
  };

  const undoArchive = () => {
    undoDismiss();
    setToast(null);
  };

  const copySelectedLink = () => {
    const pr = filtered[selectedIndex];
    if (!pr) {
      return;
    }
    navigator.clipboard?.writeText(pr.url).catch(() => undefined);
    setToast({ message: pr.url, title: "Copied PR link" });
  };

  const openSelected = () => {
    open(selectedIndex);
  };

  const openWatchDialog = () => {
    setWatchOpen(true);
  };

  const closeWatchDialog = () => {
    setWatchOpen(false);
  };

  const handleRetry = () => {
    refetch();
  };

  useInboxHotkeys({
    archiveSelected: archiveOrRestoreSelected,
    copySelectedLink,
    cycleTab,
    next,
    openSelected,
    openWatchDialog,
    prev,
    selectTab,
    toggleArchived,
    undoArchive,
  });

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];
  const selectedPR = filtered[selectedIndex];

  const setInboxPaneVisible = useAppStore((s) => s.setInboxPaneVisible);
  const paneVisible =
    selectedPR !== undefined && !(isLoading && !data) && !(isError && !data);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    const timer = setTimeout(() => {
      for (const offset of [0, 1, -1]) {
        const pr = filtered[selectedIndex + offset];
        if (pr) {
          prefetchPullRequest(pr.owner, pr.name, pr.number);
        }
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [selectedIndex, filtered]);

  useEffect(() => {
    setInboxPaneVisible(paneVisible);
  }, [paneVisible, setInboxPaneVisible]);
  useEffect(() => () => setInboxPaneVisible(false), [setInboxPaneVisible]);

  return (
    <div className="flex h-full flex-col">
      <InboxTabBar
        archivedActive={showArchived}
        archivedCount={archivedList.length}
        counts={visibleCounts}
        onOpenWatch={openWatchDialog}
        onSelectTab={selectTab}
        onToggleArchived={toggleArchived}
        tab={tab}
        tabs={visibleTabs}
      />

      <InboxMainContent
        activeTab={activeTab}
        filtered={filtered}
        isUnread={isUnread}
        listMode={listMode}
        listRef={listRef}
        onOpenAt={open}
        onOpenWatch={openWatchDialog}
        onRetry={handleRetry}
        onSelectPr={setSelectedKey}
        onSetListMode={setListMode}
        selectedIndex={selectedIndex}
        selectedPR={selectedPR}
        showArchived={showArchived}
        tab={tab}
        view={inboxMainView(
          isLoading,
          isError,
          data !== null,
          filtered.length,
          error
        )}
      />

      <WatchReposDialog onClose={closeWatchDialog} open={watchOpen} />
    </div>
  );
}

function useInboxHotkeys({
  next,
  prev,
  openSelected,
  archiveSelected,
  undoArchive,
  toggleArchived,
  copySelectedLink,
  cycleTab,
  selectTab,
  openWatchDialog,
}: {
  next: () => void;
  prev: () => void;
  openSelected: () => void;
  archiveSelected: () => void;
  undoArchive: () => void;
  toggleArchived: () => void;
  copySelectedLink: () => void;
  cycleTab: (dir: number) => void;
  selectTab: (key: InboxTabKey) => void;
  openWatchDialog: () => void;
}) {
  const selectReviewRequested = () => {
    selectTab("reviewRequested");
  };
  const selectAssigned = () => {
    selectTab("assigned");
  };
  const selectCreated = () => {
    selectTab("created");
  };
  const selectInvolved = () => {
    selectTab("involved");
  };
  const selectSubscribed = () => {
    selectTab("subscribed");
  };
  const cycleTabForward = (e: KeyboardEvent) => {
    cycleTab(e.shiftKey ? -1 : 1);
  };

  useHotkeys("inbox", [
    {
      description: "Next PR",
      group: "Navigation",
      icon: ArrowDown,
      keys: ["j", "down"],
      run: next,
    },
    {
      description: "Previous PR",
      group: "Navigation",
      icon: ArrowUp,
      keys: ["k", "up"],
      run: prev,
    },
    {
      description: "Open PR",
      group: "Navigation",
      icon: CornerDownLeft,
      keys: "enter",
      run: openSelected,
    },
    {
      description: "Archive until it updates",
      group: "Navigation",
      icon: Archive,
      keys: "e",
      run: archiveSelected,
    },
    {
      description: "Undo archive",
      group: "Navigation",
      icon: Undo2,
      keys: "z",
      run: undoArchive,
    },
    {
      description: "Show archived / back",
      group: "Navigation",
      icon: ArchiveRestore,
      keys: "u",
      run: toggleArchived,
    },
    {
      description: "Copy PR link",
      group: "Navigation",
      icon: Link,
      keys: "y",
      run: copySelectedLink,
    },
    {
      description: "Next / previous tab",
      group: "Tabs",
      icon: ArrowLeftRight,
      keys: "tab",
      run: cycleTabForward,
    },
    {
      description: "Tab: Review requests",
      group: "Tabs",
      keys: "1",
      run: selectReviewRequested,
    },
    {
      description: "Tab: Assigned",
      group: "Tabs",
      keys: "2",
      run: selectAssigned,
    },
    {
      description: "Tab: Created",
      group: "Tabs",
      keys: "3",
      run: selectCreated,
    },
    {
      description: "Tab: Involved",
      group: "Tabs",
      keys: "4",
      run: selectInvolved,
    },
    {
      description: "Tab: Watching",
      group: "Tabs",
      keys: "5",
      run: selectSubscribed,
    },
    {
      description: "Watch repositories…",
      group: "Tabs",
      icon: Eye,
      keys: "w",
      run: openWatchDialog,
    },
  ]);
}

function InboxTabBar({
  tab,
  tabs,
  counts,
  onSelectTab,
  archivedActive,
  archivedCount,
  onToggleArchived,
  onOpenWatch,
}: {
  tab: InboxTabKey;
  tabs: (typeof TABS)[number][];
  counts: Record<InboxTabKey, number>;
  onSelectTab: (key: InboxTabKey) => void;
  archivedActive: boolean;
  archivedCount: number;
  onToggleArchived: () => void;
  onOpenWatch: () => void;
}) {
  return (
    <div className="qi-tabs shrink-0 border-line border-b px-3">
      {tabs.map((t) => (
        <InboxTabButton
          active={t.key === tab}
          count={counts[t.key]}
          index={TABS.findIndex((d) => d.key === t.key)}
          key={t.key}
          onSelectTab={onSelectTab}
          tabDef={t}
        />
      ))}
      <Tooltip anchorClassName="ml-auto" combo="w" label="Watch repositories…">
        <button className="qi-watch-button" onClick={onOpenWatch} type="button">
          <Eye size={14} />
          Watch
        </button>
      </Tooltip>
      <Tooltip
        combo="u"
        label={
          archivedActive ? "Back to the inbox" : "Show archived pull requests"
        }
      >
        <button
          className="qi-archived-toggle"
          data-state={archivedActive ? "active" : "inactive"}
          onClick={onToggleArchived}
          type="button"
        >
          {archivedActive ? (
            <ArchiveRestore size={14} />
          ) : (
            <Archive size={14} />
          )}
          Archived
          {archivedCount > 0 && (
            <span className="qi-tab-count">{archivedCount}</span>
          )}
        </button>
      </Tooltip>
    </div>
  );
}

function InboxTabButton({
  tabDef,
  index,
  active,
  count,
  onSelectTab,
}: {
  tabDef: (typeof TABS)[number];
  index: number;
  active: boolean;
  count: number;
  onSelectTab: (key: InboxTabKey) => void;
}) {
  const handleClick = () => {
    onSelectTab(tabDef.key);
  };

  return (
    <Tooltip combo={String(index + 1)} label={tabDef.hint}>
      <button
        className="qi-tab"
        data-state={active ? "active" : "inactive"}
        onClick={handleClick}
        type="button"
      >
        {tabDef.label}
        <span className="qi-tab-count">{count}</span>
      </button>
    </Tooltip>
  );
}

function inboxMainView(
  isLoading: boolean,
  isError: boolean,
  hasData: boolean,
  filteredLength: number,
  error: unknown
):
  | { kind: "loading" }
  | { kind: "error"; error: unknown }
  | { kind: "empty" }
  | { kind: "list" } {
  if (isLoading && !hasData) {
    return { kind: "loading" };
  }
  if (isError && !hasData) {
    return { error, kind: "error" };
  }
  if (filteredLength === 0) {
    return { kind: "empty" };
  }
  return { kind: "list" };
}

function InboxMainContent({
  view,
  filtered,
  tab,
  activeTab,
  onOpenWatch,
  onRetry,
  listRef,
  listMode,
  onSetListMode,
  selectedIndex,
  selectedPR,
  onSelectPr,
  onOpenAt,
  isUnread,
  showArchived,
}: {
  view:
    | { kind: "loading" }
    | { kind: "error"; error: unknown }
    | { kind: "empty" }
    | { kind: "list" };
  filtered: PullRequest[];
  tab: InboxTabKey;
  activeTab: (typeof TABS)[number];
  onOpenWatch: () => void;
  onRetry: () => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  listMode: "keyboard" | "mouse";
  onSetListMode: (mode: "keyboard" | "mouse") => void;
  selectedIndex: number;
  selectedPR: PullRequest | undefined;
  onSelectPr: (key: string | null) => void;
  onOpenAt: (index: number) => void;
  isUnread: (key: string, updatedAt: string) => boolean;
  showArchived: boolean;
}) {
  if (view.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner label="Loading pull requests…" />
      </div>
    );
  }

  if (view.kind === "error") {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="font-medium text-danger text-sm">
            Couldn't load pull requests
          </p>
          <p className="mt-1 break-words text-muted text-xs">
            {String(view.error)}
          </p>
          <button
            className="q-btn q-btn-quiet mt-3"
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === "empty") {
    if (showArchived) {
      return (
        <InboxZero
          hint="Archive a PR with e and it waits here — press u to come back."
          title={`No archived PRs in “${activeTab.label}”`}
        />
      );
    }
    return (
      <InboxZero
        action={
          tab === "subscribed"
            ? {
                kbd: "w",
                label: "Watch a repository",
                onClick: onOpenWatch,
              }
            : undefined
        }
        hint={
          tab === "reviewRequested"
            ? "Nothing is waiting on your review. New requests land here and pop a toast."
            : activeTab.hint
        }
        title={inboxZeroTitle(tab, activeTab.label)}
      />
    );
  }

  return (
    <InboxListPane
      activeTab={activeTab}
      filtered={filtered}
      isUnread={isUnread}
      listMode={listMode}
      listRef={listRef}
      onOpenAt={onOpenAt}
      onSelectPr={onSelectPr}
      onSetListMode={onSetListMode}
      selectedIndex={selectedIndex}
      selectedPR={selectedPR}
      showArchived={showArchived}
    />
  );
}

function InboxListPane({
  activeTab,
  filtered,
  listRef,
  listMode,
  onSetListMode,
  selectedIndex,
  selectedPR,
  onSelectPr,
  onOpenAt,
  isUnread,
  showArchived,
}: {
  activeTab: (typeof TABS)[number];
  filtered: PullRequest[];
  listRef: React.RefObject<HTMLDivElement | null>;
  listMode: "keyboard" | "mouse";
  onSetListMode: (mode: "keyboard" | "mouse") => void;
  selectedIndex: number;
  selectedPR: PullRequest | undefined;
  onSelectPr: (key: string | null) => void;
  onOpenAt: (index: number) => void;
  isUnread: (key: string, updatedAt: string) => boolean;
  showArchived: boolean;
}) {
  const handleListMouseMove = () => {
    if (listMode !== "mouse") {
      onSetListMode("mouse");
    }
  };

  const handleSelectPr = (pr: PullRequest) => {
    onSelectPr(keyFor(pr));
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[1fr_380px] max-[900px]:grid-cols-1">
      <div
        aria-label={activeTab.label}
        className="q-inbox-list min-h-0 overflow-y-auto border-line border-r py-3"
        data-mode={listMode}
        onMouseMove={handleListMouseMove}
        ref={listRef}
        role="listbox"
        tabIndex={0}
      >
        {showArchived && (
          <div className="qi-archived-banner">
            <ArchiveRestore size={13} />
            <span>
              Archived — <Kbd combo="e" /> restores, <Kbd combo="u" /> returns
            </span>
          </div>
        )}
        {filtered.map((pr, i) => (
          <InboxPrRow
            index={i}
            key={pr.id}
            onOpenAt={onOpenAt}
            onSelectPr={handleSelectPr}
            pr={pr}
            selected={i === selectedIndex}
            unread={isUnread(keyFor(pr), pr.updatedAt)}
          />
        ))}
      </div>

      {selectedPR === undefined ? null : (
        <InboxDetail pr={selectedPR} showArchived={showArchived} />
      )}
    </div>
  );
}

function InboxPrRow({
  pr,
  index,
  selected,
  onSelectPr,
  onOpenAt,
  unread,
}: {
  pr: PullRequest;
  index: number;
  selected: boolean;
  onSelectPr: (pr: PullRequest) => void;
  onOpenAt: (index: number) => void;
  unread: boolean;
}) {
  const handleHover = () => {
    onSelectPr(pr);
    prefetchPullRequest(pr.owner, pr.name, pr.number);
  };

  const handleOpen = () => {
    onOpenAt(index);
  };

  return (
    <div data-index={index}>
      <PRListItem
        onHover={handleHover}
        onOpen={handleOpen}
        pr={pr}
        selected={selected}
        unread={unread}
      />
    </div>
  );
}

/**
 * The empty inbox — a quiet full-bleed moment instead of an empty two-pane
 * layout. The return-key mark nods back at the app icon.
 */
function InboxZero({
  title,
  hint,
  action,
}: {
  title: string;
  hint: string;
  action?: { label: string; kbd: string; onClick: () => void };
}) {
  return (
    <div className="qz-wrap flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div aria-hidden className="qz-glyph">
        <svg
          aria-label="Inbox zero"
          fill="none"
          height="26"
          role="img"
          viewBox="0 0 48 48"
          width="26"
        >
          <title>Inbox zero</title>
          <path
            d="M34 12 v10 a5 5 0 0 1 -5 5 H14"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
          />
          <path
            d="M20 19 L12 27 L20 35"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
          />
        </svg>
      </div>
      <p className="qz-title">{title}</p>
      <p className="qz-hint">{hint}</p>
      {action ? (
        <button
          className="q-btn q-btn-quiet q-focus mt-5"
          onClick={action.onClick}
          type="button"
        >
          {action.label} <Kbd combo={action.kbd} />
        </button>
      ) : null}
    </div>
  );
}

/**
 * The reading pane — a calm summary of the selected PR: one meta line, the
 * title carrying the weight, an author row, a single stat strip, and the
 * description. No boxes-in-boxes.
 */
function InboxDetail({
  pr,
  showArchived,
}: {
  pr: PullRequest;
  showArchived: boolean;
}) {
  const body = pr.body.trim();
  const trackerBase = useAppStore((s) =>
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined
  );
  const stateCls = prStateClass(pr);
  const stateLabel = prStateLabel(pr);

  return (
    <aside
      aria-label="Pull request detail"
      className="qi-detail hidden bg-surface min-[900px]:flex"
    >
      <header className="qi-detail-head">
        <div className="qi-detail-meta">
          <span className={cn("q-pill", stateCls)}>
            <span className="q-pill-dot" />
            {stateLabel}
          </span>
          <span className="qi-detail-num">#{pr.number}</span>
          <span className="q-dot">·</span>
          <span className="qi-detail-repo" title={pr.repo}>
            {pr.repo}
          </span>
        </div>
        <h2 className="qi-detail-title">
          <TicketTitle title={pr.title} trackerBase={trackerBase} />
        </h2>
        <div className="qi-detail-author">
          <Avatar name={pr.author} size={20} url={pr.authorAvatarUrl} />
          <span className="qi-detail-author-name">{pr.author}</span>
          <span className="qi-detail-time" title={formatAbsolute(pr.updatedAt)}>
            updated {formatRelativeTime(pr.updatedAt)}
          </span>
        </div>
        <div className="qi-detail-stats">
          {pr.changedFiles > 0 ? (
            <span>
              {pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"}
            </span>
          ) : null}
          {pr.additions + pr.deletions > 0 ? (
            <>
              {pr.changedFiles > 0 ? <span className="q-dot">·</span> : null}
              <span>
                <span className="qi-add">+{pr.additions}</span>{" "}
                <span className="qi-del">−{pr.deletions}</span>
              </span>
            </>
          ) : null}
          {pr.changedFiles > 0 || pr.additions + pr.deletions > 0 ? (
            <span className="q-dot">·</span>
          ) : null}
          <span>
            {pr.commentsCount} comment{pr.commentsCount === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="qi-detail-body">
        {body ? (
          <>
            <div className="qi-detail-kicker">Description</div>
            <Markdown owner={pr.owner} repo={pr.name}>
              {body}
            </Markdown>
          </>
        ) : (
          <p className="qi-detail-none">No description provided.</p>
        )}

        {pr.lastComment === undefined ? null : (
          <div className="qi-detail-comment">
            <div className="qi-detail-kicker">Latest comment</div>
            <div className="qi-detail-comment-meta">
              <Avatar
                name={pr.lastComment.author}
                size={16}
                url={pr.lastComment.authorAvatarUrl}
              />
              <span className="qi-detail-author-name">
                {pr.lastComment.author}
              </span>
              <span
                className="qi-detail-time"
                title={formatAbsolute(pr.lastComment.createdAt)}
              >
                {formatRelativeTime(pr.lastComment.createdAt)}
              </span>
            </div>
            <p className="qi-detail-comment-body">{pr.lastComment.body}</p>
          </div>
        )}
      </div>

      <footer className="qi-detail-foot">
        <span className="qi-detail-hint">
          <Kbd combo="enter" /> open review
        </span>
        <span className="q-dot">·</span>
        <span className="qi-detail-hint">
          <Kbd combo="e" /> {showArchived ? "restore" : "archive"}
        </span>
      </footer>
    </aside>
  );
}
