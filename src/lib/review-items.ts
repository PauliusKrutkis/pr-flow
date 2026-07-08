/**
 * The review scroll's flattened item model. The whole PR renders as ONE
 * virtualized list (react-virtuoso) — files are groups with sticky headers,
 * and every hunk header, diff row, and comment block is an item. Building the
 * flat list here, as a pure function, gives every consumer the same indexing:
 * the list renders items, the keyboard cursor walks `nav`, find/search jumps
 * resolve `anchorItem`, ]c/[c walks `commentItems`, and the overview ruler
 * turns item indexes into fractions.
 */

import type { ChangedFile, PendingComment, ReviewComment } from "../types.ts";
import { type DiffHunk, type DiffRow, parsePatch } from "./diff.ts";
import {
  detectIndentUnit,
  guideLevelsForHunk,
  type IndentUnit,
} from "./indent.ts";
import { type IntralineRanges, intralinePairs } from "./intraline.ts";

/** A stable key for anchoring comments/boxes to a (side, line) location. */
function anchorKey(side: string, line: number): string {
  return `${side}:${line}`;
}

/** A file-scoped anchor key — the openBoxes / anchorItem index key. */
export function fileAnchorKey(fileIndex: number, anchor: string): string {
  return `${fileIndex}:${anchor}`;
}

/** Resolve the comment target for a diff row. */
function rowTarget(row: DiffRow): { line: number; side: string } | null {
  if (row.type === "del") {
    return row.oldLine === null ? null : { line: row.oldLine, side: "LEFT" };
  }
  if (row.type === "add" || row.type === "context") {
    return row.newLine === null ? null : { line: row.newLine, side: "RIGHT" };
  }
  return null;
}

/** The line number an anchor key encodes ("SIDE:line"). */
export function anchorLine(anchor: string): number {
  return Number(anchor.slice(anchor.indexOf(":") + 1));
}

/**
 * The neighboring row anchor a line selection may extend to: the immediately
 * adjacent nav row in the same file, same hunk, on the same comment side.
 * Anything else (hunk header, side flip, file boundary) ends the range —
 * multi-line comments are one-side, hunk-contiguous runs.
 */
export function adjacentSelectableAnchor(
  m: ReviewListModel,
  fileIndex: number,
  side: string,
  hunkIndex: number,
  fromAnchor: string,
  delta: 1 | -1
): string | null {
  const idx = m.navIndexOf.get(fileAnchorKey(fileIndex, fromAnchor));
  if (idx === undefined) {
    return null;
  }
  const next = m.nav[idx + delta];
  if (!next || next.fileIndex !== fileIndex) {
    return null;
  }
  const item = m.items[next.itemIndex];
  if (item.kind !== "row" || item.hunkIndex !== hunkIndex) {
    return null;
  }
  if (item.target === null || item.target.side !== side) {
    return null;
  }
  return next.anchor;
}

/**
 * Group flat review comments into threads (root first, then replies) and
 * index each thread by the anchor of its root comment.
 */
