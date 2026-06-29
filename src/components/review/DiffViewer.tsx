import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { ChangedFile, PendingComment, ReviewComment } from "../../types";
import { parsePatch, type DiffRow } from "../../lib/diff";
import { highlightLine } from "../../lib/highlight";
import { cn } from "../../lib/cn";
import { useHotkeys } from "../../keyboard";
import { CommentThread } from "./CommentThread";
import { AddCommentBox } from "./AddCommentBox";

interface DiffViewerProps {
  file: ChangedFile;
  comments: ReviewComment[];
  commitId: string;
  onAddComment: (a: {
    path: string;
    line: number;
    side: string;
    body: string;
  }) => Promise<void>;
  onReply: (a: { inReplyTo: number; body: string }) => Promise<void>;
  addPending: boolean;
  pending: PendingComment[];
  onAddPending: (c: {
    path: string;
    line: number;
    side: string;
    body: string;
  }) => void;
  onRemovePending: (id: string) => void;
}

/** A stable key for anchoring comments/boxes to a (side, line) location. */
function anchorKey(side: string, line: number): string {
  return `${side}:${line}`;
}

/** Resolve the comment target for a diff row. */
function rowTarget(row: DiffRow): { line: number; side: string } | null {
  if (row.type === "del") {
    return row.oldLine != null ? { line: row.oldLine, side: "LEFT" } : null;
  }
  if (row.type === "add" || row.type === "context") {
    return row.newLine != null ? { line: row.newLine, side: "RIGHT" } : null;
  }
  return null;
}

/**
 * Group flat review comments into threads (root first, then replies) and index
 * each thread by the anchor of its root comment.
 */
function buildThreads(comments: ReviewComment[]): Map<string, ReviewComment[][]> {
  const byId = new Map<number, ReviewComment>();
  for (const c of comments) byId.set(c.id, c);

  function rootOf(c: ReviewComment): ReviewComment {
    let cur = c;
    const seen = new Set<number>();
    while (cur.inReplyToId != null && byId.has(cur.inReplyToId)) {
      if (seen.has(cur.id)) break;
      seen.add(cur.id);
      cur = byId.get(cur.inReplyToId)!;
    }
    return cur;
  }

  const threadsByRoot = new Map<number, ReviewComment[]>();
  for (const c of comments) {
    const root = rootOf(c);
    const list = threadsByRoot.get(root.id) ?? [];
    list.push(c);
    threadsByRoot.set(root.id, list);
  }

  const out = new Map<string, ReviewComment[][]>();
  for (const [rootId, list] of threadsByRoot) {
    const root = byId.get(rootId)!;
    const line = root.line ?? root.originalLine;
    if (line == null) continue;
    const key = anchorKey(root.side || "RIGHT", line);
    const sorted = [...list].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const bucket = out.get(key) ?? [];
    bucket.push(sorted);
    out.set(key, bucket);
  }
  return out;
}

interface RenderItem {
  kind: "hunk" | "row";
  hunkIndex: number;
  header?: string;
  row?: DiffRow;
  navIndex?: number;
  anchor?: string | null;
  target?: { line: number; side: string } | null;
}

