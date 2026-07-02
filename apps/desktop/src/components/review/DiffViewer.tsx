import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, ArrowUp, MessageSquarePlus } from "lucide-react";
import type { ChangedFile, PendingComment, ReviewComment } from "../../types";
import { parsePatch, type DiffRow } from "../../lib/diff";
import { highlightLine } from "../../lib/highlight";
import { cn } from "../../lib/cn";
import { useHotkeys } from "../../keyboard";
import { CommentThread } from "./CommentThread";
import { AddCommentBox } from "./AddCommentBox";

/** A request to land on a specific line (from in-PR text search). */
export interface JumpTarget {
  anchor: string;
  /** Bumped per jump so repeating the same anchor still re-triggers. */
  nonce: number;
}

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
  jumpTo?: JumpTarget | null;
}

/** A stable key for anchoring comments/boxes to a (side, line) location. */
function anchorKey(side: string, line: number): string {
  return `${side}:${line}`;
}

/** Resolve the comment target for a diff row. */
export function rowTarget(row: DiffRow): { line: number; side: string } | null {
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

/**
 * One diff line. Memoized so cursor moves (which flip `isCursor` on exactly two
 * rows) re-render two rows instead of the whole file — this is what keeps j/k
 * responsive on large diffs.
 */
const DiffLine = memo(function DiffLine({
  row,
  anchor,
  filename,
  isCursor,
  isFlash,
  hasAnchored,
  canComment,
  onEnter,
  onOpenBox,
}: {
  row: DiffRow;
  anchor: string | null;
  filename: string;
  isCursor: boolean;
  isFlash: boolean;
  hasAnchored: boolean;
  canComment: boolean;
  onEnter: (anchor: string) => void;
  onOpenBox: (anchor: string) => void;
}) {
  const marker = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
  return (
    <div
      data-anchor={anchor ?? undefined}
      onMouseEnter={anchor != null ? () => onEnter(anchor) : undefined}
      className={cn(
        "qf-row",
        row.type === "add" && "qf-row-add",
        row.type === "del" && "qf-row-del",
        isCursor && "qf-row-active",
        isFlash && "qf-row-flash",
        hasAnchored && "qf-row-threaded",
      )}
    >
      <span className="qf-gutter qf-gutter-old">
        {row.oldLine ?? ""}
        {canComment && anchor != null && (
          <button
            type="button"
            aria-label="Add comment"
            onClick={() => onOpenBox(anchor)}
            className="qf-add-btn"
          >
            +
          </button>
        )}
      </span>
      <span className="qf-gutter qf-gutter-new">{row.newLine ?? ""}</span>
      <span className="qf-marker">{marker}</span>
      <code className="qf-code">
        <span
          className="hljs"
          dangerouslySetInnerHTML={{
            __html: highlightLine(row.content, filename),
          }}
        />
      </code>
    </div>
  );
});

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
  jumpTo,
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
  // stays on the same logical line when hunks collapse/expand. Hovering a row
  // also moves it, so keyboard and mouse always agree on "the current line".
  const [cursorAnchor, setCursorAnchor] = useState<string | null>(null);
  // Last input modality — drives which single "+" affordance is shown (the
  // keyboard cursor row, or the mouse-hovered row) so there's never two.
  const [inputMode, setInputMode] = useState<"keyboard" | "mouse">("keyboard");
  // The row briefly lit after a search jump.
  const [flashAnchor, setFlashAnchor] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll the cursor into view for explicit user moves — not for the
  // initial seed / collapse-driven re-placement, which would otherwise yank a
  // freshly-restored scroll position (resume) back to the top of the file.
  const userMovedCursorRef = useRef(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Keep a *set* cursor on a real, visible line (e.g. after its hunk collapses)
  // — but never seed one on open. The highlight only appears once the user
  // hovers or presses j/k, so a freshly-opened file reads clean.
  useEffect(() => {
    if (cursorAnchor !== null && !navAnchors.includes(cursorAnchor)) {
      setCursorAnchor(navAnchors.length ? navAnchors[0] : null);
    }
  }, [navAnchors, cursorAnchor]);

  // Scroll the cursor row into view when the user moves it (j/k). Seed, hover
  // sync, and auto-correction don't scroll, so the mouse never fights the view
  // and resume's restored scroll position holds.
  useEffect(() => {
    if (!cursorAnchor || !userMovedCursorRef.current) return;
    userMovedCursorRef.current = false;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-anchor="${cursorAnchor}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [cursorAnchor]);

  // Land a search jump: move the cursor there, scroll it to center, flash it.
  useEffect(() => {
    if (!jumpTo) return;
    const { anchor } = jumpTo;
    setInputMode("keyboard");
    setCursorAnchor(anchor);
    setFlashAnchor(anchor);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashAnchor(null), 1600);
    requestAnimationFrame(() => {
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`)
        ?.scrollIntoView({ block: "center" });
    });
  }, [jumpTo]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  function toggleHunk(i: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  const openBox = useCallback((key: string) => {
    setOpenBoxes((prev) => new Set(prev).add(key));
  }, []);
  function closeBox(key: string) {
    setOpenBoxes((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }

  // Hovering a row moves the line cursor (without scrolling), so a following
  // j/k continues from the line under the pointer and `c` comments on it.
  const handleRowEnter = useCallback((anchor: string) => {
    setInputMode((m) => (m === "mouse" ? m : "mouse"));
    setCursorAnchor((cur) => (cur === anchor ? cur : anchor));
  }, []);

  // Cursor movement is coalesced per animation frame: rapid key-repeats (and
  // direction changes) accumulate a net delta that is applied once, so the
  // cursor can't fall behind a backlog of queued keydowns and reversing
  // direction cancels the pending move instead of replaying it.
  const navAnchorsRef = useRef(navAnchors);
  navAnchorsRef.current = navAnchors;
  const cursorAnchorRef = useRef(cursorAnchor);
  cursorAnchorRef.current = cursorAnchor;
  const pendingDeltaRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function flushCursor() {
    rafRef.current = null;
    const anchors = navAnchorsRef.current;
    const delta = pendingDeltaRef.current;
    pendingDeltaRef.current = 0;
    if (anchors.length === 0 || delta === 0) return;
    const cur = cursorAnchorRef.current;
    userMovedCursorRef.current = true;
    // First move just reveals the cursor at the top instead of jumping past it.
    if (!cur) {
      setCursorAnchor(anchors[0]);
      return;
    }
    const idx = anchors.indexOf(cur);
    const base = idx < 0 ? 0 : idx;
    const nextIdx = Math.min(Math.max(base + delta, 0), anchors.length - 1);
    setCursorAnchor(anchors[nextIdx]);
  }

  function moveCursor(delta: number) {
    if (inputMode !== "keyboard") setInputMode("keyboard");
    pendingDeltaRef.current += delta;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(flushCursor);
    }
  }

  function commentAtCursor() {
    const anchor = cursorAnchorRef.current ?? navAnchorsRef.current[0];
    if (anchor) {
      if (cursorAnchorRef.current !== anchor) setCursorAnchor(anchor);
      openBox(anchor);
    }
  }

  // Line-cursor navigation + comment, added to the active "review" scope.
  useHotkeys(
    "review",
    [
      {
        keys: ["j", "down"],
        description: "Next line",
        group: "Navigation",
        icon: ArrowDown,
        run: () => moveCursor(1),
      },
      {
        keys: ["k", "up"],
        description: "Previous line",
        group: "Navigation",
        icon: ArrowUp,
        run: () => moveCursor(-1),
      },
      {
        keys: "c",
        description: "Comment on line",
        group: "Comments",
        icon: MessageSquarePlus,
        run: commentAtCursor,
      },
    ],
    { activate: false },
  );

  if (!file.patch) {
    return (
      <div className="qf-empty">
        {file.changes > 0
          ? "Diff not available."
          : "Binary file or no textual diff."}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="qf-diff"
      data-mode={inputMode}
      onMouseMove={() => {
        if (inputMode !== "mouse") setInputMode("mouse");
      }}
    >
      {items.map((item, idx) => {
        if (item.kind === "hunk") {
          const isCollapsed = collapsed.has(item.hunkIndex);
          return (
            <button
              key={`h-${item.hunkIndex}`}
              type="button"
              onClick={() => toggleHunk(item.hunkIndex)}
              className="qf-row qf-row-hunk"
            >
              <span className="qf-gutter qf-gutter-old" />
              <span className="qf-gutter qf-gutter-new" />
              <span className="qf-marker">{isCollapsed ? "▸" : ""}</span>
              <code className="qf-code">{item.header}</code>
            </button>
          );
        }

        const row = item.row!;
        const target = item.target ?? null;
        const key = item.anchor ?? null;
        const threads = key != null ? threadsByAnchor.get(key) : undefined;
        const pendingHere = key != null ? pendingByAnchor.get(key) : undefined;
        const boxOpen = key != null && openBoxes.has(key);
        const hasAnchored =
          (threads && threads.length > 0) ||
          (pendingHere && pendingHere.length > 0);

        return (
          <Fragment key={`r-${idx}`}>
            <DiffLine
              row={row}
              anchor={key}
              filename={file.filename}
              isCursor={key != null && key === cursorAnchor}
              isFlash={key != null && key === flashAnchor}
              hasAnchored={!!hasAnchored}
              canComment={target != null}
              onEnter={handleRowEnter}
              onOpenBox={openBox}
            />

            {hasAnchored || boxOpen ? (
              <div className="js-comment qf-comment-wrap">
                {threads?.map((thread) => (
                  <CommentThread
                    key={thread[0].id}
                    comments={thread}
                    onReply={onReply}
                    replyPending={addPending}
                  />
                ))}
                {pendingHere?.map((p) => (
                  <div key={p.id} className="qf-thread qf-pending">
                    <div className="qf-comment">
                      <div className="qf-comment-head">
                        <span className="qf-pending-tag">Pending</span>
                        <button
                          type="button"
                          onClick={() => onRemovePending(p.id)}
                          className="qf-pending-remove qf-focusable"
                        >
                          Discard
                        </button>
                      </div>
                      <div className="qf-comment-body whitespace-pre-wrap">
                        {p.body}
                      </div>
                    </div>
                  </div>
                ))}
                {boxOpen && target != null && (
                  <div className="qf-thread">
                    <div className="qf-comment">
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
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
