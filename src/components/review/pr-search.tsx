import { CornerDownLeft, FileCode, Search } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { useModalDialog } from "../../hooks/use-modal-dialog.ts";
import { cn } from "../../lib/cn.ts";
import { type DiffRow, parsePatch } from "../../lib/diff.ts";
import { fuzzyMatch } from "../../lib/fuzzy.ts";
import { highlightLineWithMatch } from "../../lib/highlight.ts";
import type { ChangedFile } from "../../types.ts";
import { HighlightIndices } from "../ui/highlight.tsx";
import { Kbd } from "../ui/kbd.tsx";

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

function rowAnchor(row: DiffRow): string | null {
  if (row.type === "del") {
    return row.oldLine === null ? null : `LEFT:${row.oldLine}`;
  }
  return row.newLine === null ? null : `RIGHT:${row.newLine}`;
}

function itemKey(it: Item, index: number): string {
  if (it.kind === "file") {
    return `file-${it.fileIndex}-${it.filename}`;
  }
  return `line-${it.fileIndex}-${it.anchor ?? "none"}-${it.line ?? index}`;
}

function buildFileItems(q: string, files: ChangedFile[]): Item[] {
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

function snippetContext(rows: DiffRow[], ri: number): SnippetLine[] {
  const context: SnippetLine[] = [];
  const start = Math.max(0, ri - SNIPPET_RADIUS);
  const end = Math.min(rows.length - 1, ri + SNIPPET_RADIUS);
  for (let ci = start; ci <= end; ci += 1) {
    const r = rows[ci];
    context.push({
      hit: ci === ri,
      num: r.newLine ?? r.oldLine,
      text: r.content,
    });
  }
  return context;
}

function pushTextMatch(
  out: Item[],
  row: DiffRow,
  ri: number,
  rows: DiffRow[],
  fileIndex: number,
  filename: string,
  q: string
): boolean {
  if (!row.content.toLowerCase().includes(q)) {
    return false;
  }
  out.push({
    anchor: rowAnchor(row),
    content: row.content.trim(),
    context: snippetContext(rows, ri),
    fileIndex,
    filename,
    kind: "line",
    line: row.newLine ?? row.oldLine,
  });
  return out.length >= MAX_LINES;
}

function buildTextItems(q: string, files: ChangedFile[]): Item[] {
  if (!q) {
    return [];
  }
  const out: Item[] = [];
  for (let i = 0; i < files.length && out.length < MAX_LINES; i += 1) {
    const f = files[i];
    if (!f.patch) {
      continue;
    }
    for (const hunk of parsePatch(f.patch)) {
      const rows = hunk.rows.filter((r) => r.type !== "hunk");
      for (let ri = 0; ri < rows.length; ri += 1) {
        if (pushTextMatch(out, rows[ri], ri, rows, i, f.filename, q)) {
          return out;
        }
      }
    }
  }
  return out;
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
  if (!open) {
    return null;
  }
  return (
    <PrSearchContent
      files={files}
      key={mode}
      mode={mode}
      onClose={onClose}
      onSelectFile={onSelectFile}
      onSelectLine={onSelectLine}
    />
  );
}

function PrSearchContent({
  mode,
  onClose,
  files,
  onSelectFile,
  onSelectLine,
}: {
  mode: Mode;
  onClose: () => void;
  files: ChangedFile[];
  onSelectFile: (index: number) => void;
  onSelectLine: (index: number, anchor: string) => void;
}) {
  const listId = useId();
  const { dialogRef, onDialogCancel, onDialogClose } = useModalDialog(onClose);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();
  const items: Item[] =
    mode === "files" ? buildFileItems(q, files) : buildTextItems(q, files);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${sel}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const choose = (it: Item) => {
    if (it.kind === "line" && it.anchor !== null) {
      onSelectLine(it.fileIndex, it.anchor);
    } else {
      onSelectFile(it.fileIndex);
    }
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
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
  };

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSel(0);
  };

  const handleRowClick = (e: MouseEvent<HTMLButtonElement>) => {
    const index = Number(e.currentTarget.dataset.index);
    const it = items[index];
    if (it) {
      choose(it);
    }
  };

  const handleRowMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    const index = Number(e.currentTarget.dataset.index);
    setSel(index);
  };

  const handleRowKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleRowClick(e as unknown as MouseEvent<HTMLButtonElement>);
    }
  };

  const displayQ = query.trim();
  const empty = displayQ.length > 0 && items.length === 0;
  const placeholder =
    mode === "files" ? "Find a file in this PR…" : "Search code in this PR…";

  return (
    <dialog
      aria-label={mode === "files" ? "Find a file" : "Search code"}
      className="q-dialog q-dialog-top qsp-panel"
      onCancel={onDialogCancel}
      onClose={onDialogClose}
      ref={dialogRef}
    >
      <div className="qsp-search">
        <Search aria-hidden className="qsp-search-icon" size={17} />
        <input
          aria-controls={listId}
          aria-expanded
          aria-label={placeholder}
          autoComplete="off"
          className="qsp-input"
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          value={query}
        />
        <Kbd combo="esc" />
      </div>

      <div className="qsp-list" id={listId} ref={listRef} role="listbox">
        {mode === "text" && !displayQ && (
          <div className="qsp-empty">
            <Search aria-hidden size={20} />
            <p>Search the diff text</p>
            <span>Type to match lines across every changed file.</span>
          </div>
        )}
        {items.map((it, i) => (
          <button
            aria-selected={i === sel}
            className={cn("qsp-row", i === sel && "qsp-row-on")}
            data-active={i === sel}
            data-index={i}
            key={itemKey(it, i)}
            onClick={handleRowClick}
            onKeyDown={handleRowKeyDown}
            onMouseMove={handleRowMouseMove}
            role="option"
            type="button"
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
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: syntax-highlighted diff snippet
                        dangerouslySetInnerHTML={{
                          __html: highlightLineWithMatch(
                            it.content,
                            it.filename,
                            displayQ
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
                      {it.context.map((l) => (
                        <span
                          className={cn(
                            "qsp-snip-line",
                            l.hit && "qsp-snip-line-hit"
                          )}
                          key={`${l.num ?? "x"}-${l.text}`}
                        >
                          <span className="qsp-snip-num">{l.num ?? ""}</span>
                          <span
                            className="qsp-snip-code hljs"
                            // biome-ignore lint/security/noDangerouslySetInnerHtml: syntax-highlighted diff snippet
                            dangerouslySetInnerHTML={{
                              __html: l.text
                                ? highlightLineWithMatch(
                                    l.text,
                                    it.filename,
                                    l.hit ? displayQ : ""
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
          </button>
        ))}
        {!!empty && (
          <div className="qsp-empty">
            <Search aria-hidden size={20} />
            <p>Nothing matches “{displayQ}”.</p>
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
    </dialog>
  );
}
