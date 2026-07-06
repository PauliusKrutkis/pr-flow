// The review scroll's flattened item model. The whole PR renders as ONE
// virtualized list (react-virtuoso) — files are groups with sticky headers,
// and every hunk header, diff row, and comment block is an item. Building the
// flat list here, as a pure function, gives every consumer the same indexing:
// the list renders items, the keyboard cursor walks `nav`, find/search jumps
// resolve `anchorItem`, ]c/[c walks `commentItems`, and the overview ruler
// turns item indexes into fractions.

import type { ChangedFile, PendingComment, ReviewComment } from "../types";
import { parsePatch, type DiffHunk, type DiffRow } from "./diff";
import { intralinePairs, type IntralineRanges } from "./intraline";
import {
  detectIndentUnit,
  guideLevelsForHunk,
  type IndentUnit,
} from "./indent";

/** A stable key for anchoring comments/boxes to a (side, line) location. */
export function anchorKey(side: string, line: number): string {
  return `${side}:${line}`;
}

/** A file-scoped anchor key — the openBoxes / anchorItem index key. */
export function fileAnchorKey(fileIndex: number, anchor: string): string {
  return `${fileIndex}:${anchor}`;
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
  delta: 1 | -1,
): string | null {
  const idx = m.navIndexOf.get(fileAnchorKey(fileIndex, fromAnchor));
  if (idx == null) return null;
  const next = m.nav[idx + delta];
  if (!next || next.fileIndex !== fileIndex) return null;
  const item = m.items[next.itemIndex];
  if (item.kind !== "row" || item.hunkIndex !== hunkIndex) return null;
  if (item.target == null || item.target.side !== side) return null;
  return next.anchor;
}

/**
 * Group flat review comments into threads (root first, then replies) and
 * index each thread by the anchor of its root comment.
 */
