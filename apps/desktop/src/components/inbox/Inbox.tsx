import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CornerDownLeft,
  Undo2,
  X,
} from "lucide-react";
import { useHotkeys } from "../../keyboard";
import { Kbd } from "../ui/Kbd";
import { useAppStore } from "../../store/appStore";
import { useInbox } from "../../hooks/useInbox";
import { prefetchPullRequest } from "../../hooks/usePullRequestDetail";
import { prKey } from "../../types";
import type { InboxData, InboxTabKey, PullRequest } from "../../types";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Spinner } from "../ui/Spinner";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { Avatar } from "../ui/Avatar";
import { Markdown } from "../Markdown";
import { PRListItem } from "./PRListItem";

const TABS: { key: InboxTabKey; label: string; hint: string }[] = [
  {
    key: "reviewRequested",
    label: "Review requests",
    hint: "PRs where your review was requested. PRs you opened appear under “Created”.",
  },
  { key: "assigned", label: "Assigned", hint: "PRs assigned to you." },
  { key: "created", label: "Created", hint: "PRs you opened." },
  { key: "involved", label: "Involved", hint: "PRs that involve or mention you." },
];

const EMPTY: InboxData = {
  reviewRequested: { count: 0, prs: [] },
  assigned: { count: 0, prs: [] },
  created: { count: 0, prs: [] },
  involved: { count: 0, prs: [] },
};

const keyFor = (pr: PullRequest) =>
  prKey({ owner: pr.owner, name: pr.name, number: pr.number });

