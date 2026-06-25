import { useEffect, useMemo, useRef, useState } from "react";
import { useKeyboard, useHotkeys } from "../keyboard";
import { useAppStore } from "../store/appStore";
import { queryClient, queryKeys } from "../lib/queryClient";
import { prKey, type InboxData, type PullRequest } from "../types";
import { cn } from "../lib/cn";
import { Kbd } from "./ui/Kbd";

type Entry =
  | {
      kind: "command";
      label: string;
      sublabel?: string;
      keyCombo?: string;
      run: () => void;
    }
  | {
      kind: "pr";
      label: string;
      sublabel?: string;
      run: () => void;
    };

function firstKey(keys: string | string[]): string | undefined {
  return Array.isArray(keys) ? keys[0] : keys;
}

export function CommandPalette({ baseScope }: { baseScope: string }) {
  const paletteOpen = useAppStore((s) => s.paletteOpen);
  const closePalette = useAppStore((s) => s.closePalette);
  const { getBindings, version } = useKeyboard();

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query + index each time the palette opens, and focus the input.
  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setIndex(0);
    }
  }, [paletteOpen]);

  const commandEntries = useMemo<Entry[]>(() => {
    if (!paletteOpen) return [];
    // `version` is read so this recomputes as binding sources change.
    void version;
    return getBindings(baseScope)
      .filter((b) => !b.hidden)
      .map((b) => ({
        kind: "command" as const,
        label: b.description,
        sublabel: b.group,
        keyCombo: firstKey(b.keys),
        run: () => {
          b.run(new KeyboardEvent("keydown"));
          closePalette();
        },
      }));
  }, [paletteOpen, baseScope, getBindings, version, closePalette]);

  const prEntries = useMemo<Entry[]>(() => {
    if (!paletteOpen) return [];
    // Flatten unique PRs across all inbox tabs from the query cache.
    const inbox = queryClient.getQueryData<InboxData>(queryKeys.inbox);
    const seen = new Set<number>();
    const prs: PullRequest[] = [];
    if (inbox) {
      for (const key of [
        "reviewRequested",
        "assigned",
        "created",
        "involved",
      ] as const) {
        for (const pr of inbox[key].prs) {
          if (!seen.has(pr.id)) {
            seen.add(pr.id);
            prs.push(pr);
          }
        }
      }
    }
    return prs.map((pr) => ({
      kind: "pr" as const,
      label: pr.title,
      sublabel: `${pr.repo} #${pr.number}`,
      run: () => {
        const store = useAppStore.getState();
        store.openReview(pr.owner, pr.name, pr.number);
        store.markSeen(
          prKey({ owner: pr.owner, name: pr.name, number: pr.number }),
          pr.updatedAt,
        );
        closePalette();
      },
    }));
  }, [paletteOpen, closePalette]);

  const entries = useMemo(() => {
    const all = [...commandEntries, ...prEntries];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((e) => e.label.toLowerCase().includes(q));
  }, [commandEntries, prEntries, query]);

  // Keep the highlighted index within bounds as the list changes.
  useEffect(() => {
    setIndex((i) => {
      if (entries.length === 0) return 0;
      return Math.min(i, entries.length - 1);
    });
  }, [entries.length]);

  // While open, make "palette" the active scope so the inbox/review single-key
  // shortcuts beneath the modal don't fire (e.g. if focus leaves the input).
  useHotkeys(
    "palette",
    [
      {
        keys: "esc",
        description: "Close palette",
        hidden: true,
        run: () => closePalette(),
      },
    ],
    { enabled: paletteOpen },
  );

  if (!paletteOpen) return null;

  function runAt(i: number) {
    const entry = entries[i];
    if (entry) entry.run();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (entries.length ? (i + 1) % entries.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) =>
        entries.length ? (i - 1 + entries.length) % entries.length : 0,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(index);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-card border border-line bg-surface shadow-2xl">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Type a command or jump to a PR…"
          spellCheck={false}
          autoComplete="off"
          className="w-full border-b border-line bg-transparent px-4 py-3 text-sm text-fg outline-none placeholder:text-faint"
        />
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {entries.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-muted">
              No results
            </div>
          ) : (
            entries.map((entry, i) => (
              <button
                type="button"
                key={`${entry.kind}-${i}-${entry.label}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => runAt(i)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2 text-left",
                  i === index ? "bg-surface-2" : "bg-transparent",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">
                    {entry.label}
                  </span>
                  {entry.sublabel ? (
                    <span className="block truncate text-xs text-muted">
                      {entry.sublabel}
                    </span>
                  ) : null}
                </span>
                {entry.kind === "command" && entry.keyCombo ? (
                  <Kbd combo={entry.keyCombo} />
                ) : (
                  <span className="text-xs text-faint">Jump</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
