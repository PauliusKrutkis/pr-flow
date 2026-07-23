/**
 * Full-file context expansion — the stateful half. Owns which files are
 * expanded, fetches their head blobs, validates them against the patch
 * (expand-file.ts), and hands the review screen a fileIndex → rows map to
 * feed buildReviewItems. Everything downstream (cursor, find, occurrences,
 * ruler, comments) rides the row stream and needs no expansion awareness.
 *
 * The toggle contract is a fixed reading line, not offset preservation. On
 * expand/collapse the row the reader is on (the keyboard cursor, or the first
 * visible row when there's no cursor) is placed at a constant position — a
 * reading line ~1/3 from the viewport top — and flashed ("you are here").
 * Anchors are stable across modes ("SIDE:line" means the same row in both), so
 * the target survives the swap; a nearest-line fallback covers the one case an
 * anchor can vanish (collapsing while a synthesized row was the target).
 *
 * Why a reading line instead of restoring the old pixel offset: offset
 * preservation is a fixed-point fight against the virtualizer — every
 * corrective scroll mounts estimated rows whose re-measure moves the target
 * again, so it drifts a little, cumulatively, worst when the cursor sits far
 * from center (PR #47 known issue). A reading line derives position from the
 * cursor line absolutely: no capture offset, no baseline, nothing for a
 * residual to compound through. Expand replaces everything around the cursor
 * row anyway; one deliberate reposition to a learned, constant spot is honest
 * about that and keeps the line you're reading findable.
 *
 * No loading states (design principle #6): expanding is a quiet swap when the
 * blob lands; failures (binary, too large, blob/diff mismatch after a push)
 * flash once and drop the file back to hunks.
 *
 * Settle/reveal: the restore holds the swap under a mask, then reveals once the
 * target sits at the reading line. Toggling again before a swap settles cancels
 * the in-flight restore, which would otherwise re-issue a stale target and
 * unmask mid-settle. Rows measure lazily under load, so a straggling
 * re-measure can shove the target after reveal; a ResizeObserver stays armed
 * for a grace window and re-issues the jump inside its callback (before paint,
 * so it's invisible). It starts "hot" because the first re-measure is expected
 * but lands a frame or two late — the reveal must not fire in the quiet gap
 * before it arrives.
 */

import { useQueries } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "../lib/api.ts";
import type { DiffRow } from "../lib/diff.ts";
import {
  blobToLines,
  canExpandFile,
  expandFileRows,
} from "../lib/expand-file.ts";
import { queryClient } from "../lib/query-client.ts";
import {
  anchorLine,
  fileAnchorKey,
  type ReviewListModel,
} from "../lib/review-items.ts";
import type { ChangedFile } from "../types.ts";
import { useLatest } from "./use-latest.ts";

/**
 * `preSwap` marks a capture taken inside a commit's effects (blob promotion):
 * the restore effect also runs in that same commit — one render BEFORE the
 * swap — and must skip once, or it would consume the capture against the old
 * model and leave the swap unanchored. Captures taken in event handlers
 * (collapse) are followed immediately by the swap render, so they don't skip.
 */
interface RestoreTarget {
  anchor: string;
  fileIndex: number;
  preSwap: boolean;
}

interface ExpansionListHandle {
  firstVisibleRow: () => {
    anchor: string;
    fileIndex: number;
  } | null;
  scroller: () => HTMLElement | null;
  scrollItemToReadingLine: (itemIndex: number) => void;
}

/**
 * The row to place at the reading line through a swap: the keyboard cursor's
 * row — that's where the reader's attention is — otherwise the first visible
 * row.
 */
function captureTarget(
  listRef: React.RefObject<ExpansionListHandle | null>,
  cursor: { anchor: string; fileIndex: number } | null,
  preSwap: boolean
): RestoreTarget | null {
  if (cursor) {
    return { anchor: cursor.anchor, fileIndex: cursor.fileIndex, preSwap };
  }
  const first = listRef.current?.firstVisibleRow() ?? null;
  return first === null ? null : { ...first, preSwap };
}

interface PromotedBlob {
  lines: readonly string[];
  sha: string;
}

const EMPTY_NAMES: ReadonlySet<string> = new Set();
const EMPTY_PROMOTED: ReadonlyMap<string, PromotedBlob> = new Map();

function expandFailure(
  file: ChangedFile,
  lines: readonly string[] | "binary" | "too-large"
): string | null {
  if (lines === "too-large") {
    return `${file.filename} is too large to expand.`;
  }
  if (lines === "binary") {
    return `${file.filename} is a binary file — nothing to expand.`;
  }
  if (!file.patch || expandFileRows(file.patch, lines) === null) {
    return `${file.filename} changed since this diff — couldn't expand.`;
  }
  return null;
}

