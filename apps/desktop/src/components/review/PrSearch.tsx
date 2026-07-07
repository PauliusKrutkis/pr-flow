import { CornerDownLeft, FileCode, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { parsePatch } from "../../lib/diff.ts";
import { fuzzyMatch } from "../../lib/fuzzy.ts";
import { highlightLineWithMatch } from "../../lib/highlight.ts";
import type { ChangedFile } from "../../types.ts";
import { HighlightIndices } from "../ui/Highlight.tsx";
import { Kbd } from "../ui/Kbd.tsx";

type Mode = "files" | "text";

interface FileItem {
  fileIndex: number;
  filename: string;
  kind: "file";
  matched: number[];
}
interface SnippetLine {
  hit: boolean;
  num: number | null;
  text: string;
}
interface LineItem {
  anchor: string | null;
  content: string;
  context: SnippetLine[];
  fileIndex: number;
  filename: string;
  kind: "line";
  line: number | null;
}
type Item = FileItem | LineItem;

const MAX_LINES = 60;
const SNIPPET_RADIUS = 2;

function base(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

/**
 * In-PR search. Two modes over the current pull request, in the same pane shape
 * as the global "/" search: `files` (Ctrl/⌘-T) fuzzy-matches changed file paths;
 * `text` (Ctrl/⌘-F) searches the diff text. Matches are highlighted; the
 * selected text result expands into a small context snippet, and choosing it
 * lands the diff on that exact line.
 */
export function PrSearch({
  open,
  mode,
  onClose,
  files,
  onSelectFile,
  onSelectLine,
}: {
  open: boolean;
  mode: Mode;
  onClose: () => void;
  files: ChangedFile[];
  onSelectFile: (index: number) => void;
  onSelectLine: (index: number, anchor: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<Item[]>(() => {
    const q = query.trim().toLowerCase();

    if (mode === "files") {
      const out: (FileItem & { score: number })[] = [];
      files.forEach((f, i) => {
        const m = fuzzyMatch(q, f.filename);
        if (m !== null) {
          out.push({
            fileIndex: i,
            filename: f.filename,
            kind: "file",
            matched: m.indices,
            score: m.score,
          });
        }
      });
      out.sort((a, b) => b.score - a.score);
      return out;
    }

    if (!q) {
      return [];
    }
    const out: Item[] = [];
    for (let i = 0; i < files.length && out.length < MAX_LINES; i++) {
      const f = files[i];
      if (!f.patch) {
        continue;
      }
      for (const hunk of parsePatch(f.patch)) {
        const rows = hunk.rows.filter((r) => r.type !== "hunk");
        for (let ri = 0; ri < rows.length; ri++) {
          const row = rows[ri];
          if (!row.content.toLowerCase().includes(q)) {
            continue;
          }
          const context: SnippetLine[] = [];
          for (
            let ci = Math.max(0, ri - SNIPPET_RADIUS);
            ci <= Math.min(rows.length - 1, ri + SNIPPET_RADIUS);
            ci++
          ) {
            const r = rows[ci];
            context.push({
              hit: ci === ri,
              num: r.newLine ?? r.oldLine,
              text: r.content,
            });
          }
          const anchor =
            row.type === "del"
              ? row.oldLine == null
                ? null
                : `LEFT:${row.oldLine}`
              : row.newLine == null
                ? null
                : `RIGHT:${row.newLine}`;
          out.push({
            anchor,
            content: row.content.trim(),
            context,
            fileIndex: i,
            filename: f.filename,
            kind: "line",
            line: row.newLine ?? row.oldLine,
          });
          if (out.length >= MAX_LINES) {
            break;
          }
        }
        if (out.length >= MAX_LINES) {
          break;
        }
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

  if (!open) {
    return null;
  }

  const q = query.trim();
  const empty = q.length > 0 && items.length === 0;
  const placeholder =
    mode === "files" ? "Find a file in this PR…" : "Search code in this PR…";

  const choose = (it: Item) => {
    if (it.kind === "line" && it.anchor != null) {
      onSelectLine(it.fileIndex, it.anchor);
    } else {
      onSelectFile(it.fileIndex);
    }
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
      if (it) {
        choose(it);
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
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        aria-label={mode === "files" ? "Find a file" : "Search code"}
        aria-modal="true"
        className="q-dialog q-dialog-top qsp-panel"
        role="dialog"
      >
        <div className="qsp-search">
          <Search aria-hidden className="qsp-search-icon" size={17} />
          <input
            aria-expanded
            autoComplete="off"
            className="qsp-input"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            value={query}
          />
          <Kbd combo="esc" />
        </div>

        <div className="qsp-list" ref={listRef} role="listbox">
          {mode === "text" && !q && (
            <div className="qsp-empty">
              <Search aria-hidden size={20} />
              <p>Search the diff text</p>
              <span>Type to match lines across every changed file.</span>
            </div>
          )}
          {items.map((it, i) => (
            <div
              aria-selected={i === sel}
              className={cn("qsp-row", i === sel && "qsp-row-on")}
              data-active={i === sel}
              key={`${it.kind}-${it.fileIndex}-${i}`}
              onClick={() => choose(it)}
              onMouseMove={() => setSel(i)}
              role="option"
            >
              <span aria-hidden className="qsp-rail" />
              {it.kind === "file" ? (
                <>
                  <FileCode aria-hidden className="qsp-search-icon" size={14} />
                  <span className="qsp-main">
                    <span className="qsp-title">
                      <span>
                        <HighlightIndices
                          indices={it.matched}
                          text={it.filename}
                        />
                      </span>
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="qsp-num">L{it.line ?? "?"}</span>
                  <span className="qsp-main">
                    <span className="qsp-title q-mono">
                      {it.content ? (
                        <span
                          className="hljs"
                          dangerouslySetInnerHTML={{
                            __html: highlightLineWithMatch(
                              it.content,
                              it.filename,
                              q
                            ),
                          }}
                        />
                      ) : (
                        <span> </span>
                      )}
                    </span>
                    <span className="qsp-meta">{base(it.filename)}</span>
                    {i === sel && it.context.length > 1 && (
                      <span aria-hidden className="qsp-snippet">
                        {it.context.map((l, j) => (
                          <span
                            className={cn(
                              "qsp-snip-line",
                              l.hit && "qsp-snip-line-hit"
                            )}
                            key={j}
                          >
                            <span className="qsp-snip-num">{l.num ?? ""}</span>
                            <span
                              className="qsp-snip-code hljs"
                              dangerouslySetInnerHTML={{
                                __html: l.text
                                  ? highlightLineWithMatch(
                                      l.text,
                                      it.filename,
                                      l.hit ? q : ""
                                    )
                                  : " ",
                              }}
                            />
                          </span>
                        ))}
                      </span>
                    )}
                  </span>
                </>
              )}
            </div>
          ))}
          {empty && (
            <div className="qsp-empty">
              <Search aria-hidden size={20} />
              <p>Nothing matches “{q}”.</p>
              <span>
                {mode === "files"
                  ? "Try part of a file name."
                  : "Try other code text."}
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
            <CornerDownLeft aria-hidden size={11} />{" "}
            {mode === "files" ? "open file" : "go to line"}
          </span>
          <span className="qsp-foot-scope">
            {mode === "files" ? "files in this PR" : "code in this PR"}
          </span>
        </div>
      </div>
    </div>
  );
}
