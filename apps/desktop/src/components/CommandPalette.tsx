import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useKeyboard, useHotkeys } from "../keyboard";
import { useAppStore } from "../store/appStore";
import { cn } from "../lib/cn";
import { fuzzyMatch } from "../lib/fuzzy";
import { HighlightIndices } from "./ui/Highlight";
import { Kbd } from "./ui/Kbd";

interface Entry {
  label: string;
  group?: string;
  keyCombo?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  run: () => void;
}

function firstKey(keys: string | string[]): string | undefined {
  return Array.isArray(keys) ? keys[0] : keys;
}

/**
 * Command palette (⌘K) — runs the actions available in the current scope. PR
 * navigation lives in the global "/" search now, so this stays a focused action
 * list. The selected row wears the same iris left-rail as the inbox cursor.
 */
export function CommandPalette({ baseScope }: { baseScope: string }) {
  const paletteOpen = useAppStore((s) => s.paletteOpen);
  const closePalette = useAppStore((s) => s.closePalette);
  const { getBindings, version } = useKeyboard();

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (paletteOpen) {
      setQuery("");
      setIndex(0);
    }
  }, [paletteOpen]);

  const commandEntries = useMemo<Entry[]>(() => {
    if (!paletteOpen) return [];
    void version;
    return getBindings(baseScope)
      .filter((b) => !b.hidden)
      .map((b) => ({
        label: b.description,
        group: b.group,
        keyCombo: firstKey(b.keys),
        icon: b.icon,
        run: () => {
          b.run(new KeyboardEvent("keydown"));
          closePalette();
        },
      }));
  }, [paletteOpen, baseScope, getBindings, version, closePalette]);

  const entries = useMemo(() => {
    const q = query.trim();
    if (!q) return commandEntries.map((e) => ({ ...e, matched: [] as number[] }));
    return commandEntries
      .flatMap((e) => {
        const m = fuzzyMatch(q, e.label);
        return m ? [{ ...e, matched: m.indices, score: m.score }] : [];
      })
      .sort((a, b) => b.score - a.score);
  }, [commandEntries, query]);

  useEffect(() => {
    setIndex((i) => (entries.length === 0 ? 0 : Math.min(i, entries.length - 1)));
  }, [entries.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [index]);

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
    entries[i]?.run();
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
      className="q-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closePalette();
      }}
    >
      <div className="q-dialog q-dialog-top qc-panel" role="dialog" aria-modal="true">
        <div className="qc-search">
          <Search size={16} className="qc-search-icon" aria-hidden />
          <input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Run a command…"
            spellCheck={false}
            autoComplete="off"
            className="qc-input"
            role="combobox"
            aria-expanded
          />
          <Kbd combo="esc" />
        </div>

        <div className="qc-list" role="listbox" ref={listRef}>
          {entries.length === 0 ? (
            <div className="qc-empty">No commands match “{query.trim()}”.</div>
          ) : (
            <div className="qc-group" role="group" aria-label="Commands">
              <div className="qc-group-label">Commands</div>
              {entries.map((entry, i) => (
                <button
                  type="button"
                  key={`${i}-${entry.label}`}
                  data-active={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => runAt(i)}
                  className={cn("qc-opt q-focus", i === index && "qc-opt-on")}
                >
                  <span className="qc-rail" aria-hidden />
                  <span className="qc-opt-icon" aria-hidden>
                    {entry.icon && <entry.icon size={14} />}
                  </span>
                  <span className="qc-opt-label">
                    <HighlightIndices text={entry.label} indices={entry.matched} />
                  </span>
                  {entry.group && <span className="qc-opt-sub">{entry.group}</span>}
                  {entry.keyCombo && <Kbd combo={entry.keyCombo} />}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="qc-foot">
          <span>
            <Kbd combo="up" />
            <Kbd combo="down" /> navigate
          </span>
          <span>
            <Kbd combo="enter" /> run
          </span>
          <span>
            <Kbd combo="esc" /> close
          </span>
        </div>
      </div>
    </div>
  );
}
