// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { Check, Eye, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useModalDialog } from "../../hooks/use-modal-dialog.ts";
import { useWatchedRepos } from "../../hooks/use-subscribed.ts";
import { useHotkeys } from "../../keyboard/use-hotkeys.ts";
import { api } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { queryClient, queryKeys } from "../../lib/query-client.ts";
import type { RepoHit } from "../../types.ts";
import { Kbd } from "../ui/kbd.tsx";

const REPO_URL_PREFIX = /^https?:\/\/[^/]+\//;
const TRAILING_SLASHES = /\/+$/;

function armedActionLabel(armed: number | "done" | null): string {
  if (armed === "done") {
    return "close";
  }
  if (typeof armed === "number") {
    return "stop watching";
  }
  return "watch";
}

function nextArmedAfterRemove(
  armed: number | "done" | null,
  nextLength: number
): number | "done" | null {
  if (typeof armed !== "number") {
    return armed;
  }
  if (nextLength === 0) {
    return null;
  }
  return Math.min(armed, nextLength - 1);
}

function handleWatchDialogKey(
  e: React.KeyboardEvent,
  ctx: {
    armed: number | "done" | null;
    cycleArmed: (dir: 1 | -1) => void;
    hits: RepoHit[];
    input: string;
    onClose: () => void;
    repos: string[];
    sel: number;
    setArmed: (value: number | "done" | null) => void;
    setSel: React.Dispatch<React.SetStateAction<number>>;
    stopWatching: (repo: string) => void;
    watch: (fullName: string) => void;
  }
) {
  if (e.key === "Tab") {
    e.preventDefault();
    ctx.cycleArmed(e.shiftKey ? -1 : 1);
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    ctx.setArmed(null);
    ctx.setSel((s) => Math.min(s + 1, ctx.hits.length - 1));
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    ctx.setArmed(null);
    ctx.setSel((s) => Math.max(s - 1, 0));
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (ctx.armed === "done") {
      ctx.onClose();
      return;
    }
    if (typeof ctx.armed === "number") {
      const repo = ctx.repos[ctx.armed];
      if (repo) {
        ctx.stopWatching(repo);
      }
      return;
    }
    const hit = ctx.hits[ctx.sel];
    ctx.watch(hit ? hit.fullName : ctx.input);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    ctx.onClose();
  }
}

/**
 * Manage the watched repositories behind the "Watching" tab. Typing searches
 * the provider live (private repos included, scoped to what the token sees);
 * arrows + Enter watch a result. Pasting an exact `owner/repo` or a repo URL
 * still works when search comes up empty. Saves are optimistic write-through.
 */
export function WatchReposDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }
  return <WatchReposDialogContent onClose={onClose} />;
}

