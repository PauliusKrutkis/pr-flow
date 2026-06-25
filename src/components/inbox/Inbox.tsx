import { useEffect, useMemo, useRef, useState } from "react";
import { useHotkeys } from "../../keyboard";
import { useAppStore } from "../../store/appStore";
import { usePullRequests } from "../../hooks/usePullRequests";
import { prKey } from "../../types";
import { cn } from "../../lib/cn";
import { Spinner } from "../ui/Spinner";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { PRListItem } from "./PRListItem";
import type { PullRequest } from "../../types";

export function Inbox() {
  const { data, isLoading, isFetching, isError, error, refetch } =
    usePullRequests();

  const openReview = useAppStore((s) => s.openReview);
  const markSeen = useAppStore((s) => s.markSeen);
  const isUnread = useAppStore((s) => s.isUnread);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [search, setSearch] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const prs = data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return prs;
    return prs.filter((pr) => {
      return (
        pr.title.toLowerCase().includes(q) ||
        pr.repo.toLowerCase().includes(q) ||
        pr.author.toLowerCase().includes(q)
      );
    });
  }, [prs, search]);

  // Keep the selected index within the bounds of the filtered list.
  useEffect(() => {
    setSelectedIndex((i) => {
      if (filtered.length === 0) return 0;
      return Math.min(Math.max(i, 0), filtered.length - 1);
    });
  }, [filtered.length]);

  // Scroll the selected item into view.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`);
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

  const next = () =>
    setSelectedIndex((i) =>
      filtered.length === 0 ? 0 : Math.min(i + 1, filtered.length - 1),
    );
  const prev = () => setSelectedIndex((i) => Math.max(i - 1, 0));
  const openSelected = () => open(selectedIndex);

  useHotkeys("inbox", [
    {
      keys: ["j", "down"],
      description: "Next PR",
      group: "Navigation",
      run: next,
    },
    {
      keys: ["k", "up"],
      description: "Previous PR",
      group: "Navigation",
      run: prev,
    },
    {
      keys: "enter",
      description: "Open PR",
      group: "Navigation",
      run: openSelected,
    },
    {
      keys: "r",
      description: "Refresh",
      group: "General",
      run: () => {
        refetch();
      },
    },
    {
      keys: "/",
      description: "Search",
      group: "General",
      run: () => searchRef.current?.focus(),
    },
  ]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold text-fg">Review requests</h1>
          <Badge tone="muted">{prs.length}</Badge>
        </div>
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
            <p className="mt-1 break-words text-xs text-muted">
              {String(error)}
            </p>
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
          <EmptyState
            title="No review requests"
            hint="This lists PRs where your review was requested (review-requested:@me). PRs you opened yourself won't show up here unless someone requests your review."
          />
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
