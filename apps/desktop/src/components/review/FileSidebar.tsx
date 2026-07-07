import { Check } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "../../lib/cn.ts";
import { useAppStore } from "../../store/appStore.ts";
import type {
  ChangedFile,
  FileStatus,
  PendingComment,
  ReviewComment,
} from "../../types.ts";

interface FileSidebarProps {
  changed: Set<string>;
  comments: ReviewComment[];
  files: ChangedFile[];
  onSelect: (i: number) => void;
  pending: PendingComment[];
  prKeyValue: string;
  selectedIndex: number;
}

interface Glyph {
  cls: string;
  letter: string;
  title: string;
}

function glyphFor(status: FileStatus): Glyph {
  switch (status) {
    case "added":
      return { cls: "qf-st-add", letter: "A", title: "Added" };
    case "removed":
      return { cls: "qf-st-del", letter: "D", title: "Removed" };
    case "renamed":
      return { cls: "qf-st-ren", letter: "R", title: "Renamed" };
    case "copied":
      return { cls: "qf-st-ren", letter: "C", title: "Copied" };
    default:
      return { cls: "qf-st-mod", letter: "M", title: "Modified" };
  }
}

function splitPath(filename: string): { dir: string; base: string } {
  const idx = filename.lastIndexOf("/");
  if (idx === -1) {
    return { base: filename, dir: "" };
  }
  return { base: filename.slice(idx + 1), dir: filename.slice(0, idx + 1) };
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
    [viewedFiles]
  );

  const listRef = useRef<HTMLDivElement>(null);

  const threadCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of comments) {
      if (c.inReplyToId != null) {
        continue;
      }
      m.set(c.path, (m.get(c.path) ?? 0) + 1);
    }
    return m;
  }, [comments]);
  const pendingCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of pending) {
      m.set(p.path, (m.get(p.path) ?? 0) + 1);
    }
    return m;
  }, [pending]);

  const indexed = useMemo(
    () => files.map((file, index) => ({ file, index })),
    [files]
  );

  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(
      `[data-file-index="${selectedIndex}"]`
    );
    if (!(list && el)) {
      return;
    }
    const listRect = list.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const pad = 8;
    if (
      elRect.top < listRect.top + pad ||
      elRect.bottom > listRect.bottom - pad
    ) {
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
          className="qf-filelist min-h-0 flex-1 overflow-y-auto py-1"
          ref={listRef}
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
                aria-current={on}
                className={cn(
                  "qf-file qf-focusable",
                  on && "qf-file-active",
                  isViewed && "qf-file-viewed"
                )}
                data-file-index={index}
                key={file.filename}
                onClick={() => onSelect(index)}
                title={file.filename}
                type="button"
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
                      aria-label="Viewed"
                      className="qf-file-check"
                      size={13}
                    />
                  )}
                </span>
              </button>
            );
          })}
          {indexed.length === 0 && (
            <div className="px-4 py-6 text-center text-faint text-xs">
              No files changed.
            </div>
          )}
        </nav>
      </div>
    </div>
  );
}
