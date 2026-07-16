/**
 * Full-file context expansion — the stateful half. Owns which files are
 * expanded, fetches their head blobs, validates them against the patch
 * (expand-file.ts), and hands the review screen a fileIndex → rows map to
 * feed buildReviewItems. Everything downstream (cursor, find, occurrences,
 * ruler, comments) rides the row stream and needs no expansion awareness.
 *
 * Scroll anchoring is the contract that makes the toggle feel in-place: the
 * first visible row is captured from the DOM BEFORE the row swap renders
 * (synchronously in the toggle handler on collapse; in the promotion effect,
 * one commit before the rows appear, on expand) and restored right after by
 * useExpansionScrollRestore — which the screen must call AFTER its model ref
 * is in scope, so the restore resolves anchors against the post-swap model.
 * Anchors are stable across modes ("SIDE:line" means the same row in both),
 * so restoring is a lookup, with a nearest-line fallback for the one case an
 * anchor can vanish: collapsing while a synthesized row was topmost.
 *
 * No loading states (design principle #6): expanding is a quiet swap when the
 * blob lands; failures (binary, too large, blob/diff mismatch after a push)
 * flash once and drop the file back to hunks.
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
interface CapturedRow {
  anchor: string;
  fileIndex: number;
  preSwap: boolean;
  top: number;
}

interface ExpansionListHandle {
  firstVisibleRow: () => {
    anchor: string;
    fileIndex: number;
    top: number;
  } | null;
  scroller: () => HTMLElement | null;
  scrollItemTo: (itemIndex: number, topPx: number) => void;
}

/** The row's offset from the scroller's viewport top, or null when the
 *  virtualizer doesn't have it rendered. May be negative / beyond the
 *  viewport — the restore math wants the position either way. */