export function useFileExpansion(args: {
  activeFileIndex: number;
  cursorRef: React.RefObject<{ anchor: string; fileIndex: number } | null>;
  files: readonly ChangedFile[];
  headSha: string;
  listRef: React.RefObject<ExpansionListHandle | null>;
  owner: string;
  repo: string;
  setFlash: (message: string) => void;
}) {
  const {
    activeFileIndex,
    cursorRef,
    files,
    headSha,
    listRef,
    owner,
    repo,
    setFlash,
  } = args;
  const [expandedNames, setExpandedNames] =
    useState<ReadonlySet<string>>(EMPTY_NAMES);
  const [promoted, setPromoted] =
    useState<ReadonlyMap<string, PromotedBlob>>(EMPTY_PROMOTED);
  const pendingRestoreRef = useRef<RestoreTarget | null>(null);

  const names = [...expandedNames].sort();
  const results = useQueries({
    queries: names.map((name) => ({
      enabled: headSha !== "",
      queryFn: () => api.getFileBlob(owner, repo, name, headSha),
      queryKey: ["fileBlob", owner, repo, name, headSha],
      retry: 1,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });

  const promotionRef = useLatest({
    files,
    headSha,
    names,
    promoted,
    results,
  });

  const activeFile = files[activeFileIndex];
  const prefetchName =
    activeFile && canExpandFile(activeFile) ? activeFile.filename : null;
  const prefetchRef = useLatest({ headSha, owner, repo });
  useEffect(() => {
    if (prefetchName === null) {
      return;
    }
    const target = prefetchRef.current;
    if (target.headSha === "") {
      return;
    }
    const timer = setTimeout(() => {
      queryClient.prefetchQuery({
        queryFn: () =>
          api.getFileBlob(
            target.owner,
            target.repo,
            prefetchName,
            target.headSha
          ),
        queryKey: [
          "fileBlob",
          target.owner,
          target.repo,
          prefetchName,
          target.headSha,
        ],
        staleTime: Number.POSITIVE_INFINITY,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [prefetchName, prefetchRef]);

  /**
   * Promote resolved blobs into rendered state one commit AFTER the data
   * lands, never in the same render — this is the window where the DOM still
   * shows the old rows and the reading-line target can be captured. Re-runs
   * every render; the `has` guards make it converge.
   */
  useLayoutEffect(() => {
    const cur = promotionRef.current;
    cur.names.forEach((name, i) => {
      const already = cur.promoted.get(name);
      if (already && already.sha === cur.headSha) {
        return;
      }
      const result = cur.results[i];
      const file = cur.files.find((f) => f.filename === name);
      if (result.isError || !file) {
        setFlash(`Couldn't load the full ${name}.`);
        setExpandedNames((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        return;
      }
      if (!result.data) {
        return;
      }
      const lines = blobToLines(result.data);
      const failure = expandFailure(file, lines);
      if (failure !== null || typeof lines === "string") {
        setFlash(failure ?? `Couldn't expand ${name}.`);
        setExpandedNames((prev) => {
          const next = new Set(prev);
          next.delete(name);
          return next;
        });
        return;
      }
      if (pendingRestoreRef.current === null) {
        pendingRestoreRef.current = captureTarget(
          listRef,
          cursorRef.current,
          true
        );
      }
      setPromoted((prev) =>
        new Map(prev).set(name, { lines, sha: cur.headSha })
      );
    });
  });

  const toggleExpand = (fileIndex: number) => {
    const file = files[fileIndex];
    if (!file) {
      return;
    }
    if (expandedNames.has(file.filename)) {
      if (pendingRestoreRef.current === null) {
        pendingRestoreRef.current = captureTarget(
          listRef,
          cursorRef.current,
          false
        );
      }
      setExpandedNames((prev) => {
        const next = new Set(prev);
        next.delete(file.filename);
        return next;
      });
      setPromoted((prev) => {
        const next = new Map(prev);
        next.delete(file.filename);
        return next;
      });
      return;
    }
    if (!canExpandFile(file)) {
      return;
    }
    setExpandedNames((prev) => new Set(prev).add(file.filename));
  };

  const expandedRows = new Map<number, readonly DiffRow[]>();
  files.forEach((file, fileIndex) => {
    const entry = promoted.get(file.filename);
    if (!(entry && file.patch) || entry.sha !== headSha) {
      return;
    }
    const rows = expandFileRows(file.patch, entry.lines);
    if (rows) {
      expandedRows.set(fileIndex, rows);
    }
  });

  const expandingNames = new Set<string>();
  for (const name of expandedNames) {
    const entry = promoted.get(name);
    if (!entry || entry.sha !== headSha) {
      expandingNames.add(name);
    }
  }

  return {
    expandedNames,
    expandedRows,
    expandingNames,
    pendingRestoreRef,
    toggleExpand,
  };
}

const SETTLE_HOLD_FRAMES = 24;
const SETTLE_QUIET_FRAMES = 3;
const SETTLE_MIN_FRAMES = 4;
const REVEAL_GRACE_MS = 300;

/**
 * The restore half of the reading-line contract: whenever a target is
 * pending, jump the target row to the reading line in the model that just
 * rendered, hold it there while the virtualizer re-measures the freshly
 * inserted rows, then reveal and flash it. Called by the review screen after
 * its model ref exists, so the anchor lookup sees the post-swap items.
 *
 * The placement is a single `scrollToIndex({ align: 'start', offset })`:
 * virtuoso computes the position from its own height cache, so — unlike a
 * scrollTop delta — it doesn't accumulate a residual as re-measures land. It
 * still isn't pixel-perfect (the cache keeps the defaultItemHeight estimate
 * for rows that never render), but the reading line has no baseline to be
 * visible against: a few px of settle error just means the row sits a hair
 * off the third-line, not that it "drifted" from a promised offset.
 *
 * The swap is masked to hide the re-measure: the scroller is made invisible
 * (but laid out and measurable) before the first paint, the target is re-issued
 * to the reading line in quiet gaps while the virtualizer settles, and it's
 * revealed once the list has been quiet for a few frames (or a frame cap fires,
 * so content always shows). A ResizeObserver on the inner item-list marks the
 * list as settling; a short grace window after reveal re-issues the jump inside
 * the RO callback (pre-paint) to catch a straggling late re-measure. `onRestored`
 * fires once on reveal — the screen flashes the row, the "you are here" cue.
 *
 * The transient `qf-swapin` class on the scroller scopes the synthesized
 * rows' materialize animation to the swap itself — rows the virtualizer
 * mounts later, while scrolling, must not re-fade.
 */
export function useExpansionScrollRestore(
  pendingRestoreRef: React.RefObject<RestoreTarget | null>,
  modelRef: React.RefObject<ReviewListModel>,
  listRef: React.RefObject<ExpansionListHandle | null>,
  onRestored: (row: RestoreTarget) => void
): void {
  const onRestoredRef = useLatest(onRestored);
  const activeRef = useRef<{ cancel: () => void } | null>(null);
  useLayoutEffect(() => {
    const target = pendingRestoreRef.current;
    if (!target) {
      return;
    }
    if (target.preSwap) {
      target.preSwap = false;
      return;
    }
    pendingRestoreRef.current = null;

    activeRef.current?.cancel();

    const itemIndex = restoreItemIndex(modelRef.current, target);

    const swapScroller = listRef.current?.scroller() ?? null;
    if (swapScroller) {
      swapScroller.classList.add("qf-swapin", "qf-swap-mask");
      setTimeout(() => swapScroller.classList.remove("qf-swapin"), 300);
    }

    const place = () => {
      if (itemIndex !== undefined) {
        listRef.current?.scrollItemToReadingLine(itemIndex);
      }
    };
    place();

    const scroller = listRef.current?.scroller() ?? null;
    const innerList =
      scroller?.querySelector<HTMLElement>(
        '[data-testid="virtuoso-item-list"]'
      ) ?? null;

    let cancelled = false;
    let revealed = false;
    const cancel = () => {
      cancelled = true;
      if (activeRef.current === self) {
        activeRef.current = null;
      }
      observer?.disconnect();
    };
    const self = { cancel };
    activeRef.current = self;

    const reveal = () => {
      revealed = true;
      swapScroller?.classList.remove("qf-swap-mask");
      onRestoredRef.current(target);
      setTimeout(cancel, REVEAL_GRACE_MS);
    };

    let framesSinceResize = -SETTLE_MIN_FRAMES;
    const observer = innerList
      ? new ResizeObserver(() => {
          if (revealed) {
            place();
            return;
          }
          framesSinceResize = 0;
          place();
        })
      : null;
    observer?.observe(innerList as HTMLElement);

    let frames = 0;
    const hold = () => {
      if (cancelled) {
        return;
      }
      frames += 1;
      framesSinceResize += 1;
      if (frames >= SETTLE_HOLD_FRAMES) {
        place();
        reveal();
        return;
      }
      if (
        framesSinceResize >= SETTLE_QUIET_FRAMES &&
        frames >= SETTLE_MIN_FRAMES
      ) {
        place();
        reveal();
        return;
      }
      requestAnimationFrame(hold);
    };
    requestAnimationFrame(hold);
  });

  useEffect(() => {
    return () => activeRef.current?.cancel();
  }, []);
}

function restoreItemIndex(
  m: ReviewListModel,
  target: RestoreTarget
): number | undefined {
  const exact = m.anchorItem.get(
    fileAnchorKey(target.fileIndex, target.anchor)
  );
  if (exact !== undefined) {
    return exact;
  }
  const side = target.anchor.slice(0, target.anchor.indexOf(":"));
  const line = anchorLine(target.anchor);
  let best: number | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of m.nav) {
    if (entry.fileIndex !== target.fileIndex) {
      continue;
    }
    if (!entry.anchor.startsWith(side)) {
      continue;
    }
    const dist = Math.abs(anchorLine(entry.anchor) - line);
    if (dist < bestDist) {
      bestDist = dist;
      best = entry.itemIndex;
    }
  }
  return best;
}
