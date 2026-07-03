import { useEffect, useRef, useState } from "react";
import { Eye, Plus, X } from "lucide-react";
import { api } from "../../lib/api";
import { queryClient, queryKeys } from "../../lib/queryClient";
import { useWatchedRepos } from "../../hooks/useSubscribed";
import { useHotkeys } from "../../keyboard";
import { Kbd } from "../ui/Kbd";

/**
 * Manage the watched repositories behind the "Watching" tab. Add by
 * `owner/name`, remove with ×. Saves optimistically and refreshes the tab.
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
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setRepos(data ?? []);
      setInput("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, data]);

  useHotkeys(
    "watch-repos",
    [{ keys: "esc", description: "Close", hidden: true, run: () => onClose() }],
    { enabled: open },
  );

  if (!open) return null;

  function persist(next: string[]) {
    setRepos(next);
    // Optimistic per design principle — write-through, then refresh the tab.
    void api
      .setWatchedRepos(next)
      .then(() => {
        queryClient.setQueryData(queryKeys.watchedRepos, next);
        void queryClient.invalidateQueries({ queryKey: queryKeys.subscribed });
      })
      .catch(() => {});
  }

  function add() {
    const cleaned = input.trim().replace(/^https?:\/\/[^/]+\//, "").replace(/\/+$/, "");
    if (!cleaned || !cleaned.includes("/")) return;
    if (!repos.includes(cleaned)) persist([...repos, cleaned]);
    setInput("");
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
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onClose();
                }
              }}
              placeholder="owner/repo  (or paste a repo URL)"
              spellCheck={false}
              autoComplete="off"
              className="q-input font-mono"
            />
            <button
              type="button"
              onClick={add}
              disabled={!input.trim().includes("/") && !input.includes("://")}
              className="q-btn q-btn-quiet shrink-0"
            >
              <Plus size={13} aria-hidden /> Watch
            </button>
          </div>

          <div className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
            {repos.length === 0 ? (
              <p className="py-4 text-center text-xs text-faint">
                Nothing watched yet. Add a repository above.
              </p>
            ) : (
              repos.map((r) => (
                <div key={r} className="qw-row">
                  <span className="q-mono min-w-0 truncate text-[13px]">{r}</span>
                  <button
                    type="button"
                    className="qb-x"
                    onClick={() => persist(repos.filter((x) => x !== r))}
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
            <Kbd combo="enter" /> add · <Kbd combo="esc" /> done
          </span>
          <button type="button" onClick={onClose} className="q-btn q-btn-quiet">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
