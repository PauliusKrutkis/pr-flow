import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CornerDownLeft,
  Undo2,
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
  const setToast = useAppStore((s) => s.setToast);

  const inbox = data ?? EMPTY;
  const isHidden = (pr: PullRequest, at: string | undefined) =>
    !!at && new Date(pr.updatedAt).getTime() <= new Date(at).getTime();
  const filtered = useMemo(
    () => inbox[tab].prs.filter((pr) => !isHidden(pr, dismissed[keyFor(pr)])),
    [inbox, tab, dismissed],
  );
  // Tab counters reflect archives: server count minus the archived-and-quiet
  // PRs among the fetched page.
  const visibleCounts = useMemo(() => {
    const m = {} as Record<InboxTabKey, number>;
    for (const t of TABS) {
      const bucket = inbox[t.key];
      const hidden = bucket.prs.filter((pr) =>
        isHidden(pr, dismissed[keyFor(pr)]),
      ).length;
      m[t.key] = Math.max(0, bucket.count - hidden);
    }
    return m;
  }, [inbox, dismissed]);

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
    setToast({
      title: "Archived",
      message: pr.title,
      actionLabel: "Undo",
      action: undoDismiss,
      note: "Back when it updates",
    });
  };
  const undoArchive = () => {
    undoDismiss();
    setToast(null);
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
              <span className="qi-tab-count">{visibleCounts[t.key]}</span>
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
      ) : filtered.length === 0 ? (
        // Empty tab: no list, no reading pane — one calm full-bleed state.
        <InboxZero
          title={
            tab === "reviewRequested"
              ? "All clear"
              : `Nothing in “${activeTab.label}”`
          }
          hint={
            tab === "reviewRequested"
              ? "Nothing is waiting on your review. New requests land here and pop a toast."
              : activeTab.hint
          }
        />
      ) : (
        // Two-pane: a dense list left, a reading pane for the selected PR right.
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_380px] max-[900px]:grid-cols-1">
          <div
            ref={listRef}
            role="listbox"
            aria-label={activeTab.label}
            data-mode={listMode}
            onMouseMove={() => {
              if (listMode !== "mouse") setListMode("mouse");
            }}
            className="q-inbox-list min-h-0 overflow-y-auto border-r border-line py-3"
          >
            {filtered.map((pr, i) => (
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
            ))}
          </div>

          {selectedPR && <InboxDetail pr={selectedPR} />}
        </div>
      )}
    </div>
  );
}

/**
 * The empty inbox — a quiet full-bleed moment instead of an empty two-pane
 * layout. The return-key mark nods back at the app icon.
 */
function InboxZero({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="qz-wrap flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="qz-glyph" aria-hidden>
        <svg viewBox="0 0 48 48" width="26" height="26" fill="none">
          <path
            d="M34 12 v10 a5 5 0 0 1 -5 5 H14"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 19 L12 27 L20 35"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <p className="qz-title">{title}</p>
      <p className="qz-hint">{hint}</p>
    </div>
  );
}

/**
 * The reading pane — a calm summary of the selected PR: one meta line, the
 * title carrying the weight, an author row, a single stat strip, and the
 * description. No boxes-in-boxes.
 */
function InboxDetail({ pr }: { pr: PullRequest }) {
  const body = pr.body?.trim() ?? "";
  const stateCls = pr.draft
    ? "q-pill-draft"
    : pr.merged
      ? "q-pill-merged"
      : "q-pill-open";
  const stateLabel = pr.draft ? "Draft" : pr.merged ? "Merged" : "Open";

  return (
    <aside
      className="hidden min-h-0 flex-col bg-surface min-[900px]:flex"
      aria-label="Pull request detail"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <header className="border-b border-line px-5 pb-4 pt-5">
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-faint">
            <span className={"q-pill " + stateCls}>
              <span className="q-pill-dot" />
              {stateLabel}
            </span>
            <span>#{pr.number}</span>
            <span className="q-dot">·</span>
            <span className="truncate" title={pr.repo}>
              {pr.repo}
            </span>
          </div>
          <h2 className="mt-2.5 text-[17px] font-semibold leading-snug tracking-tight text-fg">
            {pr.title}
          </h2>
          <div className="mt-3 flex items-center gap-2.5">
            <Avatar url={pr.authorAvatarUrl} name={pr.author} size={22} />
            <span className="text-[13px] font-medium text-fg">{pr.author}</span>
            <span
              className="font-mono text-[11px] text-faint"
              title={formatAbsolute(pr.updatedAt)}
            >
              updated {formatRelativeTime(pr.updatedAt)}
            </span>
          </div>
          <div className="mt-3.5 flex items-center gap-2 font-mono text-xs text-muted">
            <span>
              {pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"}
            </span>
            <span className="q-dot">·</span>
            <span>
              <span className="text-success">+{pr.additions}</span>{" "}
              <span className="text-danger">−{pr.deletions}</span>
            </span>
            <span className="q-dot">·</span>
            <span>
              {pr.commentsCount} comment{pr.commentsCount === 1 ? "" : "s"}
            </span>
          </div>
        </header>

        <div className="flex-1 px-5 py-4">
          {body ? (
            <Markdown>{body}</Markdown>
          ) : (
            <p className="text-sm text-faint">No description.</p>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-line px-5 py-2.5 text-xs text-faint">
          <Kbd combo="enter" /> open review
          <span className="q-dot">·</span>
          <Kbd combo="e" /> archive
        </footer>
      </div>
    </aside>
  );
}