export function Inbox() {
  const { data, isLoading, isError, error, refetch } = useInbox();

  const openReview = useAppStore((s) => s.openReview);
  const markSeen = useAppStore((s) => s.markSeen);
  const isUnread = useAppStore((s) => s.isUnread);
  // Tab + selected PR live in the store so they survive opening/closing a PR.
  const tab = useAppStore((s) => s.inboxTab);
  const setTab = useAppStore((s) => s.setInboxTab);
  const selectedKey = useAppStore((s) => s.inboxSelectedKey);
  const setSelectedKey = useAppStore((s) => s.setInboxSelectedKey);

  const listRef = useRef<HTMLDivElement>(null);
  // Whether the cursor is being driven by keyboard or pointer (gates hover wash).
  const [listMode, setListMode] = useState<"keyboard" | "mouse">("mouse");

  // Archived PRs stay hidden until they update again (see appStore.dismiss).
  const dismissed = useAppStore((s) => s.dismissed);
  const dismiss = useAppStore((s) => s.dismiss);
  const undoDismiss = useAppStore((s) => s.undoDismiss);
  // Transient "Archived — undo?" toast after `e`.
  const [archiveToast, setArchiveToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const inbox = data ?? EMPTY;
  const filtered = useMemo(
    () =>
      inbox[tab].prs.filter((pr) => {
        const at = dismissed[keyFor(pr)];
        return !at || new Date(pr.updatedAt).getTime() > new Date(at).getTime();
      }),
    [inbox, tab, dismissed],
  );

  // Resolve the selected PR key to a position in the current list (follows the
  // PR through reorders/filtering; falls back to the top if it's gone).
  const selectedIndex = useMemo(() => {
    if (!selectedKey) return 0;
    const i = filtered.findIndex((pr) => keyFor(pr) === selectedKey);
    return i < 0 ? 0 : i;
  }, [filtered, selectedKey]);

  // Scroll the selected item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  // Prefetch the selected PR + neighbors once the cursor settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const offset of [0, 1, -1]) {
        const pr = filtered[selectedIndex + offset];
        if (pr) prefetchPullRequest(pr.owner, pr.name, pr.number);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [selectedIndex, filtered]);

  const openPR = (pr: PullRequest) => {
    setSelectedKey(keyFor(pr));
    markSeen(keyFor(pr), pr.updatedAt);
    openReview(pr.owner, pr.name, pr.number);
  };
  const open = (index: number) => {
    const pr = filtered[index];
    if (pr) openPR(pr);
  };

  const selectTab = (key: InboxTabKey) => {
    setTab(key);
    setSelectedKey(null);
  };
  const cycleTab = (dir: number) => {
    const order = TABS.map((t) => t.key);
    const i = order.indexOf(tab);
    selectTab(order[(i + dir + order.length) % order.length]);
  };

  const moveTo = (index: number) => {
    const pr = filtered[index];
    if (pr) setSelectedKey(keyFor(pr));
  };
  // Keyboard nav flips the list into "keyboard mode" so a stale pointer :hover
  // doesn't leave a second row lit under the cursor.
  const next = () => {
    setListMode("keyboard");
    moveTo(Math.min(selectedIndex + 1, filtered.length - 1));
  };
  const prev = () => {
    setListMode("keyboard");
    moveTo(Math.max(selectedIndex - 1, 0));
  };

  // `e` — archive the selected PR (hidden until it updates), cursor stays put.
  const archiveSelected = () => {
    const pr = filtered[selectedIndex];
    if (!pr) return;
    const fallback = filtered[selectedIndex + 1] ?? filtered[selectedIndex - 1];
    setSelectedKey(fallback ? keyFor(fallback) : null);
    dismiss(keyFor(pr), pr.updatedAt);
    setArchiveToast(pr.title);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setArchiveToast(null), 6000);
  };
  const undoArchive = () => {
    undoDismiss();
    setArchiveToast(null);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  };

  useHotkeys("inbox", [
    { keys: ["j", "down"], description: "Next PR", group: "Navigation", icon: ArrowDown, run: next },
    { keys: ["k", "up"], description: "Previous PR", group: "Navigation", icon: ArrowUp, run: prev },
    {
      keys: "enter",
      description: "Open PR",
      group: "Navigation",
      icon: CornerDownLeft,
      run: () => open(selectedIndex),
    },
    {
      keys: "e",
      description: "Archive until it updates",
      group: "Navigation",
      icon: Archive,
      run: archiveSelected,
    },
    {
      keys: "z",
      description: "Undo archive",
      group: "Navigation",
      icon: Undo2,
      run: undoArchive,
    },
    {
      keys: "tab",
      description: "Next / previous tab",
      group: "Tabs",
      icon: ArrowLeftRight,
      run: (e) => cycleTab(e.shiftKey ? -1 : 1),
    },
    { keys: "1", description: "Tab: Review requests", group: "Tabs", run: () => selectTab("reviewRequested") },
    { keys: "2", description: "Tab: Assigned", group: "Tabs", run: () => selectTab("assigned") },
    { keys: "3", description: "Tab: Created", group: "Tabs", run: () => selectTab("created") },
    { keys: "4", description: "Tab: Involved", group: "Tabs", run: () => selectTab("involved") },
  ]);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];
  const selectedPR = filtered[selectedIndex];

  return (
    <div className="flex h-full flex-col">
      {/* Tabs (also serve as the header) */}
      <div className="qi-tabs shrink-0 border-b border-line px-3">
        {TABS.map((t, i) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              title={`${t.hint} (${i + 1})`}
              className="qi-tab"
              data-state={active ? "active" : "inactive"}
            >
              {t.label}
              <span className="qi-tab-count">{inbox[t.key].count}</span>
            </button>
          );
        })}
      </div>

      {isLoading && !data ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner label="Loading pull requests…" />
        </div>
      ) : isError && !data ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-md text-center">
            <p className="text-sm font-medium text-danger">
              Couldn't load pull requests
            </p>
            <p className="mt-1 break-words text-xs text-muted">{String(error)}</p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="q-btn q-btn-quiet mt-3"
            >
              Retry
            </button>
          </div>
        </div>
      ) : (
        // Two-pane: a dense list left, a reading pane for the selected PR right.
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_380px] max-[900px]:grid-cols-1">
          <div className="relative min-h-0 min-w-0">
          <div
            ref={listRef}
            role="listbox"
            aria-label={activeTab.label}
            data-mode={listMode}
            onMouseMove={() => {
              if (listMode !== "mouse") setListMode("mouse");
            }}
            className="q-inbox-list h-full min-h-0 overflow-y-auto border-r border-line py-3"
          >
            {filtered.length === 0 ? (
              <div className="flex h-full items-center justify-center px-6">
                {tab === "reviewRequested" ? (
                  <EmptyState
                    icon="✓"
                    title="Inbox zero — no review requests"
                    hint="Nothing is waiting on your review. New requests show up here and pop a notification."
                  />
                ) : (
                  <EmptyState
                    title={`No PRs in “${activeTab.label}”`}
                    hint={activeTab.hint}
                  />
                )}
              </div>
            ) : (
              filtered.map((pr, i) => (
                <div key={pr.id} data-index={i}>
                  <PRListItem
                    pr={pr}
                    selected={i === selectedIndex}
                    unread={isUnread(keyFor(pr), pr.updatedAt)}
                    onOpen={() => open(i)}
                    onHover={() => {
                      // Hover moves the cursor (and the reading pane); click opens.
                      setSelectedKey(keyFor(pr));
                      prefetchPullRequest(pr.owner, pr.name, pr.number);
                    }}
                  />
                </div>
              ))
            )}
          </div>

          {/* Archive-undo toast, anchored over the list (not the reading pane). */}
          {archiveToast && (
            <div className="absolute bottom-4 left-1/2 z-40 w-[340px] max-w-[calc(100%-32px)] -translate-x-1/2">
              <div className="qb-toast" role="status">
                <span className="qb-toast-rail" aria-hidden />
                <div className="qb-toast-body">
                  <div className="qb-toast-head">
                    <span className="qb-toast-title">Archived</span>
                    <button
                      type="button"
                      className="qb-x"
                      onClick={() => setArchiveToast(null)}
                      aria-label="Dismiss"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                  <div className="qb-toast-sub">{archiveToast}</div>
                  <div className="qb-toast-actions">
                    <button
                      type="button"
                      className="qb-toast-open"
                      onClick={undoArchive}
                    >
                      Undo <Kbd combo="z" />
                    </button>
                    <span className="text-xs text-faint">Back when it updates</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          </div>

          {selectedPR ? (
            <InboxDetail pr={selectedPR} />
          ) : (
            <aside className="hidden items-center justify-center bg-surface px-6 text-center text-sm text-faint min-[900px]:flex">
              Select a pull request to see its summary.
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

/** The reading pane: an expanded summary of the selected inbox PR. */
function InboxDetail({ pr }: { pr: PullRequest }) {
  const body = pr.body?.trim() ?? "";
  const stateTone = pr.draft ? "warning" : pr.merged ? "accent" : "success";
  const stateLabel = pr.draft ? "Draft" : pr.merged ? "Merged" : "Open";

  return (
    <aside
      className="hidden min-h-0 flex-col bg-surface min-[900px]:flex"
      aria-label="Pull request detail"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={stateTone}>{stateLabel}</Badge>
            <span className="font-mono text-xs text-faint">#{pr.number}</span>
          </div>
          <h2 className="mt-2 text-[17px] font-bold leading-snug tracking-tight text-fg">
            {pr.title}
          </h2>
          <div className="mt-1 font-mono text-xs text-muted">{pr.repo}</div>
        </div>

        <div className="flex items-center gap-3 border-y border-line py-3.5">
          <Avatar url={pr.authorAvatarUrl} name={pr.author} size={26} />
          <div>
            <div className="text-sm font-semibold text-fg">{pr.author}</div>
            <div
              className="font-mono text-[11px] text-faint"
              title={formatAbsolute(pr.updatedAt)}
            >
              updated {formatRelativeTime(pr.updatedAt)}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <StatCard label="changes">
            <span className="font-mono text-sm">
              <span className="text-success">+{pr.additions}</span>{" "}
              <span className="text-danger">−{pr.deletions}</span>
            </span>
          </StatCard>
          <StatCard label="files">
            <span className="font-mono text-sm text-fg">{pr.changedFiles}</span>
          </StatCard>
          <StatCard label="comments">
            <span className="font-mono text-sm text-fg">{pr.commentsCount}</span>
          </StatCard>
          <StatCard label="state">
            <span className="text-sm font-semibold text-fg">{stateLabel}</span>
          </StatCard>
        </div>

        {body && (
          <div>
            <div className="q-eyebrow mb-2 block">Description</div>
            <Markdown>{body}</Markdown>
          </div>
        )}
      </div>
    </aside>
  );
}

function StatCard({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-[10px] border border-line bg-surface-2 px-3 py-2.5">
      {children}
      <span className="text-[10px] uppercase tracking-wider text-faint">
        {label}
      </span>
    </div>
  );
}
