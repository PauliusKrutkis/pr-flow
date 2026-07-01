import { useEffect, useMemo, useRef, useState } from "react";
import { Search, FileCode, CornerDownLeft } from "lucide-react";
import type { ChangedFile } from "../../types";
import { parsePatch } from "../../lib/diff";
import { Kbd } from "../ui/Kbd";

type Mode = "files" | "text";

interface FileItem {
  kind: "file";
  fileIndex: number;
  filename: string;
}
interface LineItem {
  kind: "line";
  fileIndex: number;
  filename: string;
  line: number | null;
  content: string;
}
type Item = FileItem | LineItem;

const MAX_LINES = 60;

function base(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/** Subsequence fuzzy match: every char of `q` appears in order within `text`. */
function fuzzy(q: string, text: string): boolean {
  if (!q) return true;
  let i = 0;
  for (let j = 0; j < text.length && i < q.length; j++) {
    if (text[j] === q[i]) i++;
  }
  return i === q.length;
}

/**
 * In-PR search. Two modes over the current pull request, in the same pane shape
 * as the global "/" search: `files` (Ctrl/⌘-T) fuzzy-matches changed file paths;
 * `text` (Ctrl/⌘-F) searches the diff text. Selecting a result opens its file.
 */
export function PrSearch({
  open,
  mode,
  onClose,
  files,
  onSelectFile,
}: {
  open: boolean;
  mode: Mode;
  onClose: () => void;
  files: ChangedFile[];
  onSelectFile: (index: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();

    if (mode === "files") {
      return files
        .map((f, i) => ({ f, i }))
        .filter(({ f }) => fuzzy(q, f.filename.toLowerCase()))
        .map(({ f, i }) => ({
          kind: "file" as const,
          fileIndex: i,
          filename: f.filename,
        }));
    }

    // text mode
    if (!q) return [];
    const out: Item[] = [];
    for (let i = 0; i < files.length && out.length < MAX_LINES; i++) {
      const f = files[i];
      if (!f.patch) continue;
      for (const hunk of parsePatch(f.patch)) {
        for (const row of hunk.rows) {
          if (row.type === "hunk") continue;
          if (row.content.toLowerCase().includes(q)) {
            out.push({
              kind: "line",
              fileIndex: i,
              filename: f.filename,
              line: row.newLine ?? row.oldLine,
              content: row.content.trim(),
            });
            if (out.length >= MAX_LINES) break;
          }
        }
        if (out.length >= MAX_LINES) break;
      }
    }
    return out;
  }, [query, files, mode]);

  useEffect(() => setSel(0), [query, mode]);
  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, mode]);
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const empty = query.trim().length > 0 && items.length === 0;
  const placeholder =
    mode === "files" ? "Find a file in this PR…" : "Search code in this PR…";

  const choose = (it: Item) => {
    onSelectFile(it.fileIndex);
    onClose();
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[sel];
      if (it) choose(it);
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
        className="q-dialog q-dialog-top qsp-panel"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "files" ? "Find a file" : "Search code"}
      >
        <div className="qsp-search">
          <Search size={17} className="qsp-search-icon" aria-hidden />
          <input
            ref={inputRef}
            className="qsp-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            autoComplete="off"
            spellCheck={false}
          />
          <Kbd combo="esc" />
        </div>

        <div className="qsp-list" role="listbox" ref={listRef}>
          {mode === "text" && !query.trim() && (
            <div className="qsp-empty">
              <Search size={20} aria-hidden />
              <p>Search the diff text</p>
              <span>Type to match lines across every changed file.</span>
            </div>
          )}
          {items.map((it, i) => (
            <div
              key={`${it.kind}-${it.fileIndex}-${i}`}
              role="option"
              aria-selected={i === sel}
              data-active={i === sel}
              className={"qsp-row" + (i === sel ? " qsp-row-on" : "")}
              onMouseMove={() => setSel(i)}
              onClick={() => choose(it)}
            >
              <span className="qsp-rail" aria-hidden />
              {it.kind === "file" ? (
                <>
                  <FileCode size={14} className="qsp-search-icon" aria-hidden />
                  <span className="qsp-main">
                    <span className="qsp-title">
                      <span>{it.filename}</span>
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="qsp-num">L{it.line ?? "?"}</span>
                  <span className="qsp-main">
                    <span className="qsp-title q-mono">
                      <span>{it.content || " "}</span>
                    </span>
                    <span className="qsp-meta">{base(it.filename)}</span>
                  </span>
                </>
              )}
            </div>
          ))}
          {empty && (
            <div className="qsp-empty">
              <Search size={20} aria-hidden />
              <p>Nothing matches “{query.trim()}”.</p>
              <span>
                {mode === "files" ? "Try part of a file name." : "Try other code text."}
              </span>
            </div>
          )}
        </div>

        <div className="qsp-foot">
          <span>
            <Kbd combo="up" />
            <Kbd combo="down" /> navigate
          </span>
          <span>
            <CornerDownLeft size={11} aria-hidden /> open file
          </span>
          <span className="qsp-foot-scope">
            {mode === "files" ? "files in this PR" : "code in this PR"}
          </span>
        </div>
      </div>
    </div>
  );
}
