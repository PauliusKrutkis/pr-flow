import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CornerDownLeft,
  Eye,
  Link,
  Undo2,
} from "lucide-react";
import { useHotkeys } from "../../keyboard";
import { Kbd } from "../ui/Kbd";
import { useAppStore } from "../../store/appStore";
import { useInbox } from "../../hooks/useInbox";
import { useSubscribed } from "../../hooks/useSubscribed";
import { prefetchPullRequest } from "../../hooks/usePullRequestDetail";
import { prKey } from "../../types";
import type { InboxBucket, InboxData, InboxTabKey, PullRequest } from "../../types";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Spinner } from "../ui/Spinner";
import { Avatar } from "../ui/Avatar";
import { Markdown } from "../Markdown";
import { PRListItem } from "./PRListItem";
import { TicketTitle } from "../ui/TicketTitle";
import { WatchReposDialog } from "./WatchReposDialog";

const TABS: { key: InboxTabKey; label: string; hint: string }[] = [
  {
    key: "reviewRequested",
    label: "Review requests",
    hint: "PRs where your review was requested. PRs you opened appear under “Created”.",
  },
  { key: "assigned", label: "Assigned", hint: "PRs assigned to you." },
  { key: "created", label: "Created", hint: "PRs you opened." },
  { key: "involved", label: "Involved", hint: "PRs that involve or mention you." },
  {
    key: "subscribed",
    label: "Watching",
    hint: "Every open PR in the repositories you watch — involved or not.",
  },
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

  const tab = useAppStore((s) => s.inboxTab);
  const setTab = useAppStore((s) => s.setInboxTab);
  const selectedKey = useAppStore((s) => s.inboxSelectedKey);
  const setSelectedKey = useAppStore((s) => s.setInboxSelectedKey);

  const listRef = useRef<HTMLDivElement>(null);
  const [listMode, setListMode] = useState<"keyboard" | "mouse">("mouse");

  const dismissed = useAppStore((s) => s.dismissed);
  const dismiss = useAppStore((s) => s.dismiss);
  const undoDismiss = useAppStore((s) => s.undoDismiss);
  const setToast = useAppStore((s) => s.setToast);

  const { data: subscribedData } = useSubscribed();
  const [watchOpen, setWatchOpen] = useState(false);

  const inbox = data ?? EMPTY;
  const buckets: Record<InboxTabKey, InboxBucket> = {
    ...inbox,
    subscribed: subscribedData ?? { count: 0, prs: [] },
  };
  const isHidden = (pr: PullRequest, at: string | undefined) =>
    !!at && new Date(pr.updatedAt).getTime() <= new Date(at).getTime();
  const filtered = useMemo(
    () => buckets[tab].prs.filter((pr) => !isHidden(pr, dismissed[keyFor(pr)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inbox, subscribedData, tab, dismissed],
  );

  const visibleCounts = useMemo(() => {
    const m = {} as Record<InboxTabKey, number>;
    for (const t of TABS) {
      const bucket = buckets[t.key];
      const hidden = bucket.prs.filter((pr) =>
        isHidden(pr, dismissed[keyFor(pr)]),
      ).length;
      m[t.key] = Math.max(0, bucket.count - hidden);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox, subscribedData, dismissed]);

  const selectedIndex = useMemo(() => {
    if (!selectedKey) return 0;
    const i = filtered.findIndex((pr) => keyFor(pr) === selectedKey);
    return i < 0 ? 0 : i;
  }, [filtered, selectedKey]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

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

  const copySelectedLink = () => {
    const pr = filtered[selectedIndex];
    if (!pr) return;
    void navigator.clipboard?.writeText(pr.url).catch(() => {});
    setToast({ title: "Copied PR link", message: pr.url });
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
      keys: "y",
      description: "Copy PR link",
      group: "Navigation",
      icon: Link,
      run: copySelectedLink,
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
    { keys: "5", description: "Tab: Watching", group: "Tabs", run: () => selectTab("subscribed") },
    {
      keys: "w",
      description: "Watch repositories…",
      group: "Tabs",
      icon: Eye,
      run: () => setWatchOpen(true),
    },
  ]);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];
  const selectedPR = filtered[selectedIndex];

  const setInboxPaneVisible = useAppStore((s) => s.setInboxPaneVisible);
  const paneVisible =
    !!selectedPR && !(isLoading && !data) && !(isError && !data);
  useEffect(() => {
    setInboxPaneVisible(paneVisible);
  }, [paneVisible, setInboxPaneVisible]);
  useEffect(
    () => () => setInboxPaneVisible(false),
    [setInboxPaneVisible],
  );

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
        <InboxZero
          title={
            tab === "reviewRequested"
              ? "All clear"
              : tab === "subscribed"
                ? "Not watching anything yet"
                : `Nothing in “${activeTab.label}”`
          }
          hint={
            tab === "reviewRequested"
              ? "Nothing is waiting on your review. New requests land here and pop a toast."
              : activeTab.hint
          }
          action={
            tab === "subscribed"
              ? { label: "Watch a repository", kbd: "w", onClick: () => setWatchOpen(true) }
              : undefined
          }
        />
      ) : (
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

      <WatchReposDialog open={watchOpen} onClose={() => setWatchOpen(false)} />
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
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="q-btn q-btn-quiet q-focus mt-5"
        >
          {action.label} <Kbd combo={action.kbd} />
        </button>
      )}
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
  const trackerBase = useAppStore((s) =>
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined,
  );
  const stateCls = pr.draft
    ? "q-pill-draft"
    : pr.merged
      ? "q-pill-merged"
      : "q-pill-open";
  const stateLabel = pr.draft ? "Draft" : pr.merged ? "Merged" : "Open";

  return (
    <aside
      className="qi-detail hidden bg-surface min-[900px]:flex"
      aria-label="Pull request detail"
    >
      <header className="qi-detail-head">
        <div className="qi-detail-meta">
          <span className={"q-pill " + stateCls}>
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
          <Avatar url={pr.authorAvatarUrl} name={pr.author} size={20} />
          <span className="qi-detail-author-name">{pr.author}</span>
          <span className="qi-detail-time" title={formatAbsolute(pr.updatedAt)}>
            updated {formatRelativeTime(pr.updatedAt)}
          </span>
        </div>
        {/* Zero-valued stats mean "the provider's list API doesn't carry
            this" (GitLab lists have no +/- totals) — hide them rather than
            show a wrong 0. */}
        <div className="qi-detail-stats">
          {pr.changedFiles > 0 && (
            <span>
              {pr.changedFiles} file{pr.changedFiles === 1 ? "" : "s"}
            </span>
          )}
          {pr.additions + pr.deletions > 0 && (
            <>
              {pr.changedFiles > 0 && <span className="q-dot">·</span>}
              <span>
                <span className="qi-add">+{pr.additions}</span>{" "}
                <span className="qi-del">−{pr.deletions}</span>
              </span>
            </>
          )}
          {(pr.changedFiles > 0 || pr.additions + pr.deletions > 0) && (
            <span className="q-dot">·</span>
          )}
          <span>
            {pr.commentsCount} comment{pr.commentsCount === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      <div className="qi-detail-body">
        {body ? (
          <>
            <div className="qi-detail-kicker">Description</div>
            <Markdown>{body}</Markdown>
          </>
        ) : (
          <p className="qi-detail-none">No description provided.</p>
        )}

        {pr.lastComment && (
          <div className="qi-detail-comment">
            <div className="qi-detail-kicker">Latest comment</div>
            <div className="qi-detail-comment-meta">
              <Avatar
                url={pr.lastComment.authorAvatarUrl}
                name={pr.lastComment.author}
                size={16}
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
          <Kbd combo="e" /> archive
        </span>
      </footer>
    </aside>
  );
}