function buildThreads(
  comments: ReviewComment[]
): Map<string, ReviewComment[][]> {
  const byId = new Map<number, ReviewComment>();
  for (const c of comments) {
    byId.set(c.id, c);
  }

  function rootOf(c: ReviewComment): ReviewComment {
    let cur = c;
    const seen = new Set<number>();
    while (cur.inReplyToId !== null && byId.has(cur.inReplyToId)) {
      if (seen.has(cur.id)) {
        break;
      }
      seen.add(cur.id);
      const parent = byId.get(cur.inReplyToId);
      if (!parent) {
        break;
      }
      cur = parent;
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
    const root = byId.get(rootId);
    if (!root) {
      continue;
    }
    const line = root.line ?? root.originalLine;
    if (line === null) {
      continue;
    }
    const key = anchorKey(root.side || "RIGHT", line);
    const sorted = [...list].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    const bucket = out.get(key) ?? [];
    bucket.push(sorted);
    out.set(key, bucket);
  }
  return out;
}

export interface ReviewRowItem {
  anchor: string | null;
  fileIndex: number;
  hasAnchored: boolean;
  hunkIndex: number;
  kind: "row";
  row: DiffRow;
  target: { line: number; side: string } | null;
}

export interface ReviewHunkItem {
  collapsed: boolean;
  fileIndex: number;
  header: string;
  hunkIndex: number;
  kind: "hunk";
}

export interface ReviewCommentsItem {
  anchor: string;
  boxOpen: boolean;
  boxStartLine: number | null;
  fileIndex: number;
  kind: "comments";
  pending: PendingComment[];
  rangeContent: string | null;
  rowContent: string | null;
  target: { line: number; side: string } | null;
  threads: ReviewComment[][];
}

/** Whole-file bodies without rows: image comparisons and binary notes. */
export interface ReviewImageItem {
  fileIndex: number;
  kind: "image";
}
export interface ReviewNoteItem {
  fileIndex: number;
  kind: "note";
  text: string;
}

export type ReviewItem =
  | ReviewRowItem
  | ReviewHunkItem
  | ReviewCommentsItem
  | ReviewImageItem
  | ReviewNoteItem;

export interface ReviewListModel {
  anchorItem: Map<string, number>;
  commentItems: number[];
  groupCounts: number[];
  groupFirstItem: number[];
  items: ReviewItem[];
  nav: Array<{ fileIndex: number; anchor: string; itemIndex: number }>;
  navIndexOf: Map<string, number>;
}

export interface BuildReviewItemsInput {
  collapsed: ReadonlyMap<number, ReadonlySet<number>>;
  commentsByFile: ReadonlyMap<string, ReviewComment[]>;
  files: readonly ChangedFile[];
  isImage: (file: ChangedFile) => boolean;
  openBoxes: ReadonlyMap<string, number | null>;
  pendingByFile: ReadonlyMap<string, PendingComment[]>;
}

interface HunkBuildContext {
  anchorItem: Map<string, number>;
  commentItems: number[];
  contentByAnchor: Map<string, string>;
  fileIndex: number;
  hunkIndex: number;
  items: ReviewItem[];
  nav: ReviewListModel["nav"];
  navIndexOf: Map<string, number>;
  openBoxes: ReadonlyMap<string, number | null>;
  pendingByAnchor: Map<string, PendingComment[]>;
  threads: Map<string, ReviewComment[][]>;
}

function appendCommentBlock(
  ctx: HunkBuildContext,
  row: DiffRow,
  anchor: string,
  target: { line: number; side: string },
  rowThreads: ReviewComment[][] | undefined,
  rowPending: PendingComment[] | undefined,
  boxOpen: boolean,
  boxStartLine: number | null
): void {
  let rangeContent: string | null = null;
  if (boxOpen && boxStartLine !== null) {
    const lines: string[] = [];
    for (let l = boxStartLine; l <= target.line; l += 1) {
      const c = ctx.contentByAnchor.get(anchorKey(target.side, l));
      if (c !== undefined) {
        lines.push(c);
      }
    }
    rangeContent = lines.join("\n");
  }
  ctx.commentItems.push(ctx.items.length);
  ctx.items.push({
    anchor,
    boxOpen,
    boxStartLine: boxOpen ? boxStartLine : null,
    fileIndex: ctx.fileIndex,
    kind: "comments",
    pending: rowPending ?? [],
    rangeContent,
    rowContent: row.content,
    target,
    threads: rowThreads ?? [],
  });
}

function appendHunkRow(ctx: HunkBuildContext, row: DiffRow): void {
  const target = rowTarget(row);
  const anchor = target ? anchorKey(target.side, target.line) : null;
  if (anchor !== null) {
    ctx.contentByAnchor.set(anchor, row.content);
  }
  const rowThreads = anchor ? ctx.threads.get(anchor) : undefined;
  const rowPending = anchor ? ctx.pendingByAnchor.get(anchor) : undefined;
  const boxStartLine =
    anchor === null
      ? null
      : (ctx.openBoxes.get(fileAnchorKey(ctx.fileIndex, anchor)) ?? null);
  const boxOpen =
    anchor !== null && ctx.openBoxes.has(fileAnchorKey(ctx.fileIndex, anchor));
  const hasAnchored =
    (rowThreads?.length ?? 0) > 0 || (rowPending?.length ?? 0) > 0;
  if (anchor !== null) {
    ctx.anchorItem.set(fileAnchorKey(ctx.fileIndex, anchor), ctx.items.length);
    ctx.navIndexOf.set(fileAnchorKey(ctx.fileIndex, anchor), ctx.nav.length);
    ctx.nav.push({
      anchor,
      fileIndex: ctx.fileIndex,
      itemIndex: ctx.items.length,
    });
  }
  ctx.items.push({
    anchor,
    fileIndex: ctx.fileIndex,
    hasAnchored,
    hunkIndex: ctx.hunkIndex,
    kind: "row",
    row,
    target,
  });
  if ((hasAnchored || boxOpen) && anchor !== null && target !== null) {
    appendCommentBlock(
      ctx,
      row,
      anchor,
      target,
      rowThreads,
      rowPending,
      boxOpen,
      boxStartLine
    );
  }
}

function appendHunkRows(ctx: HunkBuildContext, hunk: DiffHunk): void {
  for (const row of hunk.rows) {
    if (row.type === "hunk") {
      continue;
    }
    appendHunkRow(ctx, row);
  }
}

export function buildReviewItems(
  input: BuildReviewItemsInput
): ReviewListModel {
  const {
    files,
    isImage,
    collapsed,
    openBoxes,
    commentsByFile,
    pendingByFile,
  } = input;
  const items: ReviewItem[] = [];
  const groupCounts: number[] = [];
  const groupFirstItem: number[] = [];
  const anchorItem = new Map<string, number>();
  const nav: ReviewListModel["nav"] = [];
  const navIndexOf = new Map<string, number>();
  const commentItems: number[] = [];

  files.forEach((file, fileIndex) => {
    groupFirstItem.push(items.length);
    const startCount = items.length;

    if (isImage(file)) {
      items.push({ fileIndex, kind: "image" });
      groupCounts.push(items.length - startCount);
      return;
    }
    if (!file.patch) {
      items.push({
        fileIndex,
        kind: "note",
        text:
          file.changes > 0
            ? "Diff not available."
            : "Binary file or no textual diff.",
      });
      groupCounts.push(items.length - startCount);
      return;
    }

    const threads = buildThreads(commentsByFile.get(file.filename) ?? []);
    const pendingByAnchor = new Map<string, PendingComment[]>();
    for (const p of pendingByFile.get(file.filename) ?? []) {
      const k = anchorKey(p.side, p.line);
      const arr = pendingByAnchor.get(k) ?? [];
      arr.push(p);
      pendingByAnchor.set(k, arr);
    }

    const fileCollapsed = collapsed.get(fileIndex);
    const hunks = parsePatch(file.patch);
    hunks.forEach((hunk, hunkIndex) => {
      const isCollapsed = fileCollapsed?.has(hunkIndex) ?? false;
      items.push({
        collapsed: isCollapsed,
        fileIndex,
        header: hunk.header,
        hunkIndex,
        kind: "hunk",
      });
      if (isCollapsed) {
        return;
      }

      appendHunkRows(
        {
          anchorItem,
          commentItems,
          contentByAnchor: new Map<string, string>(),
          fileIndex,
          hunkIndex,
          items,
          nav,
          navIndexOf,
          openBoxes,
          pendingByAnchor,
          threads,
        },
        hunk
      );
    });

    groupCounts.push(items.length - startCount);
  });

  return {
    anchorItem,
    commentItems,
    groupCounts,
    groupFirstItem,
    items,
    nav,
    navIndexOf,
  };
}

/**
 * Intraline emphasis, indent guides, and the indent unit are derived from the
 * parsed hunks. parsePatch caches by patch string, so the hunks array identity
 * is stable — a WeakMap keyed by it gives every rendered row O(1) access
 * without recomputing per render or per item.
 */

export interface FileRenderMeta {
  guideByRow: ReadonlyMap<DiffRow, number>;
  indentUnit: IndentUnit;
  intraByRow: ReadonlyMap<DiffRow, IntralineRanges>;
}

const metaCache = new WeakMap<object, FileRenderMeta>();

export function fileRenderMeta(patch: string): FileRenderMeta {
  const hunks: DiffHunk[] = parsePatch(patch);
  const hit = metaCache.get(hunks);
  if (hit) {
    return hit;
  }
  const indentUnit = detectIndentUnit(hunks);
  const guideByRow = new Map<DiffRow, number>();
  for (const hunk of hunks) {
    const levels = guideLevelsForHunk(hunk.rows, indentUnit);
    hunk.rows.forEach((row, i) => {
      const lvl = levels[i];
      if (lvl !== null) {
        guideByRow.set(row, lvl);
      }
    });
  }
  const meta: FileRenderMeta = {
    guideByRow,
    indentUnit,
    intraByRow: intralinePairs(hunks),
  };
  metaCache.set(hunks, meta);
  return meta;
}
