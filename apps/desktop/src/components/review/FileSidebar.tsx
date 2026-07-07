import { useEffect, useMemo, useRef } from "react";
import { Check } from "lucide-react";
import type {
  ChangedFile,
  FileStatus,
  PendingComment,
  ReviewComment,
} from "../../types";
import { useAppStore } from "../../store/appStore";
import { cn } from "../../lib/cn";

interface FileSidebarProps {
  files: ChangedFile[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  prKeyValue: string;
  comments: ReviewComment[];
  pending: PendingComment[];
  changed: Set<string>;
}

interface Glyph {
  letter: string;
  cls: string;
  title: string;
}

function glyphFor(status: FileStatus): Glyph {
  switch (status) {
    case "added":
      return { letter: "A", cls: "qf-st-add", title: "Added" };
    case "removed":
      return { letter: "D", cls: "qf-st-del", title: "Removed" };
    case "renamed":
      return { letter: "R", cls: "qf-st-ren", title: "Renamed" };
    case "copied":
      return { letter: "C", cls: "qf-st-ren", title: "Copied" };
    default:
      return { letter: "M", cls: "qf-st-mod", title: "Modified" };
  }
}

/** Split a path into a trailing-slashed dir and its basename. */
function splitPath(filename: string): { dir: string; base: string } {
  const idx = filename.lastIndexOf("/");
  if (idx === -1) return { dir: "", base: filename };
  return { dir: filename.slice(0, idx + 1), base: filename.slice(idx + 1) };
}

/**
 * The Quiet review sidebar: a calm flat file list. Progress reads through the
 * viewed ticks and the header count; directory grouping is intentionally
 * dropped in favor of the flat list.
 */
export function FileSidebar({
  files,
  selectedIndex,
  onSelect,
  prKeyValue,
  comments,
  pending,
  changed,
}: FileSidebarProps) {

  const viewedFiles = useAppStore((s) => s.viewed[prKeyValue]);
  const viewedSet = useMemo(
    () => new Set(Object.keys(viewedFiles ?? {})),
    [viewedFiles],
  );

  const listRef = useRef<HTMLDivElement>(null);

  const threadCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comments) {
      if (c.inReplyToId != null) continue; // roots only
      m.set(c.path, (m.get(c.path) ?? 0) + 1);
    }
    return m;
  }, [comments]);
  const pendingCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pending) m.set(p.path, (m.get(p.path) ?? 0) + 1);
    return m;
  }, [pending]);

  const indexed = useMemo(
    () => files.map((file, index) => ({ file, index })),
    [files],
  );

  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(
      `[data-file-index="${selectedIndex}"]`,
    );
    if (!list || !el) return;
    const listRect = list.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const pad = 8;
    if (elRect.top < listRect.top + pad || elRect.bottom > listRect.bottom - pad) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <div className="qf-sidebar flex h-full flex-col">
      <div className="qf-side-head flex items-center justify-between px-4 py-3">
        <span className="qf-side-title">Files</span>
        <span className="qf-side-count">
          {viewedSet.size}/{files.length} viewed
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav
          ref={listRef}
          className="qf-filelist min-h-0 flex-1 overflow-y-auto py-1"
        >
          {indexed.map(({ file, index }) => {
            const glyph = glyphFor(file.status);
            const { dir, base } = splitPath(file.filename);
            const on = index === selectedIndex;
            const isViewed = viewedSet.has(file.filename);
            const threads = threadCounts.get(file.filename) ?? 0;
            const pend = pendingCounts.get(file.filename) ?? 0;
            return (
              <button
                key={file.filename}
                type="button"
                data-file-index={index}
                onClick={() => onSelect(index)}
                aria-current={on}
                title={file.filename}
                className={cn(
                  "qf-file qf-focusable",
                  on && "qf-file-active",
                  isViewed && "qf-file-viewed",
                )}
              >
                <span
                  className={cn("qf-file-glyph", glyph.cls)}
                  title={glyph.title}
                >
                  {glyph.letter}
                </span>
                <span className="qf-file-name">
                  <span className="qf-file-dir">{dir}</span>
                  <span className="qf-file-base">{base}</span>
                </span>
                <span className="qf-file-meta">
                  {changed.has(file.filename) && (
                    <span
                      className="qf-file-dot"
                      title="Changed since you viewed it"
                    />
                  )}
                  {threads > 0 && (
                    <span
                      className="qf-file-badge qf-file-badge-comment"
                      title={`${threads} thread${threads > 1 ? "s" : ""}`}
                    >
                      {threads}
                    </span>
                  )}
                  {pend > 0 && (
                    <span
                      className="qf-file-badge qf-file-badge-pending"
                      title={`${pend} pending`}
                    >
                      {pend}
                    </span>
                  )}
                  <span className="qf-file-stat">
                    <span className="qf-add">+{file.additions}</span>
                    <span className="qf-del">−{file.deletions}</span>
                  </span>
                  {isViewed && (
                    <Check
                      size={13}
                      className="qf-file-check"
                      aria-label="Viewed"
                    />
                  )}
                </span>
              </button>
            );
          })}
          {indexed.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-faint">
              No files changed.
            </div>
          )}
        </nav>
      </div>
    </div>
  );
}
