// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { Search } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useModalDialog } from "../hooks/use-modal-dialog.ts";
import { useKeyboard } from "../keyboard/keyboard-provider.tsx";
import { useHotkeys } from "../keyboard/use-hotkeys.ts";
import { cn } from "../lib/cn.ts";
import { fuzzyMatch } from "../lib/fuzzy.ts";
import { useAppStore } from "../store/app-store.ts";
import { HighlightIndices } from "./ui/highlight.tsx";
import { Kbd } from "./ui/kbd.tsx";

interface Entry {
  group?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  keyCombo?: string;
  label: string;
  run: () => void;
}

function firstKey(keys: string | string[]): string | undefined {
  return Array.isArray(keys) ? keys[0] : keys;
}

function entryKey(entry: Entry): string {
  return `${entry.label}\0${entry.keyCombo ?? ""}\0${entry.group ?? ""}`;
}

function buildCommandEntries(
  baseScope: string,
  getBindings: ReturnType<typeof useKeyboard>["getBindings"],
  closePalette: () => void,
  _bindingsVersion: number
): Entry[] {
  const out: Entry[] = [];
  for (const b of getBindings(baseScope)) {
    if (b.hidden) {
      continue;
    }
    out.push({
      group: b.group,
      icon: b.icon,
      keyCombo: firstKey(b.keys),
      label: b.description,
      run: () => {
        b.run(new KeyboardEvent("keydown"));
        closePalette();
      },
    });
  }
  return out;
}

/**
 * Command palette (⌘K) — runs the actions available in the current scope. PR
 * navigation lives in the global "/" search now, so this stays a focused action
 * list. The selected row wears the same iris left-rail as the inbox cursor.
 */
export function CommandPalette({ baseScope }: { baseScope: string }) {
  const paletteOpen = useAppStore((s) => s.paletteOpen);
  if (!paletteOpen) {
    return null;
  }
  return <CommandPaletteContent baseScope={baseScope} />;
}

function CommandPaletteContent({ baseScope }: { baseScope: string }) {
  const closePalette = useAppStore((s) => s.closePalette);
  const { getBindings, version: bindingsVersion } = useKeyboard();
  const listId = useId();
  const { dialogRef, onDialogCancel, onDialogClose } =
    useModalDialog(closePalette);

  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const commandEntries = buildCommandEntries(
    baseScope,
    getBindings,
    closePalette,
    bindingsVersion
  );

  const q = query.trim();
  const entries = q
    ? commandEntries
        .flatMap((e) => {
          const m = fuzzyMatch(q, e.label);
          return m ? [{ ...e, matched: m.indices, score: m.score }] : [];
        })
        .sort((a, b) => b.score - a.score)
    : commandEntries.map((e) => ({ ...e, matched: [] as number[] }));

  const activeIndex =
    entries.length === 0 ? 0 : Math.min(index, entries.length - 1);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, []);

  useHotkeys(
    "palette",
    [
      {
        description: "Close palette",
        hidden: true,
        keys: "esc",
        run: () => closePalette(),
      },
    ],
    { enabled: true }
  );

  const runAt = (i: number) => {
    entries[i]?.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => (entries.length ? (i + 1) % entries.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) =>
        entries.length ? (i - 1 + entries.length) % entries.length : 0
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      runAt(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closePalette();
    }
  };

  const onQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setIndex(0);
  };

  const onOptionClick = (e: MouseEvent<HTMLButtonElement>) => {
    const i = Number(e.currentTarget.dataset.index);
    runAt(i);
  };

  const onOptionMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    setIndex(Number(e.currentTarget.dataset.index));
  };

  return (
    <dialog
      aria-label="Command palette"
      className="q-dialog q-dialog-top qc-panel"
      onCancel={onDialogCancel}
      onClose={onDialogClose}
      ref={dialogRef}
    >
      <div className="qc-search">
        <Search aria-hidden className="qc-search-icon" size={16} />
        <input
          aria-controls={listId}
          aria-expanded
          aria-label="Search commands"
          autoComplete="off"
          className="qc-input"
          onChange={onQueryChange}
          onKeyDown={onKeyDown}
          placeholder="Run a command…"
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          value={query}
        />
        <Kbd combo="esc" />
      </div>

      <div className="qc-list" id={listId} ref={listRef} role="listbox">
        {entries.length === 0 ? (
          <div className="qc-empty">No commands match “{q}”.</div>
        ) : (
          <fieldset aria-label="Commands" className="qc-group">
            <legend className="qc-group-label">Commands</legend>
            {entries.map((entry, i) => {
              const Icon = entry.icon;
              return (
                <button
                  className={cn(
                    "qc-opt q-focus",
                    i === activeIndex && "qc-opt-on"
                  )}
                  data-active={i === activeIndex}
                  data-index={i}
                  key={entryKey(entry)}
                  onClick={onOptionClick}
                  onMouseMove={onOptionMouseMove}
                  type="button"
                >
                  <span aria-hidden className="qc-rail" />
                  <span aria-hidden className="qc-opt-icon">
                    {Icon ? <Icon size={14} /> : null}
                  </span>
                  <span className="qc-opt-label">
                    <HighlightIndices
                      indices={entry.matched}
                      text={entry.label}
                    />
                  </span>
                  {entry.group ? (
                    <span className="qc-opt-sub">{entry.group}</span>
                  ) : null}
                  {entry.keyCombo ? <Kbd combo={entry.keyCombo} /> : null}
                </button>
              );
            })}
          </fieldset>
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
    </dialog>
  );
}
