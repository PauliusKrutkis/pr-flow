import { Fragment, useMemo, useState } from "react";
import type { ChangedFile, ReviewComment } from "../../types";
import { parsePatch, type DiffRow } from "../../lib/diff";
import { highlightLine } from "../../lib/highlight";
import { cn } from "../../lib/cn";
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

  // Resolve each comment to its root id (following inReplyToId chains).
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
    // Anchor preference: resolved `line`, falling back to `originalLine`.
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

export function DiffViewer({
  file,
  comments,
  commitId: _commitId,
  onAddComment,
  onReply,
  addPending,
}: DiffViewerProps) {
  const hunks = useMemo(() => parsePatch(file.patch), [file.patch]);
  const threadsByAnchor = useMemo(() => buildThreads(comments), [comments]);

  // Collapsed hunk indices (default: all expanded).
  const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
  // Open add-comment boxes, keyed by anchor.
  const [openBoxes, setOpenBoxes] = useState<Set<string>>(() => new Set());

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
        <div className="font-mono text-xs leading-relaxed">
          {hunks.map((hunk, hi) => {
            const isCollapsed = collapsed.has(hi);
            return (
              <div key={hi}>
                <button
                  type="button"
                  onClick={() => toggleHunk(hi)}
                  className="flex w-full items-center gap-2 bg-surface-2 px-3 py-1 text-left text-muted hover:bg-elevated"
                >
                  <span className="select-none text-faint">
                    {isCollapsed ? "▸" : "▾"}
                  </span>
                  <span className="truncate">{hunk.header}</span>
                </button>

                {!isCollapsed &&
                  hunk.rows.map((row, ri) => {
                    if (row.type === "hunk") return null;
                    const target = rowTarget(row);
                    const key =
                      target != null ? anchorKey(target.side, target.line) : null;
                    const threads =
                      key != null ? threadsByAnchor.get(key) : undefined;
                    const boxOpen = key != null && openBoxes.has(key);

                    const rowBg =
                      row.type === "add"
                        ? "diff-add"
                        : row.type === "del"
                          ? "diff-del"
                          : "";
                    const marker =
                      row.type === "add" ? "+" : row.type === "del" ? "-" : " ";

                    return (
                      <Fragment key={`${hi}-${ri}`}>
                        <div className={cn("group flex", rowBg)}>
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
                                  "absolute -left-0.5 top-0 hidden h-4 w-4 items-center justify-center",
                                  "rounded bg-accent text-[10px] font-bold leading-none text-accent-fg",
                                  "group-hover:flex",
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
                            <span className="select-none text-faint">
                              {marker}
                            </span>
                            <span
                              className="hljs"
                              dangerouslySetInnerHTML={{
                                __html: highlightLine(
                                  row.content,
                                  file.filename,
                                ),
                              }}
                            />
                          </div>
                        </div>

                        {(threads != null && threads.length > 0) || boxOpen ? (
                          <div className="js-comment space-y-2 bg-surface px-3 py-2">
                            {threads?.map((thread) => (
                              <CommentThread
                                key={thread[0].id}
                                comments={thread}
                                onReply={onReply}
                                replyPending={addPending}
                              />
                            ))}
                            {boxOpen && target != null && (
                              <AddCommentBox
                                pending={addPending}
                                autoFocus
                                placeholder="Leave a review comment…"
                                onCancel={() => closeBox(key!)}
                                onSubmit={async (body) => {
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
            );
          })}
        </div>
      )}
    </div>
  );
}