export function DiffViewer({
  file,
  comments,
  commitId: _commitId,
  onAddComment,
  onReply,
  addPending,
  pending,
  onAddPending,
  onRemovePending,
}: DiffViewerProps) {
  const hunks = useMemo(() => parsePatch(file.patch), [file.patch]);
  const threadsByAnchor = useMemo(() => buildThreads(comments), [comments]);
  const pendingByAnchor = useMemo(() => {
    const m = new Map<string, PendingComment[]>();
    for (const p of pending) {
      const k = anchorKey(p.side, p.line);
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    return m;
  }, [pending]);

  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  const [openBoxes, setOpenBoxes] = useState<Set<string>>(() => new Set());
  // The keyboard line cursor, tracked by stable row anchor ("side:line") so it
  // stays on the same logical line when hunks collapse/expand.
  const [cursorAnchor, setCursorAnchor] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll the cursor into view for explicit user moves — not for the
  // initial seed / collapse-driven re-placement, which would otherwise yank a
  // freshly-restored scroll position (resume) back to the top of the file.
  const userMovedCursorRef = useRef(false);

  // Flatten hunks into render items, assigning a sequential nav index to each
  // navigable (non-header, non-collapsed) row.
  const items = useMemo<RenderItem[]>(() => {
    const out: RenderItem[] = [];
    let nav = 0;
    hunks.forEach((hunk, hi) => {
      out.push({ kind: "hunk", hunkIndex: hi, header: hunk.header });
      if (collapsed.has(hi)) return;
      for (const row of hunk.rows) {
        if (row.type === "hunk") continue;
        const target = rowTarget(row);
        out.push({
          kind: "row",
          hunkIndex: hi,
          row,
          navIndex: nav++,
          anchor: target ? anchorKey(target.side, target.line) : null,
          target,
        });
      }
    });
    return out;
  }, [hunks, collapsed]);

  // Ordered anchors of the currently-navigable rows.
  const navAnchors = useMemo(
    () =>
      items.flatMap((it) =>
        it.kind === "row" && it.anchor ? [it.anchor] : [],
      ),
    [items],
  );

  // Keep the cursor on a real, visible line; if its line was hidden (its hunk
  // collapsed) or it is unset, fall back to the first navigable row.
  useEffect(() => {
    if (navAnchors.length === 0) {
      if (cursorAnchor !== null) setCursorAnchor(null);
      return;
    }
    if (cursorAnchor === null || !navAnchors.includes(cursorAnchor)) {
      setCursorAnchor(navAnchors[0]);
    }
  }, [navAnchors, cursorAnchor]);

  // Scroll the cursor row into view when the user moves it (j/k). Seed and
  // auto-correction don't scroll, so resume's restored scroll position holds.
  useEffect(() => {
    if (!cursorAnchor || !userMovedCursorRef.current) return;
    userMovedCursorRef.current = false;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-anchor="${cursorAnchor}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [cursorAnchor]);

  function toggleHunk(i: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function openBox(key: string) {
    setOpenBoxes((prev) => new Set(prev).add(key));
  }
  function closeBox(key: string) {
    setOpenBoxes((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  function moveCursor(delta: number) {
    if (navAnchors.length === 0) return;
    const idx = cursorAnchor ? navAnchors.indexOf(cursorAnchor) : -1;
    const base = idx < 0 ? 0 : idx;
    const nextIdx = Math.min(Math.max(base + delta, 0), navAnchors.length - 1);
    userMovedCursorRef.current = true;
    setCursorAnchor(navAnchors[nextIdx]);
  }

  function commentAtCursor() {
    if (cursorAnchor) openBox(cursorAnchor);
  }

  // Line-cursor navigation + comment, added to the active "review" scope.
  useHotkeys(
    "review",
    [
      {
        keys: ["j", "down"],
        description: "Next line",
        group: "Navigation",
        run: () => moveCursor(1),
      },
      {
        keys: ["k", "up"],
        description: "Previous line",
        group: "Navigation",
        run: () => moveCursor(-1),
      },
      {
        keys: "c",
        description: "Comment on line",
        group: "Comments",
        run: commentAtCursor,
      },
    ],
    { activate: false },
  );

  const renameArrow = file.previousFilename
    ? `${file.previousFilename} → ${file.filename}`
    : file.filename;

  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-line bg-surface-2 px-3 py-2">
        <span
          className="min-w-0 truncate font-mono text-xs text-fg"
          title={renameArrow}
        >
          {renameArrow}
        </span>
        <span className="shrink-0 font-mono text-xs">
          <span className="text-success">+{file.additions}</span>{" "}
          <span className="text-danger">−{file.deletions}</span>
        </span>
      </div>

      {!file.patch ? (
        <p className="px-3 py-6 text-sm text-muted">
          {file.changes > 0
            ? "Diff not available."
            : "Binary file or no textual diff."}
        </p>
      ) : (
        <div ref={containerRef} className="font-mono text-xs leading-relaxed">
          {items.map((item, idx) => {
            if (item.kind === "hunk") {
              const isCollapsed = collapsed.has(item.hunkIndex);
              return (
                <button
                  key={`h-${item.hunkIndex}`}
                  type="button"
                  onClick={() => toggleHunk(item.hunkIndex)}
                  className="flex w-full items-center gap-2 bg-surface-2 px-3 py-1 text-left text-muted hover:bg-elevated"
                >
                  <span className="select-none text-faint">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <span className="truncate">{item.header}</span>
                </button>
              );
            }

            const row = item.row!;
            const target = item.target ?? null;
            const key = item.anchor ?? null;
            const threads = key != null ? threadsByAnchor.get(key) : undefined;
            const pendingHere = key != null ? pendingByAnchor.get(key) : undefined;
            const boxOpen = key != null && openBoxes.has(key);
            const isCursor = item.anchor != null && item.anchor === cursorAnchor;
            const rowBg =
              row.type === "add"
                ? "diff-add"
                : row.type === "del"
                  ? "diff-del"
                  : "";
            const marker =
              row.type === "add" ? "+" : row.type === "del" ? "-" : " ";

            return (
              <Fragment key={`r-${idx}`}>
                <div
                  data-anchor={item.anchor ?? undefined}
                  className={cn(
                    "group flex border-l-2",
                    rowBg,
                    isCursor
                      ? "border-accent bg-accent/10"
                      : "border-transparent",
                  )}
                >
                  <div
                    className={cn(
                      "relative w-10 shrink-0 select-none px-1 text-right text-faint",
                      row.type === "del" && "diff-del-gutter",
                    )}
                  >
                    {row.oldLine ?? ""}
                    {target != null && (
                      <button
                        type="button"
                        aria-label="Add comment"
                        onClick={() => openBox(key!)}
                        className={cn(
                          "absolute -left-0.5 top-0 h-4 w-4 items-center justify-center rounded bg-accent text-[10px] font-bold leading-none text-accent-fg",
                          isCursor ? "flex" : "hidden group-hover:flex",
                        )}
                      >
                        +
                      </button>
                    )}
                  </div>
                  <div
                    className={cn(
                      "w-10 shrink-0 select-none px-1 text-right text-faint",
                      row.type === "add" && "diff-add-gutter",
                    )}
                  >
                    {row.newLine ?? ""}
                  </div>
                  <div className="flex-1 whitespace-pre-wrap break-all px-2">
                    <span className="select-none text-faint">{marker}</span>
                    <span
                      className="hljs"
                      dangerouslySetInnerHTML={{
                        __html: highlightLine(row.content, file.filename),
                      }}
                    />
                  </div>
                </div>

                {(threads && threads.length > 0) ||
                (pendingHere && pendingHere.length > 0) ||
                boxOpen ? (
                  <div className="js-comment space-y-2 bg-surface px-3 py-2">
                    {threads?.map((thread) => (
                      <CommentThread
                        key={thread[0].id}
                        comments={thread}
                        onReply={onReply}
                        replyPending={addPending}
                      />
                    ))}
                    {pendingHere?.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-card border border-accent/50 bg-surface-2 p-2 text-xs"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="font-medium text-accent">
                            Pending review comment
                          </span>
                          <button
                            type="button"
                            onClick={() => onRemovePending(p.id)}
                            className="text-muted hover:text-danger"
                          >
                            Remove
                          </button>
                        </div>
                        <div className="whitespace-pre-wrap text-fg">{p.body}</div>
                      </div>
                    ))}
                    {boxOpen && target != null && (
                      <AddCommentBox
                        pending={addPending}
                        autoFocus
                        placeholder="Add a review comment…"
                        submitLabel="Add to review"
                        secondaryLabel="Comment now"
                        onCancel={() => closeBox(key!)}
                        onSubmit={(body) => {
                          onAddPending({
                            path: file.filename,
                            line: target.line,
                            side: target.side,
                            body,
                          });
                          closeBox(key!);
                        }}
                        onSecondary={async (body) => {
                          await onAddComment({
                            path: file.filename,
                            line: target.line,
                            side: target.side,
                            body,
                          });
                          closeBox(key!);
                        }}
                      />
                    )}
                  </div>
                ) : null}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
