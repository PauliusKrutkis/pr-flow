import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { useHotkeys } from "../../keyboard";
import { useAppStore } from "../../store/appStore";
import { useInbox } from "../../hooks/useInbox";
import { prefetchPullRequest } from "../../hooks/usePullRequestDetail";
import { prKey } from "../../types";
import type { InboxData, InboxTabKey, PullRequest } from "../../types";
import { cn } from "../../lib/cn";
import { Spinner } from "../ui/Spinner";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
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

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const inbox = data ?? EMPTY;
  const prs = inbox[tab].prs;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prs;
    return prs.filter(
      (pr) =>
        pr.title.toLowerCase().includes(q) ||
        pr.repo.toLowerCase().includes(q) ||
        pr.author.toLowerCase().includes(q),
    );
  }, [prs, search]);

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

  // Focus the search field whenever it opens.
  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const open = (index: number) => {
    const pr = filtered[index];
    if (!pr) return;
    setSelectedKey(keyFor(pr));
    markSeen(keyFor(pr), pr.updatedAt);
    openReview(pr.owner, pr.name, pr.number);
  };

  const selectTab = (key: InboxTabKey) => {
    setTab(key);
    setSelectedKey(null);
  };

  const moveTo = (index: number) => {
    const pr = filtered[index];
    if (pr) setSelectedKey(keyFor(pr));
  };
  const next = () => moveTo(Math.min(selectedIndex + 1, filtered.length - 1));
  const prev = () => moveTo(Math.max(selectedIndex - 1, 0));

  const openSearch = () => {
    setSearch("");
    setSearchOpen(true);
  };
  const closeSearch = () => {
    setSearch("");
    setSearchOpen(false);
  };

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      next();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      prev();
    } else if (e.key === "Enter") {
      e.preventDefault();
      open(selectedIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeSearch();
    }
  }

  useHotkeys("inbox", [
    { keys: ["j", "down"], description: "Next PR", group: "Navigation", run: next },
    { keys: ["k", "up"], description: "Previous PR", group: "Navigation", run: prev },
    {
      keys: "enter",
      description: "Open PR",
      group: "Navigation",
      run: () => open(selectedIndex),
    },
    { keys: "/", description: "Search", group: "General", run: openSearch },
    { keys: "1", description: "Tab: Review requests", group: "Tabs", run: () => selectTab("reviewRequested") },
    { keys: "2", description: "Tab: Assigned", group: "Tabs", run: () => selectTab("assigned") },
    { keys: "3", description: "Tab: Created", group: "Tabs", run: () => selectTab("created") },
    { keys: "4", description: "Tab: Involved", group: "Tabs", run: () => selectTab("involved") },
  ]);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="flex h-full flex-col">
      {/* Tabs (also serve as the header) */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2">
        {TABS.map((t, i) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => selectTab(t.key)}
              title={`${t.hint} (${i + 1})`}
              className={cn(
                "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm",
                active
                  ? "border-accent text-fg"
                  : "border-transparent text-muted hover:text-fg",
              )}
            >
              {t.label}
              <Badge tone={active ? "accent" : "muted"}>{inbox[t.key].count}</Badge>
            </button>
          );
        })}
      </div>

      {/* Transient search — opened with "/", arrows to move, Enter to open, Esc to close */}
      {searchOpen && (
        <div className="shrink-0 border-b border-line bg-surface px-3 py-1.5">
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            onBlur={() => {
              if (!search) setSearchOpen(false);
            }}
            placeholder="Search PRs…   ↑↓ move · ↵ open · Esc close"
            className="w-full rounded-card border border-line bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {/* List */}
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
              className="mt-3 rounded-card border border-line px-3 py-1.5 text-sm text-fg hover:bg-elevated"
            >
              Retry
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6">
          {search ? (
            <EmptyState title="No matches" hint={`No PRs match “${search}”.`} />
          ) : tab === "reviewRequested" ? (
            <EmptyState
              icon="✓"
              title="Inbox zero — no review requests"
              hint="Nothing is waiting on your review. New requests show up here and pop a notification."
            />
          ) : (
            <EmptyState title={`No PRs in “${activeTab.label}”`} hint={activeTab.hint} />
          )}
        </div>
      ) : (
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {filtered.map((pr, i) => (
            <div key={pr.id} data-index={i}>
              <PRListItem
                pr={pr}
                selected={i === selectedIndex}
                unread={isUnread(keyFor(pr), pr.updatedAt)}
                onOpen={() => open(i)}
                onHover={() =>
                  prefetchPullRequest(pr.owner, pr.name, pr.number)
                }
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
