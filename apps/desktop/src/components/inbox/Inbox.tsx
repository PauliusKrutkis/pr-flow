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
import { useEffect, useMemo, useRef, useState } from "react";
import { useInbox } from "../../hooks/useInbox.ts";
import { prefetchPullRequest } from "../../hooks/usePullRequestDetail.ts";
import { useSubscribed } from "../../hooks/useSubscribed.ts";
import { useHotkeys } from "../../keyboard/index.ts";
import { formatAbsolute, formatRelativeTime } from "../../lib/time.ts";
import { useAppStore } from "../../store/appStore.ts";
import type {
  InboxBucket,
  InboxData,
  InboxTabKey,
  PullRequest,
} from "../../types.ts";
import { prKey } from "../../types.ts";
import { Markdown } from "../Markdown.tsx";
import { Avatar } from "../ui/Avatar.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { TicketTitle } from "../ui/TicketTitle.tsx";
import { PRListItem } from "./PRListItem.tsx";
import { WatchReposDialog } from "./WatchReposDialog.tsx";

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

const keyFor = (pr: PullRequest) =>
  prKey({ name: pr.name, number: pr.number, owner: pr.owner });

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
    [inbox, subscribedData, tab, dismissed]
  );

  const visibleCounts = useMemo(() => {
    const m = {} as Record<InboxTabKey, number>;
    for (const t of TABS) {
      const bucket = buckets[t.key];
      const hidden = bucket.prs.filter((pr) =>
        isHidden(pr, dismissed[keyFor(pr)])
      ).length;
      m[t.key] = Math.max(0, bucket.count - hidden);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inbox, subscribedData, dismissed]);

  const selectedIndex = useMemo(() => {
    if (!selectedKey) {
      return 0;
    }
    const i = filtered.findIndex((pr) => keyFor(pr) === selectedKey);
    return i < 0 ? 0 : i;
  }, [filtered, selectedKey]);

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
    const order = TABS.map((t) => t.key);
    const i = order.indexOf(tab);
    selectTab(order[(i + dir + order.length) % order.length]);
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
  const undoArchive = () => {
    undoDismiss();
    setToast(null);
  };

  const copySelectedLink = () => {
    const pr = filtered[selectedIndex];
    if (!pr) {
      return;
    }
    void navigator.clipboard?.writeText(pr.url).catch(() => {});
    setToast({ message: pr.url, title: "Copied PR link" });
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
      run: () => open(selectedIndex),
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
      run: (e) => cycleTab(e.shiftKey ? -1 : 1),
    },
    {
      description: "Tab: Review requests",
      group: "Tabs",
      keys: "1",
      run: () => selectTab("reviewRequested"),
    },
    {
      description: "Tab: Assigned",
      group: "Tabs",
      keys: "2",
      run: () => selectTab("assigned"),
    },
    {
      description: "Tab: Created",
      group: "Tabs",
      keys: "3",
      run: () => selectTab("created"),
    },
    {
      description: "Tab: Involved",
      group: "Tabs",
      keys: "4",
      run: () => selectTab("involved"),
    },
    {
      description: "Tab: Watching",
      group: "Tabs",
      keys: "5",
      run: () => selectTab("subscribed"),
    },
    {
      description: "Watch repositories…",
      group: "Tabs",
      icon: Eye,
      keys: "w",
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
  useEffect(() => () => setInboxPaneVisible(false), [setInboxPaneVisible]);

  return (
    <div className="flex h-full flex-col">
      <div className="qi-tabs shrink-0 border-line border-b px-3">
        {TABS.map((t, i) => {
          const active = t.key === tab;
          return (
            <button
              className="qi-tab"
              data-state={active ? "active" : "inactive"}
              key={t.key}
              onClick={() => selectTab(t.key)}
              title={`${t.hint} (${i + 1})`}
              type="button"
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
            <p className="font-medium text-danger text-sm">
              Couldn't load pull requests
            </p>
            <p className="mt-1 break-words text-muted text-xs">
              {String(error)}
            </p>
            <button
              className="q-btn q-btn-quiet mt-3"
              onClick={() => void refetch()}
              type="button"
            >
              Retry
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <InboxZero
          action={
            tab === "subscribed"
              ? {
                  kbd: "w",
                  label: "Watch a repository",
                  onClick: () => setWatchOpen(true),
                }
              : undefined
          }
          hint={
            tab === "reviewRequested"
              ? "Nothing is waiting on your review. New requests land here and pop a toast."
              : activeTab.hint
          }
          title={
            tab === "reviewRequested"
              ? "All clear"
              : tab === "subscribed"
                ? "Not watching anything yet"
                : `Nothing in “${activeTab.label}”`
          }
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_380px] max-[900px]:grid-cols-1">
          <div
            aria-label={activeTab.label}
            className="q-inbox-list min-h-0 overflow-y-auto border-line border-r py-3"
            data-mode={listMode}
            onMouseMove={() => {
              if (listMode !== "mouse") {
                setListMode("mouse");
              }
            }}
            ref={listRef}
            role="listbox"
          >
            {filtered.map((pr, i) => (
              <div data-index={i} key={pr.id}>
                <PRListItem
                  onHover={() => {
                    setSelectedKey(keyFor(pr));
                    prefetchPullRequest(pr.owner, pr.name, pr.number);
                  }}
                  onOpen={() => open(i)}
                  pr={pr}
                  selected={i === selectedIndex}
                  unread={isUnread(keyFor(pr), pr.updatedAt)}
                />
              </div>
            ))}
          </div>

          {selectedPR && <InboxDetail pr={selectedPR} />}
        </div>
      )}

      <WatchReposDialog onClose={() => setWatchOpen(false)} open={watchOpen} />
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
        <svg fill="none" height="26" viewBox="0 0 48 48" width="26">
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
      {action && (
        <button
          className="q-btn q-btn-quiet q-focus mt-5"
          onClick={action.onClick}
          type="button"
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
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined
  );
  const stateCls = pr.draft
    ? "q-pill-draft"
    : pr.merged
      ? "q-pill-merged"
      : "q-pill-open";
  const stateLabel = pr.draft ? "Draft" : pr.merged ? "Merged" : "Open";

  return (
    <aside
      aria-label="Pull request detail"
      className="qi-detail hidden bg-surface min-[900px]:flex"
    >
      <header className="qi-detail-head">
        <div className="qi-detail-meta">
          <span className={"q-pill" + stateCls}>
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
          <Kbd combo="e" /> archive
        </span>
      </footer>
    </aside>
  );
}
