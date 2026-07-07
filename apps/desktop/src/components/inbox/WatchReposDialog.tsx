import { useEffect, useRef, useState } from "react";
import { Check, Eye, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import { queryClient, queryKeys } from "../../lib/queryClient";
import { useWatchedRepos } from "../../hooks/useSubscribed";
import { useHotkeys } from "../../keyboard";
import type { RepoHit } from "../../types";
import { Kbd } from "../ui/Kbd";

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
  const { data } = useWatchedRepos();
  const [repos, setRepos] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [hits, setHits] = useState<RepoHit[]>([]);
  const [sel, setSel] = useState(0);
  const [searching, setSearching] = useState(false);
  const [armed, setArmed] = useState<number | "done" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (open) {
      setInput("");
      setHits([]);
      setSel(0);
      setArmed(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => {
    if (open) setRepos(data ?? []);
  }, [open, data]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-armed="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [armed]);

  useEffect(() => {
    if (!open) return;
    const q = input.trim();
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    if (q.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = window.setTimeout(() => {
      const seq = ++requestSeq.current;
      api
        .searchRepos(q)
        .then((res) => {
          if (seq !== requestSeq.current) return; // a newer query is in flight
          setHits(res ?? []);
          setSel(0);
          setSearching(false);
        })
        .catch(() => {
          if (seq === requestSeq.current) {
            setHits([]);
            setSearching(false);
          }
        });
    }, 250);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [input, open]);

  useHotkeys(
    "watch-repos",
    [{ keys: "esc", description: "Close", hidden: true, run: () => onClose() }],
    { enabled: open },
  );

  if (!open) return null;

  function stopWatching(repo: string) {
    const next = repos.filter((x) => x !== repo);
    persist(next);
    setArmed((a) =>
      typeof a === "number"
        ? next.length === 0
          ? null
          : Math.min(a, next.length - 1)
        : a,
    );
    inputRef.current?.focus();
  }

  function persist(next: string[]) {
    setRepos(next);
    void api
      .setWatchedRepos(next)
      .then(() => {
        queryClient.setQueryData(queryKeys.watchedRepos, next);
        void queryClient.invalidateQueries({ queryKey: queryKeys.subscribed });
      })
      .catch(() => {});
  }

  function watch(fullName: string) {
    const cleaned = fullName
      .trim()
      .replace(/^https?:\/\/[^/]+\//, "")
      .replace(/\/+$/, "");
    if (!cleaned || !cleaned.includes("/")) return;
    if (!repos.includes(cleaned)) persist([...repos, cleaned]);
    setInput("");
    setHits([]);
    inputRef.current?.focus();
  }

  function cycleArmed(dir: 1 | -1) {
    /** null → each watched row → Done → null (reversed for shift+tab). */

    const order: (number | "done" | null)[] = [
      null,
      ...repos.map((_, i) => i),
      "done",
    ];
    const i = order.findIndex((t) => t === armed);
    setArmed(order[(i + dir + order.length) % order.length]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Tab") {
      e.preventDefault();
      cycleArmed(e.shiftKey ? -1 : 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setArmed(null);
      setSel((s) => Math.min(s + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setArmed(null);
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (armed === "done") {
        onClose();
      } else if (typeof armed === "number") {
        const repo = repos[armed];
        if (repo) stopWatching(repo);
      } else {
        const hit = hits[sel];
        watch(hit ? hit.fullName : input);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="q-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="q-dialog q-dialog-top qw-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Watched repositories"
      >
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Eye size={14} aria-hidden className="text-accent" />
            Watched repositories
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Every open PR in these repos shows up under Watching — whether or
            not you're involved.
          </p>
        </div>

        <div className="px-5 py-4">
          <div className="relative">
            <Search
              size={14}
              aria-hidden
              className="absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setArmed(null); // typing means "back to searching"
              }}
              onKeyDown={onKeyDown}
              placeholder="Search repositories…  (or paste owner/repo)"
              spellCheck={false}
              autoComplete="off"
              className="q-input q-input-icon font-mono"
              role="combobox"
              aria-expanded={hits.length > 0}
            />
            {/* Search-in-flight: the input's bottom edge becomes a 1px accent
                sweep — no spinner, no reserved space below. */}
            {searching && <span className="qw-scan" aria-hidden />}
          </div>

          {/* live results — only once there's something to say; an empty box
              while the first search resolves is just a weird gap */}
          {input.trim().length >= 2 && (hits.length > 0 || !searching) && (
            <div className="mt-2 flex flex-col gap-0.5" role="listbox">
              {hits.map((hit, i) => {
                const watched = repos.includes(hit.fullName);
                return (
                  <button
                    key={hit.fullName}
                    type="button"
                    role="option"
                    aria-selected={i === sel}
                    onMouseMove={() => setSel(i)}
                    onClick={() => !watched && watch(hit.fullName)}
                    className={"qw-hit" + (i === sel ? " qw-hit-on" : "")}
                    disabled={watched}
                  >
                    <span className="q-mono min-w-0 truncate text-[13px]">
                      {hit.fullName}
                    </span>
                    {hit.description && (
                      <span className="qw-hit-desc">{hit.description}</span>
                    )}
                    {watched && (
                      <Check
                        size={13}
                        aria-label="Already watching"
                        className="ml-auto shrink-0 text-success"
                      />
                    )}
                  </button>
                );
              })}
              {!searching && hits.length === 0 && (
                <p className="px-2 py-2 text-xs text-faint">
                  {input.includes("/")
                    ? `No matches — Enter watches “${input.trim()}” as typed.`
                    : "No matches."}
                </p>
              )}
            </div>
          )}

          <div
            ref={listRef}
            className="mt-3 flex max-h-56 flex-col gap-1 overflow-y-auto"
          >
            {repos.length === 0 ? (
              <p className="py-4 text-center text-xs text-faint">
                Nothing watched yet. Search above to add a repository.
              </p>
            ) : (
              repos.map((r, i) => (
                <div
                  key={r}
                  data-armed={armed === i}
                  className={"qw-row" + (armed === i ? " qw-row-armed" : "")}
                >
                  <span className="q-mono min-w-0 truncate text-[13px]">{r}</span>
                  <button
                    type="button"
                    tabIndex={-1}
                    className="qb-x"
                    onClick={() => stopWatching(r)}
                    aria-label={`Stop watching ${r}`}
                  >
                    <X size={13} aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3">
          <span className="text-xs text-faint">
            <Kbd combo="up" />
            <Kbd combo="down" /> pick · <Kbd combo="enter" />{" "}
            {armed === "done"
              ? "close"
              : typeof armed === "number"
                ? "stop watching"
                : "watch"}{" "}
            · <Kbd combo="tab" /> actions · <Kbd combo="esc" /> done
          </span>
          <button
            type="button"
            tabIndex={-1}
            data-armed={armed === "done"}
            onClick={onClose}
            className={
              "q-btn q-btn-quiet" + (armed === "done" ? " qw-done-armed" : "")
            }
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
