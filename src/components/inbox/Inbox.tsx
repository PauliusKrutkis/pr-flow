import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "../../keyboard";
import { useAppStore } from "../../store/appStore";
import { useInbox } from "../../hooks/useInbox";
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

export function Inbox() {
  const { data, isLoading, isFetching, isError, error, refetch } = useInbox();

  const openReview = useAppStore((s) => s.openReview);
  const markSeen = useAppStore((s) => s.markSeen);
  const isUnread = useAppStore((s) => s.isUnread);

  const [tab, setTab] = useState<InboxTabKey>("reviewRequested");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [search, setSearch] = useState("");

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

  // Clamp selection when the active list changes (tab switch, filter, refetch).
  useEffect(() => {
    setSelectedIndex((i) =>
      filtered.length === 0 ? 0 : Math.min(Math.max(i, 0), filtered.length - 1),
    );
  }, [filtered.length]);

  // Scroll the selected item into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${selectedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const keyFor = (pr: PullRequest) =>
    prKey({ owner: pr.owner, name: pr.name, number: pr.number });

  const open = (index: number) => {
    const pr = filtered[index];
    if (!pr) return;
    markSeen(keyFor(pr), pr.updatedAt);
    openReview(pr.owner, pr.name, pr.number);
  };

  const selectTab = (next: InboxTabKey) => {
    setTab(next);
    setSelectedIndex(0);
  };

  const next = () =>
    setSelectedIndex((i) =>
      filtered.length === 0 ? 0 : Math.min(i + 1, filtered.length - 1),
    );
  const prev = () => setSelectedIndex((i) => Math.max(i - 1, 0));

  useHotkeys("inbox", [
    { keys: ["j", "down"], description: "Next PR", group: "Navigation", run: next },
    { keys: ["k", "up"], description: "Previous PR", group: "Navigation", run: prev },
    {
      keys: "enter",
      description: "Open PR",
      group: "Navigation",
      run: () => open(selectedIndex),
    },
    {
      keys: "r",
      description: "Refresh",
      group: "General",
      run: () => {
        void refetch();
      },
    },
    {
      keys: "/",
      description: "Search",
      group: "General",
      run: () => searchRef.current?.focus(),
    },
    { keys: "1", description: "Tab: Review requests", group: "Tabs", run: () => selectTab("reviewRequested") },
    { keys: "2", description: "Tab: Assigned", group: "Tabs", run: () => selectTab("assigned") },
    { keys: "3", description: "Tab: Created", group: "Tabs", run: () => selectTab("created") },
    { keys: "4", description: "Tab: Involved", group: "Tabs", run: () => selectTab("involved") },
  ]);

  const activeTab = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3">
        <h1 className="text-sm font-semibold text-fg">Inbox</h1>
        <div className="flex items-center gap-3">
          {isFetching && <Spinner />}
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearch("");
                e.currentTarget.blur();
              }
            }}
            placeholder="Search PRs…"
            className={cn(
              "w-56 rounded-card border border-line bg-bg px-3 py-1.5 text-sm text-fg",
              "placeholder:text-faint focus:border-accent focus:outline-none",
            )}
          />
        </div>
      </div>

      {/* Tabs */}
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
          <EmptyState title={`No PRs in “${activeTab.label}”`} hint={activeTab.hint} />
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
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