function WatchReposDialogContent({ onClose }: { onClose: () => void }) {
  const { data } = useWatchedRepos();
  const listId = useId();
  const { dialogRef, onDialogCancel, onDialogClose } = useModalDialog(onClose);
  const [optimisticRepos, setOptimisticRepos] = useState<string[] | null>(null);
  const repos = optimisticRepos ?? data ?? [];
  const [input, setInput] = useState("");
  const [searchResult, setSearchResult] = useState<{
    forQuery: string;
    hits: RepoHit[];
    searching: boolean;
  } | null>(null);
  const [sel, setSel] = useState(0);
  const [armed, setArmed] = useState<number | "done" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const requestSeq = useRef(0);

  const trimmedInput = input.trim();
  const searchActive = trimmedInput.length >= 2;
  const hits =
    searchActive && searchResult?.forQuery === trimmedInput
      ? searchResult.hits
      : [];
  const searching =
    searchActive &&
    (searchResult?.forQuery !== trimmedInput || searchResult.searching);
  const repoSet = new Set(repos);

  const persist = (next: string[]) => {
    setOptimisticRepos(next);
    api
      .setWatchedRepos(next)
      .then(() => {
        queryClient.setQueryData(queryKeys.watchedRepos, next);
        queryClient.invalidateQueries({ queryKey: queryKeys.subscribed });
        setOptimisticRepos(null);
      })
      .catch(() => setOptimisticRepos(null));
  };

  const stopWatching = (repo: string) => {
    const next = repos.filter((x) => x !== repo);
    persist(next);
    setArmed((a) => nextArmedAfterRemove(a, next.length));
    inputRef.current?.focus();
  };

  const watch = (fullName: string) => {
    const cleaned = fullName
      .trim()
      .replace(REPO_URL_PREFIX, "")
      .replace(TRAILING_SLASHES, "");
    if (!cleaned.includes("/")) {
      return;
    }
    if (!repoSet.has(cleaned)) {
      persist([...repos, cleaned]);
    }
    setInput("");
    setSearchResult(null);
    inputRef.current?.focus();
  };

  const cycleArmed = (dir: 1 | -1) => {
    const order: (number | "done" | null)[] = [
      null,
      ...repos.map((_, repoIndex) => repoIndex),
      "done",
    ];
    const armedIndex = order.indexOf(armed);
    setArmed(order[(armedIndex + dir + order.length) % order.length]);
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
    setArmed(null);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    handleWatchDialogKey(e, {
      armed,
      cycleArmed,
      hits,
      input,
      onClose,
      repos,
      sel,
      setArmed,
      setSel,
      stopWatching,
      watch,
    });
  };

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-armed="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  useEffect(() => {
    if (!searchActive) {
      return;
    }
    if (debounceRef.current) {
      window.clearTimeout(debounceRef.current);
    }
    const q = trimmedInput;
    debounceRef.current = window.setTimeout(() => {
      requestSeq.current += 1;
      const seq = requestSeq.current;
      api
        .searchRepos(q)
        .then((res) => {
          if (seq !== requestSeq.current) {
            return;
          }
          setSearchResult({
            forQuery: q,
            hits: res ?? [],
            searching: false,
          });
          setSel(0);
        })
        .catch(() => {
          if (seq === requestSeq.current) {
            setSearchResult({
              forQuery: q,
              hits: [],
              searching: false,
            });
          }
        });
    }, 250);
    return () => {
      if (debounceRef.current) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [searchActive, trimmedInput]);

  useHotkeys(
    "watch-repos",
    [{ description: "Close", hidden: true, keys: "esc", run: onClose }],
    { enabled: true }
  );

  return (
    <dialog
      aria-label="Watched repositories"
      className="q-dialog q-dialog-top qw-panel"
      onCancel={onDialogCancel}
      onClose={onDialogClose}
      ref={dialogRef}
    >
      <div className="border-line border-b px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-semibold text-fg text-sm">
          <Eye aria-hidden className="text-accent" size={14} />
          Watched repositories
        </h2>
        <p className="mt-0.5 text-muted text-xs">
          Every open PR in these repos shows up under Watching — whether or not
          you're involved.
        </p>
      </div>

      <div className="px-5 py-4">
        <div className="relative">
          <Search
            aria-hidden
            className="absolute top-1/2 left-3 -translate-y-1/2 text-faint"
            size={14}
          />
          <input
            aria-controls={listId}
            aria-expanded={hits.length > 0}
            aria-label="Search repositories"
            autoComplete="off"
            className="q-input q-input-icon font-mono"
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            placeholder="Search repositories…  (or paste owner/repo)"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            value={input}
          />
          {searching ? <span aria-hidden className="qw-scan" /> : null}
        </div>

        {searchActive && (hits.length > 0 || !searching) ? (
          <div
            className="mt-2 flex flex-col gap-0.5"
            id={listId}
            role="listbox"
          >
            {hits.map((hit, i) => (
              <WatchHitRow
                hit={hit}
                index={i}
                key={hit.fullName}
                onSelect={setSel}
                onWatch={watch}
                selected={i === sel}
                watched={repoSet.has(hit.fullName)}
              />
            ))}
            {!searching && hits.length === 0 ? (
              <p className="px-2 py-2 text-faint text-xs">
                {input.includes("/")
                  ? `No matches — Enter watches “${input.trim()}” as typed.`
                  : "No matches."}
              </p>
            ) : null}
          </div>
        ) : null}

        <div
          className="mt-3 flex max-h-56 flex-col gap-1 overflow-y-auto"
          ref={listRef}
        >
          {repos.length === 0 ? (
            <p className="py-4 text-center text-faint text-xs">
              Nothing watched yet. Search above to add a repository.
            </p>
          ) : (
            repos.map((r, i) => (
              <WatchedRepoRow
                armed={armed === i}
                key={r}
                onStopWatching={stopWatching}
                repo={r}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-line border-t px-5 py-3">
        <span className="text-faint text-xs">
          <Kbd combo="up" />
          <Kbd combo="down" /> pick · <Kbd combo="enter" />{" "}
          {armedActionLabel(armed)} · <Kbd combo="tab" /> actions ·{" "}
          <Kbd combo="esc" /> done
        </span>
        <button
          className={cn(
            "q-btn q-btn-quiet",
            armed === "done" && "qw-done-armed"
          )}
          data-armed={armed === "done"}
          onClick={onClose}
          tabIndex={-1}
          type="button"
        >
          Done
        </button>
      </div>
    </dialog>
  );
}

function WatchHitRow({
  hit,
  index,
  selected,
  watched,
  onWatch,
  onSelect,
}: {
  hit: RepoHit;
  index: number;
  selected: boolean;
  watched: boolean;
  onWatch: (fullName: string) => void;
  onSelect: (index: number) => void;
}) {
  const handleClick = () => {
    if (!watched) {
      onWatch(hit.fullName);
    }
  };

  const handleMouseMove = () => {
    onSelect(index);
  };

  return (
    <button
      aria-selected={selected}
      className={cn("qw-hit", selected && "qw-hit-on")}
      disabled={watched}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      role="option"
      type="button"
    >
      <span className="q-mono min-w-0 truncate text-[13px]">
        {hit.fullName}
      </span>
      {hit.description ? (
        <span className="qw-hit-desc">{hit.description}</span>
      ) : null}
      {watched ? (
        <Check
          aria-label="Already watching"
          className="ml-auto shrink-0 text-success"
          size={13}
        />
      ) : null}
    </button>
  );
}

function WatchedRepoRow({
  repo,
  armed,
  onStopWatching,
}: {
  repo: string;
  armed: boolean;
  onStopWatching: (repo: string) => void;
}) {
  const handleClick = () => {
    onStopWatching(repo);
  };

  return (
    <div className={cn("qw-row", armed && "qw-row-armed")} data-armed={armed}>
      <span className="q-mono min-w-0 truncate text-[13px]">{repo}</span>
      <button
        aria-label={`Stop watching ${repo}`}
        className="qb-x"
        onClick={handleClick}
        tabIndex={-1}
        type="button"
      >
        <X aria-hidden size={13} />
      </button>
    </div>
  );
}