export function buildThreads(
  comments: ReviewComment[],
): Map<string, ReviewComment[][]> {
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

export interface ReviewRowItem {
  kind: "row";
  fileIndex: number;
  hunkIndex: number;
  row: DiffRow;
  /** "SIDE:line", or null for rows that can't anchor comments/jumps. */
  anchor: string | null;
  target: { line: number; side: string } | null;
  /** This row has a thread/pending comment attached (visual treatment). */
  hasAnchored: boolean;
}

export interface ReviewHunkItem {
  kind: "hunk";
  fileIndex: number;
  hunkIndex: number;
  header: string;
  collapsed: boolean;
}

export interface ReviewCommentsItem {
  kind: "comments";
  fileIndex: number;
  anchor: string;
  target: { line: number; side: string } | null;
  /** The anchored row's code — the composer's ```suggestion prefill. */
  rowContent: string | null;
  threads: ReviewComment[][];
  pending: PendingComment[];
  boxOpen: boolean;
  /** Open composer's range start line (multi-line comment); null = single. */
  boxStartLine: number | null;
  /** The range's rows, start→end, for the multi-line suggestion prefill. */
  rangeContent: string | null;
}

/** Whole-file bodies without rows: image comparisons and binary notes. */
export interface ReviewImageItem {
  kind: "image";
  fileIndex: number;
}
export interface ReviewNoteItem {
  kind: "note";
  fileIndex: number;
  text: string;
}

export type ReviewItem =
  | ReviewRowItem
  | ReviewHunkItem
  | ReviewCommentsItem
  | ReviewImageItem
  | ReviewNoteItem;

export interface ReviewListModel {
  items: ReviewItem[];
  /** Items per file, in file order — GroupedVirtuoso's groupCounts. */
  groupCounts: number[];
  /** First item index of each file's group. */
  groupFirstItem: number[];
  /** fileAnchorKey(fileIndex, anchor) → item index of that row. */
  anchorItem: Map<string, number>;
  /** Ordered navigable rows (the j/k cursor's world). */
  nav: Array<{ fileIndex: number; anchor: string; itemIndex: number }>;
  /** Position of each nav entry, for O(1) cursor stepping. */
  navIndexOf: Map<string, number>;
  /** Item indexes of comment blocks, for ]c/[c. */
  commentItems: number[];
}

export interface BuildReviewItemsInput {
  files: ReadonlyArray<ChangedFile>;
  isImage: (file: ChangedFile) => boolean;
  /** fileIndex → collapsed hunk indexes. */
  collapsed: ReadonlyMap<number, ReadonlySet<number>>;
  /** fileAnchorKey(...) entries with an open composer → the composer's range
   *  start line (multi-line comment), or null for a single-line comment. */
  openBoxes: ReadonlyMap<string, number | null>;
  /** filename → review comments / pending drafts. */
  commentsByFile: ReadonlyMap<string, ReviewComment[]>;
  pendingByFile: ReadonlyMap<string, PendingComment[]>;
}

export function buildReviewItems(input: BuildReviewItemsInput): ReviewListModel {
  const { files, isImage, collapsed, openBoxes, commentsByFile, pendingByFile } =
    input;
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
      items.push({ kind: "image", fileIndex });
      groupCounts.push(items.length - startCount);
      return;
    }
    if (!file.patch) {
      items.push({
        kind: "note",
        fileIndex,
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
        kind: "hunk",
        fileIndex,
        hunkIndex,
        header: hunk.header,
        collapsed: isCollapsed,
      });
      if (isCollapsed) return;
      // Row content by anchor, within this hunk — a range composer anchored
      // at its END row looks its earlier lines up here (ranges are one-side,
      // one-hunk, so every start..end line has been seen by then).
      const contentByAnchor = new Map<string, string>();
      for (const row of hunk.rows) {
        if (row.type === "hunk") continue;
        const target = rowTarget(row);
        const anchor = target ? anchorKey(target.side, target.line) : null;
        if (anchor != null) contentByAnchor.set(anchor, row.content);
        const rowThreads = anchor ? threads.get(anchor) : undefined;
        const rowPending = anchor ? pendingByAnchor.get(anchor) : undefined;
        const boxStartLine =
          anchor != null
            ? (openBoxes.get(fileAnchorKey(fileIndex, anchor)) ?? null)
            : null;
        const boxOpen =
          anchor != null && openBoxes.has(fileAnchorKey(fileIndex, anchor));
        const hasAnchored =
          (rowThreads?.length ?? 0) > 0 || (rowPending?.length ?? 0) > 0;
        if (anchor != null) {
          anchorItem.set(fileAnchorKey(fileIndex, anchor), items.length);
          navIndexOf.set(fileAnchorKey(fileIndex, anchor), nav.length);
          nav.push({ fileIndex, anchor, itemIndex: items.length });
        }
        items.push({
          kind: "row",
          fileIndex,
          hunkIndex,
          row,
          anchor,
          target,
          hasAnchored,
        });
        if (hasAnchored || boxOpen) {
          let rangeContent: string | null = null;
          if (boxOpen && boxStartLine != null && target != null) {
            const lines: string[] = [];
            for (let l = boxStartLine; l <= target.line; l += 1) {
              const c = contentByAnchor.get(anchorKey(target.side, l));
              if (c != null) lines.push(c);
            }
            rangeContent = lines.join("\n");
          }
          commentItems.push(items.length);
          items.push({
            kind: "comments",
            fileIndex,
            anchor: anchor!,
            target,
            rowContent: row.content,
            threads: rowThreads ?? [],
            pending: rowPending ?? [],
            boxOpen,
            boxStartLine: boxOpen ? boxStartLine : null,
            rangeContent,
          });
        }
      }
    });

    groupCounts.push(items.length - startCount);
  });

  return {
    items,
    groupCounts,
    groupFirstItem,
    anchorItem,
    nav,
    navIndexOf,
    commentItems,
  };
}

// ---- per-file render metadata ------------------------------------------------
// Intraline emphasis, indent guides, and the indent unit are derived from the
// parsed hunks. parsePatch caches by patch string, so the hunks array identity
// is stable — a WeakMap keyed by it gives every rendered row O(1) access
// without recomputing per render or per item.

export interface FileRenderMeta {
  intraByRow: ReadonlyMap<DiffRow, IntralineRanges>;
  guideByRow: ReadonlyMap<DiffRow, number>;
  indentUnit: IndentUnit;
}

const metaCache = new WeakMap<object, FileRenderMeta>();

export function fileRenderMeta(patch: string): FileRenderMeta {
  const hunks: DiffHunk[] = parsePatch(patch);
  const hit = metaCache.get(hunks);
  if (hit) return hit;
  const indentUnit = detectIndentUnit(hunks);
  const guideByRow = new Map<DiffRow, number>();
  for (const hunk of hunks) {
    const levels = guideLevelsForHunk(hunk.rows, indentUnit);
    hunk.rows.forEach((row, i) => {
      const lvl = levels[i];
      if (lvl != null) guideByRow.set(row, lvl);
    });
  }
  const meta: FileRenderMeta = {
    intraByRow: intralinePairs(hunks),
    guideByRow,
    indentUnit,
  };
  metaCache.set(hunks, meta);
  return meta;
}