function rowViewportTop(
  scroller: HTMLElement,
  fileIndex: number,
  anchor: string
): number | null {
  const el = scroller.querySelector(
    `[data-file-index="${fileIndex}"][data-anchor="${anchor}"]`
  );
  if (!el) {
    return null;
  }
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

function rowIsInView(scroller: HTMLElement, top: number | null): boolean {
  return (
    top !== null && top > -1 && top < scroller.getBoundingClientRect().height
  );
}

/**
 * The row to hold steady through a row swap: the keyboard cursor's row when
 * it's in view — that's where the reader's attention is — otherwise the first
 * visible row.
 */
function captureAnchorRow(
  listRef: React.RefObject<ExpansionListHandle | null>,
  cursor: { anchor: string; fileIndex: number } | null,
  preSwap: boolean
): CapturedRow | null {
  const scroller = listRef.current?.scroller() ?? null;
  if (scroller && cursor) {
    const top = rowViewportTop(scroller, cursor.fileIndex, cursor.anchor);
    if (rowIsInView(scroller, top) && top !== null) {
      return {
        anchor: cursor.anchor,
        fileIndex: cursor.fileIndex,
        preSwap,
        top,
      };
    }
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
  const pendingRestoreRef = useRef<CapturedRow | null>(null);

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

  /**
   * Warm the active file's blob so pressing expand is a same-frame swap, not
   * a fetch — the no-loading-states answer to loading. Debounced: j/k and Tab
   * sweep the active file across the PR; only a file you settle on fetches.
   */
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
   * shows the old rows and the scroll anchor can be captured. Re-runs every
   * render; the `has` guards make it converge.
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
      pendingRestoreRef.current ??= captureAnchorRow(
        listRef,
        cursorRef.current,
        true
      );
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
      pendingRestoreRef.current ??= captureAnchorRow(
        listRef,
        cursorRef.current,
        false
      );
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

const RESTORE_HOLD_FRAMES = 20;
const REVEAL_QUIET_FRAMES = 3;
const REVEAL_MIN_FRAMES = 6;

/**
 * The restore half of the scroll-anchoring contract: whenever a capture is
 * pending, put the captured row back at its captured viewport offset in the
 * model that just rendered. Called by the review screen after its model ref
 * exists, so the anchor lookup sees the post-swap items.
 *
 * The mechanism is a plain scrollTop delta from a synchronous pre-paint DOM
 * measurement — the row was visible before the swap, so with the overscan it
 * is almost always still rendered after, and correcting before paint means
 * the reader never sees it move. The virtualizer's scrollToIndex is only the
 * fallback for a row that left the render window, and it is NOT trusted for
 * final placement: it estimates item heights, and its own late corrections
 * would fight a competing delta.
 *
 * The position is then held against the virtualizer re-measuring the freshly
 * inserted rows. This is the flash-critical part. When the swap inserts rows
 * above the anchor, react-virtuoso first paints them at their estimated
 * (defaultItemHeight) size, then re-measures them to their real height a frame
 * later: the inner item-list grows before the compensating re-anchor lands, so
 * the anchor row visibly drops (~77px) for a frame. Every after-the-fact hook
 * (scroll, ResizeObserver, rAF) fires only once that bad frame has painted, so
 * it can correct the position but not stop the flash.
 *
 * So the swap is masked instead of chased: the scroller is made invisible (but
 * still laid out and measurable) synchronously before the first paint, held
 * invisible while the virtualizer settles, and revealed only once the anchor
 * row has held its captured offset for two consecutive frames — the reader
 * never sees an intermediate frame. A ResizeObserver on the inner item-list
 * plus an rAF loop drive the correction under the mask; a frame cap guarantees
 * the content is always revealed even if it never fully settles. `onRestored`
 * fires once on reveal — the screen uses it to flash the row, the "you are
 * here" cue.
 *
 * The transient `qf-swapin` class on the scroller scopes the synthesized
 * rows' materialize animation to the swap itself — rows the virtualizer
 * mounts later, while scrolling, must not re-fade.
 */
export function useExpansionScrollRestore(
  pendingRestoreRef: React.RefObject<CapturedRow | null>,
  modelRef: React.RefObject<ReviewListModel>,
  listRef: React.RefObject<ExpansionListHandle | null>,
  onRestored: (row: CapturedRow) => void
): void {
  const onRestoredRef = useLatest(onRestored);
  useLayoutEffect(() => {
    const captured = pendingRestoreRef.current;
    if (!captured) {
      return;
    }
    if (captured.preSwap) {
      captured.preSwap = false;
      return;
    }
    pendingRestoreRef.current = null;

    const swapScroller = listRef.current?.scroller() ?? null;
    if (swapScroller) {
      swapScroller.classList.add("qf-swapin", "qf-swap-mask");
      setTimeout(() => swapScroller.classList.remove("qf-swapin"), 300);
    }

    // Temporary diagnostic for the off-center cursor drift (PR #47 known
    // issue): logs each correction pass so a manual run shows whether the
    // drift oscillates in sign (fighting the re-measure) or overshoots
    // monotonically (bad offset math). Dev builds only — remove once the
    // restore approach is settled.
    const probe = (source: string, drift: number | null) => {
      if (!import.meta.env.DEV) {
        return;
      }
      console.debug("[expand-restore]", source, {
        anchor: `${captured.fileIndex}/${captured.anchor}`,
        capturedTop: captured.top,
        drift,
        scrollTop: listRef.current?.scroller()?.scrollTop,
      });
    };

    let indexJumpUsed = false;
    // The row's distance from its captured offset after a correction pass, or
    // null when the row isn't rendered (the index-jump fallback path).
    const correct = (): number | null => {
      const scroller = listRef.current?.scroller() ?? null;
      if (!scroller) {
        return null;
      }
      const top = rowViewportTop(scroller, captured.fileIndex, captured.anchor);
      if (top === null) {
        if (!indexJumpUsed) {
          indexJumpUsed = true;
          const itemIndex = restoreItemIndex(modelRef.current, captured);
          if (itemIndex !== undefined) {
            listRef.current?.scrollItemTo(itemIndex, captured.top);
          }
        }
        return null;
      }
      if (Math.abs(top - captured.top) > 1) {
        scroller.scrollTop += top - captured.top;
        return top - captured.top;
      }
      return 0;
    };

    const reveal = () => {
      probe("reveal", null);
      swapScroller?.classList.remove("qf-swap-mask");
      observer?.disconnect();
      onRestoredRef.current(captured);
    };

    probe("init", correct());

    // Drive the correction under the mask: the virtualizer's re-measure grows
    // the inner item-list, so a ResizeObserver on it re-pins the anchor as the
    // list settles; the rAF loop backstops re-measures that don't resize the
    // observed box. A resize also means the list is still settling, so the
    // reveal waits for it to go quiet — the re-measures arrive over several
    // frames, not just the first.
    const scroller = listRef.current?.scroller() ?? null;
    const innerList =
      scroller?.querySelector<HTMLElement>(
        '[data-testid="virtuoso-item-list"]'
      ) ?? null;
    // Start "hot": the first re-measure is expected but arrives a frame or two
    // late, so the reveal must not fire in the quiet gap before it lands.
    let framesSinceResize = -REVEAL_MIN_FRAMES;
    const observer = innerList
      ? new ResizeObserver(() => {
          framesSinceResize = 0;
          probe("resize", correct());
        })
      : null;
    observer?.observe(innerList as HTMLElement);

    let frames = 0;
    const hold = () => {
      frames += 1;
      framesSinceResize += 1;
      const drift = correct();
      probe(`frame ${frames}`, drift);
      const settled =
        drift === 0 &&
        frames >= REVEAL_MIN_FRAMES &&
        framesSinceResize >= REVEAL_QUIET_FRAMES;
      if (settled || frames >= RESTORE_HOLD_FRAMES) {
        reveal();
        return;
      }
      requestAnimationFrame(hold);
    };
    requestAnimationFrame(hold);
  });
}

function restoreItemIndex(
  m: ReviewListModel,
  captured: CapturedRow
): number | undefined {
  const exact = m.anchorItem.get(
    fileAnchorKey(captured.fileIndex, captured.anchor)
  );
  if (exact !== undefined) {
    return exact;
  }
  const side = captured.anchor.slice(0, captured.anchor.indexOf(":"));
  const line = anchorLine(captured.anchor);
  let best: number | undefined;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const entry of m.nav) {
    if (entry.fileIndex !== captured.fileIndex) {
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
