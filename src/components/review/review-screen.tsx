import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Copy,
  ExternalLink,
  FileSearch,
  GitBranch,
  Inbox,
  Info,
  Link,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Send,
  TextSearch,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useCommentMutations } from "../../hooks/use-comments.ts";
import { useInboxDetailNudge } from "../../hooks/use-inbox-detail-nudge.ts";
import { useLatest } from "../../hooks/use-latest.ts";
import { usePullRequestDetail } from "../../hooks/use-pull-request-detail.ts";
import { useReviewHeadShaSync } from "../../hooks/use-review-head-sha-sync.ts";
import { useViewedFileReconcile } from "../../hooks/use-viewed-file-reconcile.ts";
import type { Binding } from "../../keyboard/types.ts";
import { useHotkeys } from "../../keyboard/use-hotkeys.ts";
import { cn } from "../../lib/cn.ts";
import { type FindMatch, findInDiff } from "../../lib/find-in-diff.ts";
import { warmHighlightCache } from "../../lib/highlight.ts";
import { isImageFile } from "../../lib/image-file.ts";
import {
  type OccurrenceMatch,
  type OccurrenceSpec,
  occurrenceMatches,
  occurrenceSpecFromSelection,
} from "../../lib/occurrences.ts";
import { usePerfStore } from "../../lib/perf.ts";
import { queryClient, queryKeys } from "../../lib/query-client.ts";
import {
  adjacentSelectableAnchor,
  anchorLine,
  buildReviewItems,
  fileAnchorKey,
  type ReviewListModel,
} from "../../lib/review-items.ts";
import {
  getReviewMemory,
  updateReviewMemory,
} from "../../lib/review-memory.ts";
import { fingerprintFile } from "../../lib/viewed-fingerprint.ts";
import { useAppStore } from "../../store/app-store.ts";
import type {
  ChangedFile,
  InboxBucket,
  InboxData,
  PendingComment,
  PullRequest,
  ReviewComment,
  ReviewEvent,
} from "../../types.ts";
import { parsePrKey, prKey } from "../../types.ts";
import { Avatar } from "../ui/avatar.tsx";
import { Kbd } from "../ui/kbd.tsx";
import { TicketTitle } from "../ui/ticket-title.tsx";
import { FileSidebar } from "./file-sidebar.tsx";
import { FindBar } from "./find-bar.tsx";
import { OverviewRuler } from "./overview-ruler.tsx";
import { PrSearch } from "./pr-search.tsx";
import {
  type FindCurrent,
  type MarkSpec,
  ReviewList,
  type ReviewListCallbacks,
  type ReviewListHandle,
} from "./review-list.tsx";
import { ReviewVerdicts } from "./review-verdicts.tsx";
import { RightPanel } from "./right-panel.tsx";
import { SubmitReviewModal } from "./submit-review-modal.tsx";

const RE_WORD = /\w/;
const RE_WORD_2 = /\w/;

/**
 * Full-screen PR review: a virtualized diff list, keyboard cursor, multi-line
 * selection, find-in-diff, and inline comment threads.
 *
 * Interaction model:
 * - The line cursor (j/k, hover, jumps) is the source of truth for the active
 *   file — wheel scrolling alone does not move it.
 * - Collapsed hunks and open composers feed the flattened item model.
 * - Multi-line selection (shift+j/k, gutter drag) is independent of the
 *   cursor once created; plain cursor moves collapse it.
 * - Find-in-diff (mod+f) seeds from the viewport, not the top of the PR.
 */
interface ReviewScreenProps {
  routeKey: string;
}

type OccState = OccurrenceSpec & { fileIndex: number };

interface CursorPos {
  anchor: string;
  fileIndex: number;
}

/** A multi-line comment range: a one-side, hunk-contiguous run of rows.
 *  `from` is the fixed end (where extension started), `to` the moving end. */
interface LineSelection {
  fileIndex: number;
  from: string;
  hunkIndex: number;
  side: string;
  to: string;
}

const EMPTY_COMMENTS: ReviewComment[] = [];
const EMPTY_PENDING: PendingComment[] = [];
const EMPTY_MATCHES: FindMatch[] = [];
const EMPTY_OCC: OccurrenceMatch[] = [];
const EMPTY_FRACTIONS: number[] = [];
const EMPTY_COLLAPSED: ReadonlyMap<number, ReadonlySet<number>> = new Map();

const SIDEBAR_SKELETON_WIDTHS = [88, 72, 56, 40, 88, 72, 56, 40, 88] as const;
const MAIN_SKELETON_WIDTHS = Array.from(
  { length: 16 },
  (_, index) => ((index * 37) % 52) + 32
);

function copyTextToClipboard(text: string): void {
  navigator.clipboard?.writeText(text).catch(() => undefined);
}

function resolveMarks(
  findOpen: boolean,
  findQuery: string,
  findCase: boolean,
  occSpec: OccState | null
): MarkSpec | null {
  if (findOpen) {
    if (findQuery) {
      return { caseSensitive: findCase, kind: "find", query: findQuery };
    }
    return null;
  }
  if (occSpec) {
    return {
      fileIndex: occSpec.fileIndex,
      kind: "occurrence",
      query: occSpec.query,
      wholeWord: occSpec.wholeWord,
    };
  }
  return null;
}

function resolveRulerFractions(
  model: ReviewListModel,
  findOpen: boolean,
  findQuery: string,
  findMatches: FindMatch[],
  occSpec: OccState | null,
  occMatchList: OccurrenceMatch[]
): number[] {
  if (model.items.length === 0) {
    return EMPTY_FRACTIONS;
  }
  if (findOpen && findQuery) {
    return findMatches.map((m) => {
      const idx = model.anchorItem.get(fileAnchorKey(m.fileIndex, m.anchor));
      return idx === undefined ? -1 : idx / model.items.length;
    });
  }
  if (occSpec) {
    return occMatchList.map((m) => {
      const idx = model.anchorItem.get(
        fileAnchorKey(occSpec.fileIndex, m.anchor)
      );
      return idx === undefined ? -1 : idx / model.items.length;
    });
  }
  return EMPTY_FRACTIONS;
}

function resolvePrStateClass(pr: PullRequest): string {
  if (pr.draft) {
    return "qf-state-draft";
  }
  if (pr.merged) {
    return "qf-state-merged";
  }
  if (pr.state === "open") {
    return "qf-state-open";
  }
  return "qf-state-draft";
}

function resolvePrStateLabel(pr: PullRequest): string {
  if (pr.draft) {
    return "Draft";
  }
  if (pr.merged) {
    return "Merged";
  }
  if (pr.state === "open") {
    return "Open";
  }
  return pr.state;
}

function cursorRepeatMultiplier(held: number): number {
  if (held >= 24) {
    return 6;
  }
  if (held >= 8) {
    return 3;
  }
  return 1;
}

function codeAround(el: Element | null | undefined): Element | null {
  const code = el?.closest(".qf-code") ?? null;
  return code && !el?.closest(".qf-row-hunk") ? code : null;
}

/** Resolve the code cell under a pointer, including trailing padding where
 *  `elementFromPoint` returns null because no glyph is painted there. */
function codeAtPoint(x: number, y: number): Element | null {
  const fromTarget = codeAround(document.elementFromPoint(x, y));
  if (fromTarget) {
    return fromTarget;
  }
  for (const row of document.querySelectorAll(".qf-row:not(.qf-row-hunk)")) {
    const code = row.querySelector(".qf-code");
    if (!code) {
      continue;
    }
    const box = code.getBoundingClientRect();
    if (y >= box.top && y <= box.bottom && x >= box.left && x <= box.right) {
      return code;
    }
  }
  return null;
}

/** True when a click lands in the code cell's trailing padding, past the text. */
function isPastLineContent(code: Element, x: number, y: number): boolean {
  const box = code.getBoundingClientRect();
  if (y < box.top || y > box.bottom) {
    return false;
  }
  if (x >= box.right - 12) {
    return true;
  }
  let maxRight = box.left;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.textContent?.trim()) {
      continue;
    }
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of range.getClientRects()) {
      maxRight = Math.max(maxRight, rect.right);
    }
  }
  return x > maxRight + 2;
}

function fileIndexOfElement(el: Element): number | null {
  const v = el.closest("[data-file-index]")?.getAttribute("data-file-index");
  const n = v === null ? Number.NaN : Number(v);
  return Number.isFinite(n) ? n : null;
}

function caretNodeAtPoint(
  x: number,
  y: number
): { node: Node; offset: number } | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (doc.caretPositionFromPoint) {
    const pos = doc.caretPositionFromPoint(x, y);
    if (pos) {
      const { offset, offsetNode } = pos;
      return { node: offsetNode, offset };
    }
    return null;
  }
  if (doc.caretRangeFromPoint) {
    const r = doc.caretRangeFromPoint(x, y);
    if (r) {
      return { node: r.startContainer, offset: r.startOffset };
    }
  }
  return null;
}

function wordBoundsInText(text: string, col: number): [number, number] | null {
  let s = col;
  let e = col;
  while (s > 0 && RE_WORD.test(text[s - 1])) {
    s -= 1;
  }
  while (e < text.length && RE_WORD_2.test(text[e])) {
    e += 1;
  }
  if (s === e) {
    return null;
  }
  return [s, e];
}

function occurrenceOriginFromPoint(
  x: number,
  y: number
): { anchor: string; column: number } | null {
  const caret = caretNodeAtPoint(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const code = codeAround(caret.node.parentElement);
  if (!code) {
    return null;
  }
  const anchor = caret.node.parentElement
    ?.closest("[data-anchor]")
    ?.getAttribute("data-anchor");
  if (!anchor) {
    return null;
  }
  const nodeStart = codeColumnOf(code, caret.node);
  if (nodeStart === null) {
    return null;
  }
  const text = code.textContent ?? "";
  const col = nodeStart + caret.offset;
  const bounds = wordBoundsInText(text, col);
  return { anchor, column: bounds ? bounds[0] : col };
}

function wordAtPoint(x: number, y: number): OccState | null {
  const caret = caretNodeAtPoint(x, y);
  if (!caret || caret.node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const parent = caret.node.parentElement;
  if (!parent) {
    return null;
  }
  const code = codeAround(parent);
  if (!code) {
    return null;
  }
  const fileIndex = fileIndexOfElement(code);
  if (fileIndex === null) {
    return null;
  }

  const text = code.textContent ?? "";
  const nodeStart = codeColumnOf(code, caret.node);
  if (nodeStart === null) {
    return null;
  }
  const bounds = wordBoundsInText(text, nodeStart + caret.offset);
  if (!bounds) {
    return null;
  }
  const [s, e] = bounds;

  const start = codePositionAt(code, s);
  const end = codePositionAt(code, e);
  if (!(start && end)) {
    return null;
  }
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  const hit = Array.from(range.getClientRects()).some(
    (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  );
  if (!hit) {
    return null;
  }
  const spec = occurrenceSpecFromSelection(text.slice(s, e));
  return spec ? { ...spec, fileIndex } : null;
}

function specFromDomSelection(): OccState | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return null;
  }
  const container = sel.getRangeAt(0).commonAncestorContainer;
  const el = container instanceof Element ? container : container.parentElement;

  const code = codeAround(el);
  if (!code) {
    return null;
  }
  const fileIndex = fileIndexOfElement(code);
  if (fileIndex === null) {
    return null;
  }
  const spec = occurrenceSpecFromSelection(sel.toString());
  return spec ? { ...spec, fileIndex } : null;
}

function extendExistingSelection(
  sel: LineSelection,
  delta: 1 | -1,
  m: ReviewListModel,
  listRef: React.RefObject<ReviewListHandle | null>,
  setSelection: (s: LineSelection | null) => void,
  setCursor: React.Dispatch<React.SetStateAction<CursorPos | null>>
): boolean {
  const next = adjacentSelectableAnchor(
    m,
    sel.fileIndex,
    sel.side,
    sel.hunkIndex,
    sel.to,
    delta
  );
  if (!next) {
    return true;
  }
  if (next === sel.from) {
    setSelection(null);
    setCursor({ anchor: next, fileIndex: sel.fileIndex });
    return true;
  }
  setSelection({ ...sel, to: next });
  setCursor({ anchor: next, fileIndex: sel.fileIndex });
  const itemIndex = m.anchorItem.get(fileAnchorKey(sel.fileIndex, next));
  if (itemIndex !== undefined) {
    listRef.current?.nudgeItemIntoView(itemIndex);
  }
  return true;
}

function startSelectionFromCursor(
  cur: CursorPos,
  delta: 1 | -1,
  m: ReviewListModel,
  listRef: React.RefObject<ReviewListHandle | null>,
  setSelection: (s: LineSelection) => void,
  setCursor: React.Dispatch<React.SetStateAction<CursorPos | null>>
): void {
  const item =
    m.items[m.anchorItem.get(fileAnchorKey(cur.fileIndex, cur.anchor)) ?? -1];
  if (item?.kind !== "row" || item.target === null) {
    return;
  }
  const next = adjacentSelectableAnchor(
    m,
    cur.fileIndex,
    item.target.side,
    item.hunkIndex,
    cur.anchor,
    delta
  );
  if (!next) {
    return;
  }
  setSelection({
    fileIndex: cur.fileIndex,
    from: cur.anchor,
    hunkIndex: item.hunkIndex,
    side: item.target.side,
    to: next,
  });
  setCursor({ anchor: next, fileIndex: cur.fileIndex });
  const itemIndex = m.anchorItem.get(fileAnchorKey(cur.fileIndex, next));
  if (itemIndex !== undefined) {
    listRef.current?.nudgeItemIntoView(itemIndex);
  }
}

function jumpFromOccMark(
  mark: Element,
  occNav: OccNav,
  occNavRef: React.RefObject<number>
): boolean {
  const code = codeAround(mark);
  const anchor = mark.closest("[data-anchor]")?.getAttribute("data-anchor");
  const textNode = mark.firstChild;
  if (!(code && anchor && textNode)) {
    return false;
  }
  const column = codeColumnOf(code, textNode);
  const at = column === null ? -1 : occNav.indexAt(anchor, column);
  occNav.jumpTo((at >= 0 ? at : occNavRef.current) + 1);
  return true;
}

function handleOccPointerClick(
  e: MouseEvent,
  findOpenRef: React.RefObject<boolean>,
  occSpecRef: React.RefObject<OccState | null>,
  occNav: OccNav,
  occNavRef: React.RefObject<number>,
  commit: (
    next: OccState | null,
    origin?: { anchor: string; column: number } | null
  ) => void
): void {
  if (findOpenRef.current) {
    return;
  }
  if (e.detail > 1) {
    return;
  }
  const target = e.target instanceof Element ? e.target : null;
  const row = target?.closest(".qf-row:not(.qf-row-hunk)");
  const code = codeAtPoint(e.clientX, e.clientY);
  if (!(row || code)) {
    if (occSpecRef.current) {
      window.getSelection()?.removeAllRanges();
      commit(null);
    }
    return;
  }

  const mark = target?.closest("mark.qf-occ-mark");
  if (mark && occSpecRef.current && jumpFromOccMark(mark, occNav, occNavRef)) {
    return;
  }

  if (!code) {
    window.getSelection()?.removeAllRanges();
    commit(null);
    return;
  }

  window.getSelection()?.removeAllRanges();
  const clickOrigin = occurrenceOriginFromPoint(e.clientX, e.clientY);
  if (isPastLineContent(code, e.clientX, e.clientY)) {
    commit(null);
    return;
  }
  const spec = wordAtPoint(e.clientX, e.clientY);
  if (!spec) {
    commit(null);
    return;
  }
  commit(spec, clickOrigin);
}

function useOccurrenceTracking(refs: {
  findOpenRef: React.RefObject<boolean>;
  occMatchListRef: React.RefObject<OccurrenceMatch[]>;
  occNavRef: React.RefObject<number>;
  occOriginRef: React.RefObject<{ anchor: string; column: number } | null>;
  occRestoreRef: React.RefObject<CapturedSelection | null>;
  occSpecRef: React.RefObject<OccState | null>;
  selectLineRef: React.RefObject<
    (
      fileIndex: number,
      anchor: string,
      opts?: { keepOccurrences?: boolean }
    ) => void
  >;
  setOccSpec: (next: OccState | null) => void;
}): void {
  const {
    findOpenRef,
    occMatchListRef,
    occNavRef,
    occOriginRef,
    occRestoreRef,
    occSpecRef,
    selectLineRef,
    setOccSpec,
  } = refs;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const occNav = buildOccNav({
      occMatchListRef,
      occNavRef,
      occOriginRef,
      occSpecRef,
      selectLineRef,
    });

    function commit(
      next: OccState | null,
      origin?: { anchor: string; column: number } | null
    ) {
      const prev = occSpecRef.current;
      occOriginRef.current = next
        ? (origin ?? occurrenceOriginFromDom())
        : null;
      occNavRef.current = -1;
      if (
        prev &&
        next &&
        prev.query === next.query &&
        prev.wholeWord === next.wholeWord &&
        prev.fileIndex === next.fileIndex
      ) {
        return;
      }
      if (prev === next) {
        return;
      }
      occRestoreRef.current = captureCodeSelection();
      setOccSpec(next);
    }

    function apply() {
      timer = null;
      if (findOpenRef.current) {
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        return;
      }
      commit(specFromDomSelection());
    }

    function onSelectionChange() {
      if (timer !== null) {
        clearTimeout(timer);
      }
      timer = setTimeout(apply, 150);
    }

    function onOccClick(e: MouseEvent) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      handleOccPointerClick(
        e,
        findOpenRef,
        occSpecRef,
        occNav,
        occNavRef,
        commit
      );
    }

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("click", onOccClick);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("click", onOccClick);
      if (timer !== null) {
        clearTimeout(timer);
      }
    };
  }, [
    findOpenRef,
    occMatchListRef,
    occNavRef,
    occOriginRef,
    occRestoreRef,
    occSpecRef,
    selectLineRef,
    setOccSpec,
  ]);
}

function isRealPointer(
  x: number,
  y: number,
  keyboardHoldRef: React.RefObject<boolean>,
  lastPointRef: React.RefObject<{ x: number; y: number } | null>
): boolean {
  if (!keyboardHoldRef.current) {
    lastPointRef.current = { x, y };
    return true;
  }
  const last = lastPointRef.current;
  if (!last) {
    lastPointRef.current = { x, y };
    return false;
  }
  if (Math.abs(x - last.x) + Math.abs(y - last.y) > 6) {
    keyboardHoldRef.current = false;
    lastPointRef.current = { x, y };
    return true;
  }
  return false;
}

interface ReviewListCallbackArgs {
  activeThreadRef: React.RefObject<{ rootId: number; path: string } | null>;
  addPendingStore: (
    key: string,
    c: {
      path: string;
      line: number;
      side: string;
      body: string;
      startLine?: number;
    }
  ) => void;
  addReviewComment: ReturnType<typeof useCommentMutations>["addReviewComment"];
  copyTimerRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  dragRef: React.RefObject<{
    fileIndex: number;
    side: string;
    hunkIndex: number;
    from: string;
  } | null>;
  filesRef: React.RefObject<ChangedFile[]>;
  handleListScroll: () => void;
  headShaRef: React.RefObject<string>;
  isRealPointerAt: (x: number, y: number) => boolean;
  keyboardHoldRef: React.RefObject<boolean>;
  keyValue: string;
  lastPointRef: React.RefObject<{ x: number; y: number } | null>;
  liveSelectionRef: React.RefObject<{
    endItem: number;
    fileIndex: number;
    fromItem: number;
    hunkIndex: number;
    side: string;
    toItem: number;
  } | null>;
  modelRef: React.RefObject<ReviewListModel>;
  removePendingStore: (key: string, id: string) => void;
  reply: ReturnType<typeof useCommentMutations>["reply"];
  resolveThread: ReturnType<typeof useCommentMutations>["resolveThread"];
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  setChangedSinceViewed: React.Dispatch<React.SetStateAction<Set<string>>>;
  setCollapsed: React.Dispatch<
    React.SetStateAction<ReadonlyMap<number, ReadonlySet<number>>>
  >;
  setCopiedPathIndex: React.Dispatch<React.SetStateAction<number | null>>;
  setCursor: React.Dispatch<React.SetStateAction<CursorPos | null>>;
  setDragging: React.Dispatch<React.SetStateAction<boolean>>;
  setInputMode: React.Dispatch<React.SetStateAction<"keyboard" | "mouse">>;
  setOpenBoxes: React.Dispatch<
    React.SetStateAction<ReadonlyMap<string, number | null>>
  >;
  setSelection: (s: LineSelection | null) => void;
  toggleViewed: (key: string, filename: string, fingerprint: string) => void;
}

function reviewListOnCopyPath(
  args: ReviewListCallbackArgs,
  fileIndex: number
): void {
  const f = args.filesRef.current[fileIndex];
  if (!f) {
    return;
  }
  copyTextToClipboard(f.filename);
  args.setCopiedPathIndex(fileIndex);
  if (args.copyTimerRef.current) {
    clearTimeout(args.copyTimerRef.current);
  }
  args.copyTimerRef.current = setTimeout(
    () => args.setCopiedPathIndex(null),
    1200
  );
}

function reviewListOnPlusDragEnd(
  args: ReviewListCallbackArgs,
  openBox: (fileIndex: number, anchor: string, startLine?: number) => void
): void {
  const d = args.dragRef.current;
  args.dragRef.current = null;
  args.setDragging(false);
  if (!d) {
    return;
  }
  const live = args.liveSelectionRef.current;
  const m = args.modelRef.current;
  if (live && live.fileIndex === d.fileIndex) {
    const endItem = m.items[live.toItem];
    const startItem = m.items[live.fromItem];
    if (
      endItem?.kind === "row" &&
      endItem.anchor &&
      startItem?.kind === "row"
    ) {
      openBox(
        d.fileIndex,
        endItem.anchor,
        anchorLine(startItem.anchor ?? endItem.anchor)
      );
      return;
    }
  }
  openBox(d.fileIndex, d.from);
}

function reviewListOnPlusDragStart(
  args: ReviewListCallbackArgs,
  fileIndex: number,
  anchor: string
): void {
  const m = args.modelRef.current;
  const item =
    m.items[m.anchorItem.get(fileAnchorKey(fileIndex, anchor)) ?? -1];
  if (item?.kind !== "row" || item.target === null) {
    return;
  }
  args.dragRef.current = {
    fileIndex,
    from: anchor,
    hunkIndex: item.hunkIndex,
    side: item.target.side,
  };
  args.setDragging(true);
}

function reviewListOnThreadHover(
  args: ReviewListCallbackArgs,
  t: { rootId: number; path: string } | null
): void {
  args.activeThreadRef.current = t;
}

function syncActiveIndexRef(
  activeIndexRef: React.RefObject<number>,
  target: number
): void {
  activeIndexRef.current = target;
}

function markKeyboardNavigation(args: {
  keyboardHoldRef: React.RefObject<boolean>;
  setInputMode: React.Dispatch<React.SetStateAction<"keyboard" | "mouse">>;
}): void {
  args.keyboardHoldRef.current = true;
  args.setInputMode("keyboard");
}

function reviewListOnOpenBox(
  args: ReviewListCallbackArgs,
  fileIndex: number,
  anchor: string,
  startLine?: number
): void {
  args.setOpenBoxes((prev) =>
    new Map(prev).set(fileAnchorKey(fileIndex, anchor), startLine ?? null)
  );
}

function reviewListOnPlusDragOver(
  args: ReviewListCallbackArgs,
  fileIndex: number,
  anchor: string
): void {
  const d = args.dragRef.current;
  if (!d || fileIndex !== d.fileIndex) {
    return;
  }
  args.setCursor({ anchor, fileIndex });
  if (anchor === d.from) {
    args.setSelection(null);
    return;
  }

  const m = args.modelRef.current;
  const fromIdx = m.navIndexOf.get(fileAnchorKey(fileIndex, d.from));
  const toIdx = m.navIndexOf.get(fileAnchorKey(fileIndex, anchor));
  if (fromIdx === undefined || toIdx === undefined) {
    return;
  }
  const delta = toIdx > fromIdx ? (1 as const) : (-1 as const);
  let last = d.from;
  while (last !== anchor) {
    const next = adjacentSelectableAnchor(
      m,
      d.fileIndex,
      d.side,
      d.hunkIndex,
      last,
      delta
    );
    if (!next) {
      break;
    }
    last = next;
  }
  if (last === d.from) {
    args.setSelection(null);
    return;
  }
  args.setSelection({
    fileIndex: d.fileIndex,
    from: d.from,
    hunkIndex: d.hunkIndex,
    side: d.side,
    to: last,
  });
}

function useReviewListCallbacks(
  args: ReviewListCallbackArgs
): ReviewListCallbacks {
  const cbRef = useLatest({
    async onAddComment(a: {
      path: string;
      line: number;
      side: string;
      body: string;
      startLine?: number;
    }) {
      await args.addReviewComment.mutateAsync({
        body: a.body,
        commitId: args.headShaRef.current,
        line: a.line,
        path: a.path,
        side: a.side,
        startLine: a.startLine,
      });
    },
    onAddPending(c: {
      path: string;
      line: number;
      side: string;
      body: string;
      startLine?: number;
    }) {
      args.addPendingStore(args.keyValue, c);
    },
    onCloseBox(fileIndex: number, anchor: string) {
      args.setOpenBoxes((prev) => {
        const next = new Map(prev);
        next.delete(fileAnchorKey(fileIndex, anchor));
        return next;
      });
      args.setSelection(null);
    },
    onCopyPath(fileIndex: number) {
      reviewListOnCopyPath(args, fileIndex);
    },
    onMouseMove(x: number, y: number) {
      if (!args.isRealPointerAt(x, y)) {
        return;
      }
      args.setInputMode((mo) => (mo === "mouse" ? mo : "mouse"));
    },
    onOpenBox(fileIndex: number, anchor: string, startLine?: number) {
      reviewListOnOpenBox(args, fileIndex, anchor, startLine);
    },
    onPlusDragEnd() {
      reviewListOnPlusDragEnd(args, (fi, a, sl) =>
        cbRef.current.onOpenBox(fi, a, sl)
      );
    },
    onPlusDragOver(fileIndex: number, anchor: string) {
      reviewListOnPlusDragOver(args, fileIndex, anchor);
    },
    onPlusDragStart(fileIndex: number, anchor: string) {
      reviewListOnPlusDragStart(args, fileIndex, anchor);
    },
    onRemovePending(id: string) {
      args.removePendingStore(args.keyValue, id);
    },
    async onReply(a: { inReplyTo: number; body: string }) {
      await args.reply.mutateAsync(a);
    },
    onResolveThread(a: { threadId: string; resolved: boolean }) {
      args.resolveThread.mutate(a);
    },
    onRowEnter(fileIndex: number, anchor: string, x: number, y: number) {
      if (!args.isRealPointerAt(x, y)) {
        return;
      }
      args.setInputMode((mo: "keyboard" | "mouse") =>
        mo === "mouse" ? mo : "mouse"
      );
      args.setCursor((cur: CursorPos | null) =>
        cur && cur.fileIndex === fileIndex && cur.anchor === anchor
          ? cur
          : { anchor, fileIndex }
      );
      args.setActiveIndex((cur) => (cur === fileIndex ? cur : fileIndex));
    },
    onScroll() {
      args.handleListScroll();
    },
    onThreadHover(t: { rootId: number; path: string } | null) {
      reviewListOnThreadHover(args, t);
    },
    onToggleHunk(fileIndex: number, hunkIndex: number) {
      args.setCollapsed((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(fileIndex) ?? []);
        if (set.has(hunkIndex)) {
          set.delete(hunkIndex);
        } else {
          set.add(hunkIndex);
        }
        next.set(fileIndex, set);
        return next;
      });
    },
    onToggleViewed(fileIndex: number) {
      const f = args.filesRef.current[fileIndex];
      if (!f) {
        return;
      }
      args.toggleViewed(
        args.keyValue,
        f.filename,
        fingerprintFile(f, args.headShaRef.current)
      );
      args.setChangedSinceViewed((prev) => {
        if (!prev.has(f.filename)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(f.filename);
        return next;
      });
    },
  });

  const [listCallbacks] = useState<ReviewListCallbacks>(() => {
    const r = cbRef;
    return {
      onAddComment: (...a) => r.current.onAddComment(...a),
      onAddPending: (...a) => r.current.onAddPending(...a),
      onCloseBox: (...a) => r.current.onCloseBox(...a),
      onCopyPath: (...a) => r.current.onCopyPath(...a),
      onMouseMove: (...a) => r.current.onMouseMove(...a),
      onOpenBox: (...a) => r.current.onOpenBox(...a),
      onPlusDragEnd: () => r.current.onPlusDragEnd(),
      onPlusDragOver: (...a) => r.current.onPlusDragOver(...a),
      onPlusDragStart: (...a) => r.current.onPlusDragStart(...a),
      onRemovePending: (...a) => r.current.onRemovePending(...a),
      onReply: (...a) => r.current.onReply(...a),
      onResolveThread: (...a) => r.current.onResolveThread(...a),
      onRowEnter: (...a) => r.current.onRowEnter(...a),
      onScroll: () => r.current.onScroll(),
      onThreadHover: (...a) => r.current.onThreadHover(...a),
      onToggleHunk: (...a) => r.current.onToggleHunk(...a),
      onToggleViewed: (...a) => r.current.onToggleViewed(...a),
    };
  });

  return listCallbacks;
}

function resolveLiveSelection(
  selection: LineSelection | null,
  model: ReviewListModel
): {
  endItem: number;
  fileIndex: number;
  fromItem: number;
  hunkIndex: number;
  side: string;
  toItem: number;
} | null {
  if (!selection) {
    return null;
  }
  const a = model.anchorItem.get(
    fileAnchorKey(selection.fileIndex, selection.from)
  );
  const b = model.anchorItem.get(
    fileAnchorKey(selection.fileIndex, selection.to)
  );
  if (a === undefined || b === undefined || a === b) {
    return null;
  }
  return {
    endItem: b,
    fileIndex: selection.fileIndex,
    fromItem: Math.min(a, b),
    hunkIndex: selection.hunkIndex,
    side: selection.side,
    toItem: Math.max(a, b),
  };
}

function commentAtCursorPos(
  modelRef: React.RefObject<ReviewListModel>,
  liveSelectionRef: React.RefObject<ReturnType<typeof resolveLiveSelection>>,
  cursorRef: React.RefObject<CursorPos | null>,
  activeIndexRef: React.RefObject<number>,
  setCursor: React.Dispatch<React.SetStateAction<CursorPos | null>>,
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>,
  onOpenBox: ReviewListCallbacks["onOpenBox"]
): void {
  const m = modelRef.current;

  const sel = liveSelectionRef.current;
  if (sel) {
    const endItem = m.items[sel.toItem];
    const startItem = m.items[sel.fromItem];
    if (
      endItem?.kind === "row" &&
      endItem.anchor !== null &&
      startItem?.kind === "row" &&
      startItem.anchor !== null
    ) {
      onOpenBox(sel.fileIndex, endItem.anchor, anchorLine(startItem.anchor));
      return;
    }
  }
  const cur = cursorRef.current;
  const entry = cur ?? m.nav[0];
  if (!entry) {
    return;
  }
  if (!cur) {
    setCursor({ anchor: entry.anchor, fileIndex: entry.fileIndex });
    setActiveIndex(entry.fileIndex);
    activeIndexRef.current = entry.fileIndex;
  }
  onOpenBox(entry.fileIndex, entry.anchor);
}

function useReviewResumeScroll(args: {
  initialMem: ReturnType<typeof getReviewMemory>;
  listRef: React.RefObject<ReviewListHandle | null>;
  modelRef: React.RefObject<ReviewListModel>;
  resumeCorrectedRef: React.RefObject<boolean>;
}): void {
  const { initialMem, listRef, modelRef, resumeCorrectedRef } = args;
  useEffect(() => {
    if (resumeCorrectedRef.current) {
      return;
    }
    if (modelRef.current.items.length === 0) {
      return;
    }
    resumeCorrectedRef.current = true;
    const t = initialMem?.topRow;
    if (!(t && initialMem?.listState)) {
      return;
    }
    const idx = modelRef.current.anchorItem.get(
      fileAnchorKey(t.fileIndex, t.anchor)
    );
    let tries = 0;
    let raf = 0;
    let settled = 0;
    const step = () => {
      const scroller = listRef.current?.scroller();
      if (!scroller) {
        return;
      }
      const row = scroller.querySelector<HTMLElement>(
        `[data-anchor="${t.anchor}"][data-file-index="${t.fileIndex}"]`
      );
      if (row) {
        const delta =
          row.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top -
          t.top;
        if (Math.abs(delta) > 2) {
          scroller.scrollTop += delta;
          settled = 0;
        } else {
          settled += 1;
          if (settled >= 2) {
            return;
          }
        }
      } else if (idx !== undefined) {
        listRef.current?.scrollItemTo(idx, t.top);
      }
      tries += 1;
      if (tries < 12) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [initialMem, listRef, modelRef, resumeCorrectedRef]);
}

function ReviewScreenPending({
  error,
  goInbox,
  isError,
  number,
  owner,
  repo,
}: {
  error: unknown;
  goInbox: () => void;
  isError: boolean;
  number: number;
  owner: string;
  repo: string;
}) {
  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-medium text-danger text-sm">
          Couldn't load this pull request
        </p>
        <p className="max-w-md break-words text-muted text-xs">
          {String(error)}
        </p>
        <button
          className="rounded-card border border-line px-3 py-1.5 text-fg text-sm hover:bg-elevated"
          onClick={goInbox}
          type="button"
        >
          Back to inbox
        </button>
        <p className="text-faint text-xs">Press Esc to go back</p>
      </div>
    );
  }

  const cached = findCachedInboxPr(owner, repo, number);
  return (
    <div className="dir-quiet relative flex h-full min-h-0 overflow-hidden">
      <aside className="w-[300px] shrink-0 border-line border-r">
        <div className="qf-sidebar flex h-full flex-col">
          <div className="qf-side-head flex items-center justify-between px-4 py-3">
            <span className="qf-side-title">Files</span>
          </div>
          <div className="px-3 py-1">
            {SIDEBAR_SKELETON_WIDTHS.map((width, index, widths) => {
              const n = widths
                .slice(0, index)
                .filter((w) => w === width).length;
              return (
                <div
                  className="qf-skel"
                  key={`${width}-${n}`}
                  style={{
                    height: 17,
                    margin: "10px 8px",
                    width: `${width}%`,
                  }}
                />
              );
            })}
          </div>
        </div>
      </aside>
      <main className="qf-main flex min-w-0 flex-1 flex-col">
        <header className="qf-header shrink-0 px-6 py-3">
          {cached ? (
            <>
              <div className="flex items-center gap-2">
                <h1 className="qf-pr-title truncate" title={cached.title}>
                  {cached.title}
                </h1>
              </div>
              <div className="qf-pr-sub mt-1 flex items-center gap-2">
                <span className="qf-pr-num">#{cached.number}</span>
                <span className="qf-dot">·</span>
                <span>{cached.repo}</span>
                <span className="qf-dot">·</span>
                <Avatar
                  name={cached.author}
                  size={15}
                  url={cached.authorAvatarUrl}
                />
                <span className="qf-muted">{cached.author}</span>
              </div>
            </>
          ) : (
            <>
              <div className="qf-skel" style={{ height: 16, width: 340 }} />
              <div
                className="qf-skel"
                style={{ height: 11, marginTop: 9, width: 190 }}
              />
            </>
          )}
        </header>
        <div className="min-w-0 flex-1 overflow-hidden px-6 py-5">
          {MAIN_SKELETON_WIDTHS.map((width) => (
            <div
              className="qf-skel"
              key={width}
              style={{
                height: 12,
                margin: "11px 0",
                width: `${width}%`,
              }}
            />
          ))}
        </div>
      </main>
    </div>
  );
}

function useReviewHotkeys(config: {
  closeFind: () => void;
  commentAtCursor: () => void;
  copyFilePath: () => void;
  copyLink: () => void;
  cursorMoverRefs: Parameters<typeof buildCursorMover>[0];
  cycleFile: (dir: number) => void;
  extendSelection: (delta: 1 | -1) => void;
  findOpen: boolean;
  findOpenRef: React.RefObject<boolean>;
  findStep: (dir: 1 | -1) => void;
  goInbox: () => void;
  goToComment: (delta: number) => void;
  markViewedAndNext: () => void;
  occNavRefs: Parameters<typeof buildOccNav>[0];
  occSpec: OccState | null;
  openFind: () => void;
  openPrFiles: () => void;
  openSubmit: () => void;
  pageScroll: (dir: number) => void;
  prevFile: () => void;
  replyToActiveThreadOrNextFile: () => void;
  resolveActiveThread: () => void;
  rightOpenRef: React.RefObject<boolean>;
  selectionRef: React.RefObject<LineSelection | null>;
  setPrSearch: (mode: null | "files" | "text") => void;
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelection: (s: LineSelection | null) => void;
  toggleViewedFile: () => void;
}): void {
  const bindings = [
    {
      description: "Next line",
      group: "Navigation",
      icon: ArrowDown,
      keys: ["j", "down"],
      run: (e: KeyboardEvent) => {
        config.setSelection(null);
        buildCursorMover(config.cursorMoverRefs).move(1, e.repeat);
      },
    },
    {
      description: "Previous line",
      group: "Navigation",
      icon: ArrowUp,
      keys: ["k", "up"],
      run: (e: KeyboardEvent) => {
        config.setSelection(null);
        buildCursorMover(config.cursorMoverRefs).move(-1, e.repeat);
      },
    },
    {
      description: "Extend selection down",
      group: "Comments",
      icon: ArrowDown,
      keys: ["shift+j", "shift+down"],
      run: () => config.extendSelection(1),
    },
    {
      description: "Extend selection up",
      group: "Comments",
      icon: ArrowUp,
      keys: ["shift+k", "shift+up"],
      run: () => config.extendSelection(-1),
    },
    {
      description: "Comment on line / selection",
      group: "Comments",
      icon: MessageSquarePlus,
      keys: "c",
      run: config.commentAtCursor,
    },
    {
      description: "Reply to comment / next file",
      group: "Files",
      icon: ChevronRight,
      keys: ["r"],
      run: config.replyToActiveThreadOrNextFile,
    },
    {
      description: "Previous file",
      group: "Files",
      icon: ChevronLeft,
      keys: ["t"],
      run: config.prevFile,
    },
    {
      description: "Cycle files",
      group: "Files",
      icon: ArrowLeftRight,
      keys: "tab",
      run: (e: KeyboardEvent) => config.cycleFile(e.shiftKey ? -1 : 1),
    },
    {
      description: "Page down",
      group: "Navigation",
      icon: ChevronsDown,
      keys: ["space", "pagedown"],
      run: () => config.pageScroll(1),
    },
    {
      description: "Page up",
      group: "Navigation",
      icon: ChevronsUp,
      keys: ["pageup"],
      run: () => config.pageScroll(-1),
    },
    {
      description: "Next comment",
      group: "Comments",
      icon: MessageSquare,
      keys: "]c",
      run: () => config.goToComment(1),
    },
    {
      description: "Previous comment",
      group: "Comments",
      icon: MessageSquare,
      keys: "[c",
      run: () => config.goToComment(-1),
    },
    {
      description: "Resolve / unresolve comment",
      group: "Comments",
      icon: CheckCircle2,
      keys: "x",
      run: config.resolveActiveThread,
    },
    {
      description: "Mark viewed & next",
      group: "Files",
      icon: CheckCheck,
      keys: "e",
      run: config.markViewedAndNext,
    },
    {
      description: "Toggle file viewed",
      group: "Files",
      icon: Check,
      keys: "v",
      run: config.toggleViewedFile,
    },
    {
      description: "Submit review",
      group: "Review",
      icon: Send,
      keys: "s",
      run: config.openSubmit,
    },
    {
      description: "Open files in the browser",
      group: "General",
      icon: ExternalLink,
      keys: "o",
      run: config.openPrFiles,
    },
    {
      description: "Copy PR link",
      group: "General",
      icon: Link,
      keys: "y",
      run: config.copyLink,
    },
    {
      description: "Copy file path",
      group: "Files",
      icon: Copy,
      keys: "mod+shift+c",
      run: config.copyFilePath,
    },
    {
      description: "Toggle info panel",
      group: "General",
      icon: Info,
      keys: "i",
      run: () => config.setRightOpen((open) => !open),
    },
    {
      description: "Find a file",
      group: "Navigation",
      icon: FileSearch,
      keys: "mod+t",
      run: () => config.setPrSearch("files"),
    },
    {
      description: "Search code",
      group: "Navigation",
      icon: Search,
      keys: "mod+r",
      run: () => config.setPrSearch("text"),
    },
    {
      description: "Find in diff",
      group: "Navigation",
      icon: TextSearch,
      keys: "mod+f",
      run: config.openFind,
    },
    ...(config.findOpen
      ? ([
          {
            description: "Next find match",
            hidden: true,
            keys: ["enter", "f3"],
            run: (e: KeyboardEvent) => config.findStep(e.shiftKey ? -1 : 1),
          },
          {
            description: "Next find match",
            hidden: true,
            keys: "mod+g",
            run: (e: KeyboardEvent) => config.findStep(e.shiftKey ? -1 : 1),
          },
        ] satisfies Binding[])
      : []),
    ...(config.occSpec
      ? ([
          {
            description: "Next occurrence",
            hidden: true,
            keys: "n",
            run: () => buildOccNav(config.occNavRefs).step(1),
          },
          {
            description: "Previous occurrence",
            hidden: true,
            keys: "p",
            run: () => buildOccNav(config.occNavRefs).step(-1),
          },
        ] satisfies Binding[])
      : []),
    {
      description: "Close panel / back to inbox",
      group: "Navigation",
      icon: Inbox,
      keys: "esc",
      run: () => {
        if (config.selectionRef.current) {
          config.setSelection(null);
        } else if (config.findOpenRef.current) {
          config.closeFind();
        } else if (config.rightOpenRef.current) {
          config.setRightOpen(false);
        } else {
          config.goInbox();
        }
      },
    },
  ];
  useHotkeys("review", bindings);
}

function buildCommentsByFile(
  comments: readonly ReviewComment[]
): Map<string, ReviewComment[]> {
  const m = new Map<string, ReviewComment[]>();
  for (const c of comments) {
    const arr = m.get(c.path) ?? [];
    arr.push(c);
    m.set(c.path, arr);
  }
  return m;
}

function buildPendingByFile(
  pending: readonly PendingComment[]
): Map<string, PendingComment[]> {
  const m = new Map<string, PendingComment[]>();
  for (const p of pending) {
    const arr = m.get(p.path) ?? [];
    arr.push(p);
    m.set(p.path, arr);
  }
  return m;
}

function flashCommentThread(
  listRef: React.RefObject<ReviewListHandle | null>,
  threadFlashRef: React.RefObject<ReturnType<typeof setTimeout> | null>,
  rootId: number
): void {
  let tries = 0;
  const land = () => {
    const el = listRef.current
      ?.scroller()
      ?.querySelector<HTMLElement>(`[data-comment-root="${rootId}"]`);
    if (!el) {
      tries += 1;
      if (tries < 20) {
        requestAnimationFrame(land);
      }
      return;
    }
    el.classList.add("qf-row-flash");
    if (threadFlashRef.current) {
      clearTimeout(threadFlashRef.current);
    }
    threadFlashRef.current = setTimeout(
      () => el.classList.remove("qf-row-flash"),
      1600
    );
  };
  requestAnimationFrame(land);
}

function useReviewThreadActions(args: {
  activeIndexRef: React.RefObject<number>;
  activeThreadRef: React.RefObject<{ rootId: number; path: string } | null>;
  commentIndex: number;
  commentsRef: React.RefObject<ReviewComment[]>;
  filesRef: React.RefObject<ChangedFile[]>;
  listRef: React.RefObject<ReviewListHandle | null>;
  modelRef: React.RefObject<ReviewListModel>;
  nextFile: () => void;
  replyNonceRef: React.RefObject<number>;
  resolveThread: ReturnType<typeof useCommentMutations>["resolveThread"];
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  setCommentIndex: React.Dispatch<React.SetStateAction<number>>;
  setReplyReq: React.Dispatch<
    React.SetStateAction<{
      rootId: number;
      path: string;
      nonce: number;
    } | null>
  >;
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  threadFlashRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const jumpToThread = (path: string, rootId: number) => {
    const m = args.modelRef.current;
    const fileIndex = args.filesRef.current.findIndex(
      (f) => f.filename === path
    );
    if (fileIndex < 0) {
      return;
    }
    args.setRightOpen(false);
    usePerfStore.getState().markFileStart();
    args.setActiveIndex(fileIndex);
    args.activeIndexRef.current = fileIndex;
    const itemIndex = m.commentItems.find((i) => {
      const it = m.items[i];
      return (
        it.kind === "comments" &&
        it.fileIndex === fileIndex &&
        it.threads.some((t) => t[0]?.id === rootId)
      );
    });
    if (itemIndex === undefined) {
      args.listRef.current?.scrollToFileStart(fileIndex);
      return;
    }
    args.listRef.current?.centerItem(itemIndex);
    flashCommentThread(args.listRef, args.threadFlashRef, rootId);
  };

  const goToComment = (delta: number) => {
    const list = args.modelRef.current.commentItems;
    if (list.length === 0) {
      return;
    }
    const next = (args.commentIndex + delta + list.length) % list.length;
    args.setCommentIndex(next);
    args.listRef.current?.centerItem(list[next]);

    const item = args.modelRef.current.items[list[next]];
    args.activeThreadRef.current =
      item?.kind === "comments" && item.threads.length > 0
        ? {
            path: args.filesRef.current[item.fileIndex]?.filename ?? "",
            rootId: item.threads[0][0].id,
          }
        : null;
  };

  const replyToActiveThreadOrNextFile = () => {
    const t = args.activeThreadRef.current;
    if (t && args.commentsRef.current.some((c) => c.id === t.rootId)) {
      args.replyNonceRef.current += 1;
      args.setReplyReq({ ...t, nonce: args.replyNonceRef.current });
      return;
    }
    args.nextFile();
  };

  const resolveActiveThread = () => {
    const t = args.activeThreadRef.current;
    if (!t) {
      return;
    }
    const root = args.commentsRef.current.find((c) => c.id === t.rootId);
    if (!root || root.threadId === null) {
      return;
    }
    args.resolveThread.mutate({
      resolved: !root.resolved,
      threadId: root.threadId,
    });
  };

  return {
    goToComment,
    jumpToThread,
    replyToActiveThreadOrNextFile,
    resolveActiveThread,
  };
}

function advanceToNextReview(
  owner: string,
  repo: string,
  number: number,
  goInbox: () => void
): void {
  const inbox = queryClient.getQueryData<InboxData>(queryKeys.inbox);
  const list = inbox?.reviewRequested.prs ?? [];
  const isCurrent = (p: PullRequest) =>
    p.owner === owner && p.name === repo && p.number === number;
  const idx = list.findIndex(isCurrent);
  const next =
    (idx >= 0 ? list.slice(idx + 1).find((p) => !isCurrent(p)) : undefined) ??
    list.find((p) => !isCurrent(p));
  if (next) {
    const store = useAppStore.getState();
    store.openReview(next.owner, next.name, next.number);
    store.markSeen(
      prKey({ name: next.name, number: next.number, owner: next.owner }),
      next.updatedAt
    );
  } else {
    goInbox();
  }
}

function useReviewFind(args: {
  files: ChangedFile[];
  listRef: React.RefObject<ReviewListHandle | null>;
  model: ReviewListModel;
  selectLine: (
    fileIndex: number,
    anchor: string,
    opts?: { keepOccurrences?: boolean }
  ) => void;
}) {
  const { files, listRef, model, selectLine } = args;
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findIndex, setFindIndex] = useState<number | null>(null);
  const [findSeed, setFindSeed] = useState<number | null>(null);
  const [findFocusSeq, setFindFocusSeq] = useState(0);
  const findJumpedRef = useRef(false);
  const findOpenRef = useLatest(findOpen);

  const findMatches =
    findOpen && findQuery
      ? findInDiff(files, findQuery, { caseSensitive: findCase })
      : EMPTY_MATCHES;
  const findSeededIndex = seededMatchIndex(findMatches, model, findSeed);
  const findSafeIndex =
    findMatches.length > 0
      ? Math.min(findIndex ?? findSeededIndex, findMatches.length - 1)
      : 0;
  const findCurrent = currentMatchAt(findMatches, findSafeIndex);

  const changeFindQuery = (q: string) => {
    setFindSeed(listRef.current?.firstVisibleRowItem() ?? null);
    setFindQuery(q);
    setFindIndex(null);
    findJumpedRef.current = false;
  };

  const toggleFindCase = () => {
    setFindSeed(listRef.current?.firstVisibleRowItem() ?? null);
    setFindCase((c) => !c);
    setFindIndex(null);
    findJumpedRef.current = false;
  };

  const openFind = () => {
    if (!findOpenRef.current) {
      setFindSeed(listRef.current?.firstVisibleRowItem() ?? null);
      setFindIndex(null);
      findJumpedRef.current = false;
      setFindOpen(true);
      const selected =
        window.getSelection()?.toString().split("\n")[0].trim() ?? "";
      if (selected) {
        changeFindQuery(selected);
      }
    }
    setFindFocusSeq((s) => s + 1);
  };

  const closeFind = () => {
    setFindOpen(false);
  };

  const findStep = (dir: 1 | -1) => {
    const n = findMatches.length;
    if (n === 0) {
      return;
    }
    const next = findJumpedRef.current
      ? (findSafeIndex + dir + n) % n
      : findSafeIndex;
    findJumpedRef.current = true;
    setFindIndex(next);
    const m = findMatches[next];
    selectLine(m.fileIndex, m.anchor);
  };

  const onFindNext = () => findStep(1);
  const onFindPrev = () => findStep(-1);

  return {
    changeFindQuery,
    closeFind,
    findCase,
    findCurrent,
    findFocusSeq,
    findMatches,
    findOpen,
    findOpenRef,
    findQuery,
    findSafeIndex,
    findStep,
    onFindNext,
    onFindPrev,
    openFind,
    toggleFindCase,
  };
}

function useReviewFileNavigation(args: {
  activeIndexRef: React.RefObject<number>;
  cursorMoverRefs: Parameters<typeof buildCursorMover>[0];
  cursorRef: React.RefObject<CursorPos | null>;
  fileCountRef: React.RefObject<number>;
  keyboardHoldRef: React.RefObject<boolean>;
  listCallbacks: ReviewListCallbacks;
  listRef: React.RefObject<ReviewListHandle | null>;
  liveSelectionRef: React.RefObject<ReturnType<typeof resolveLiveSelection>>;
  modelRef: React.RefObject<ReviewListModel>;
  persistFileIndex: (index: number) => void;
  selectionRef: React.RefObject<LineSelection | null>;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  setCommentIndex: React.Dispatch<React.SetStateAction<number>>;
  setCursor: React.Dispatch<React.SetStateAction<CursorPos | null>>;
  setInputMode: React.Dispatch<React.SetStateAction<"keyboard" | "mouse">>;
  setOccSpec: (next: OccState | null) => void;
  setSelection: (s: LineSelection | null) => void;
}) {
  const scrollToFile = (i: number) => {
    if (args.fileCountRef.current === 0) {
      return;
    }
    const target = Math.min(Math.max(i, 0), args.fileCountRef.current - 1);
    usePerfStore.getState().markFileStart();
    args.setActiveIndex(target);
    syncActiveIndexRef(args.activeIndexRef, target);
    args.persistFileIndex(target);
    args.setCommentIndex(0);
    args.setOccSpec(null);
    args.setSelection(null);
    args.listRef.current?.scrollToFileStart(target);
  };

  const fileDeltaRef = useRef(0);
  const fileRafRef = useRef<number | null>(null);
  const flushFileMove = () => {
    fileRafRef.current = null;
    const delta = fileDeltaRef.current;
    fileDeltaRef.current = 0;
    if (delta === 0) {
      return;
    }
    scrollToFile(args.activeIndexRef.current + delta);
  };

  const moveFile = (delta: number) => {
    if (args.fileCountRef.current === 0) {
      return;
    }
    fileDeltaRef.current += delta;
    if (fileRafRef.current === null) {
      fileRafRef.current = requestAnimationFrame(flushFileMove);
    }
  };

  const nextFile = () => moveFile(1);
  const prevFile = () => moveFile(-1);

  const cycleFile = (dir: number) => {
    const n = args.fileCountRef.current;
    if (n === 0) {
      return;
    }
    scrollToFile((args.activeIndexRef.current + dir + n) % n);
  };

  const pageScroll = (dir: number) => {
    const el = args.listRef.current?.scroller();
    if (el) {
      el.scrollBy({ top: dir * el.clientHeight * 0.85 });
    }
  };

  const extendSelection = (delta: 1 | -1) => {
    const m = args.modelRef.current;
    markKeyboardNavigation(args);
    const sel = args.selectionRef.current;
    if (sel) {
      extendExistingSelection(
        sel,
        delta,
        m,
        args.listRef,
        args.setSelection,
        args.setCursor
      );
      return;
    }
    const cur = args.cursorRef.current;
    if (!cur) {
      buildCursorMover(args.cursorMoverRefs).move(delta, false);
      return;
    }
    startSelectionFromCursor(
      cur,
      delta,
      m,
      args.listRef,
      args.setSelection,
      args.setCursor
    );
  };

  const commentAtCursor = () => {
    commentAtCursorPos(
      args.modelRef,
      args.liveSelectionRef,
      args.cursorRef,
      args.activeIndexRef,
      args.setCursor,
      args.setActiveIndex,
      args.listCallbacks.onOpenBox
    );
  };

  const selectFileFromSearch = (fileIndex: number) => {
    scrollToFile(fileIndex);
    const entry = args.modelRef.current.nav.find(
      (n) => n.fileIndex === fileIndex
    );
    if (entry) {
      markKeyboardNavigation(args);
      args.setCursor({ anchor: entry.anchor, fileIndex: entry.fileIndex });
    }
  };

  return {
    commentAtCursor,
    cycleFile,
    extendSelection,
    fileRafRef,
    nextFile,
    pageScroll,
    prevFile,
    scrollToFile,
    selectFileFromSearch,
  };
}

function useReviewSubmitActions(args: {
  activeFile: ChangedFile | undefined;
  activeIndexRef: React.RefObject<number>;
  advanceAfterSubmit: () => void;
  clearPendingComments: (key: string) => void;
  keyValue: string;
  number: number;
  owner: string;
  pending: PendingComment[];
  pr: PullRequest | undefined;
  prUrl: string | undefined;
  repo: string;
  scrollToFile: (i: number) => void;
  setFlash: (msg: string) => void;
  setSubmitOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setToast: (t: { message: string; title: string }) => void;
  submitReview: ReturnType<typeof useCommentMutations>["submitReview"];
  toggleViewedWithFp: (f: ChangedFile) => void;
  viewedSet: Set<string>;
}) {
  const toggleViewedFile = () => {
    if (args.activeFile) {
      args.toggleViewedWithFp(args.activeFile);
    }
  };

  const markViewedAndNext = () => {
    if (!args.activeFile) {
      return;
    }
    const wasViewed = args.viewedSet.has(args.activeFile.filename);
    args.toggleViewedWithFp(args.activeFile);
    if (!wasViewed) {
      args.scrollToFile(args.activeIndexRef.current + 1);
    }
  };

  const copyLink = () => {
    if (!args.prUrl) {
      return;
    }
    copyTextToClipboard(args.prUrl);
    args.setToast({ message: args.prUrl, title: "Copied PR link" });
  };

  const copyFilePath = () => {
    if (!args.activeFile) {
      return;
    }
    copyTextToClipboard(args.activeFile.filename);
    args.setToast({
      message: args.activeFile.filename,
      title: "Copied file path",
    });
  };

  const openSubmit = () => {
    args.submitReview.reset();
    args.setSubmitOpen(true);
  };

  const handleSubmitReview = (event: ReviewEvent, body: string) => {
    const payload = {
      body,
      comments: args.pending.map((p) => ({
        body: p.body,
        line: p.line,
        path: p.path,
        side: p.side,
        startLine: p.startLine,
      })),
      commitId: args.pr?.headSha ?? "",
      event,
    };
    args.setSubmitOpen(false);
    args.advanceAfterSubmit();
    args.submitReview
      .mutateAsync(payload)
      .then(() => args.clearPendingComments(args.keyValue))
      .catch((e) => {
        args.setFlash(
          `Review for ${args.owner}/${args.repo}#${args.number} didn't submit — your comments are still pending. ${String(e)}`
        );
      });
  };

  return {
    copyFilePath,
    copyLink,
    handleSubmitReview,
    markViewedAndNext,
    openSubmit,
    toggleViewedFile,
  };
}

export function ReviewScreen({ routeKey }: ReviewScreenProps) {
  return useReviewScreenCore(routeKey);
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: orchestrates many extracted sub-hooks; further splitting risks hook-order bugs
function useReviewScreenCore(routeKey: string): React.ReactElement {
  const { name: repo, number, owner } = parsePrKey(routeKey);
  const keyValue = routeKey;

  const { data, isError, error } = usePullRequestDetail(owner, repo, number);
  const {
    addReviewComment,
    reply,
    addIssueComment,
    resolveThread,
    submitReview,
  } = useCommentMutations(owner, repo, number);

  const detail = data;
  const pr = detail?.pr;
  const headShaRef = useLatest(pr?.headSha ?? "");

  const [initialMem] = useState(() => getReviewMemory(keyValue));

  const [activeIndex, setActiveIndex] = useState(initialMem?.fileIndex ?? 0);
  const [rightOpen, setRightOpen] = useState(false);
  const rightOpenRef = useLatest(rightOpen);
  const [commentIndex, setCommentIndex] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [prSearch, setPrSearch] = useState<null | "files" | "text">(null);
  const [changedSinceViewed, setChangedSinceViewed] = useState<Set<string>>(
    () => new Set()
  );
  const [replyReq, setReplyReq] = useState<{
    rootId: number;
    path: string;
    nonce: number;
  } | null>(null);

  const [collapsed, setCollapsed] =
    useState<ReadonlyMap<number, ReadonlySet<number>>>(EMPTY_COLLAPSED);
  const [openBoxes, setOpenBoxes] = useState<
    ReadonlyMap<string, number | null>
  >(() => new Map<string, number | null>());
  const [cursor, setCursor] = useState<CursorPos | null>(null);
  const [selection, setSelection] = useState<LineSelection | null>(null);
  const [dragging, setDragging] = useState(false);
  const [inputMode, setInputMode] = useState<"keyboard" | "mouse">("keyboard");
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [copiedPathIndex, setCopiedPathIndex] = useState<number | null>(null);

  const [occSpec, setOccSpec] = useState<OccState | null>(null);
  const occSpecRef = useLatest(occSpec);

  const occRestoreRef = useRef<CapturedSelection | null>(null);
  const occNavRef = useRef(-1);
  const occOriginRef = useRef<{ anchor: string; column: number } | null>(null);

  const listRef = useRef<ReviewListHandle>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replyNonceRef = useRef(0);
  const threadFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeThreadRef = useRef<{ rootId: number; path: string } | null>(null);
  const keyboardHoldRef = useRef(false);

  const goInbox = useAppStore((s) => s.goInbox);
  const toggleViewed = useAppStore((s) => s.toggleViewed);
  const reconcileViewed = useAppStore((s) => s.reconcileViewed);

  const viewed = useAppStore((s) => s.viewed);

  const pendingMap = useAppStore((s) => s.pendingComments);
  const pending = pendingMap[keyValue] ?? EMPTY_PENDING;
  const addPendingStore = useAppStore((s) => s.addPendingComment);
  const removePendingStore = useAppStore((s) => s.removePendingComment);
  const clearPendingComments = useAppStore((s) => s.clearPendingComments);
  const setFlash = useAppStore((s) => s.setFlash);
  const setToast = useAppStore((s) => s.setToast);
  const activeLogin = useAppStore(
    (s) => s.accounts.find((a) => a.id === s.activeAccountId)?.login
  );
  const trackerBase = useAppStore((s) =>
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined
  );
  const viewedFiles = viewed[keyValue];
  const viewedSet = new Set(Object.keys(viewedFiles ?? {}));

  const files = detail?.files ?? [];
  const fileCount = files.length;
  const clampedIndex = Math.min(activeIndex, Math.max(fileCount - 1, 0));
  const activeFile = files[clampedIndex];

  const toggleViewedWithFp = (f: ChangedFile) => {
    toggleViewed(keyValue, f.filename, fingerprintFile(f, headShaRef.current));
    setChangedSinceViewed((prev) => {
      if (!prev.has(f.filename)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(f.filename);
      return next;
    });
  };

  const persistFileIndex = (index: number) => {
    updateReviewMemory(keyValue, { fileIndex: index });
  };

  const activeIndexRef = useLatest(clampedIndex);
  const fileCountRef = useLatest(fileCount);
  const filesRef = useLatest(files);
  const commentsRef = useLatest<ReviewComment[]>(
    detail?.comments ?? EMPTY_COMMENTS
  );

  const commentsByFile = buildCommentsByFile(
    detail?.comments ?? EMPTY_COMMENTS
  );
  const pendingByFile = buildPendingByFile(pending);

  const model: ReviewListModel = buildReviewItems({
    collapsed,
    commentsByFile,
    files,
    isImage: isImageFile,
    openBoxes,
    pendingByFile,
  });
  const modelRef = useLatest(model);

  const liveCursor =
    cursor &&
    model.navIndexOf.has(fileAnchorKey(cursor.fileIndex, cursor.anchor))
      ? cursor
      : null;

  const liveSelection = resolveLiveSelection(selection, model);
  const selectionRef = useLatest(selection);
  const liveSelectionRef = useLatest(liveSelection);

  const selectLineRef = useRef<
    (
      fileIndex: number,
      anchor: string,
      opts?: { keepOccurrences?: boolean }
    ) => void
  >(() => undefined);

  const {
    changeFindQuery,
    closeFind,
    findCase,
    findCurrent,
    findFocusSeq,
    findMatches,
    findOpen,
    findOpenRef,
    findQuery,
    findSafeIndex,
    findStep,
    onFindNext,
    onFindPrev,
    openFind,
    toggleFindCase,
  } = useReviewFind({
    files,
    listRef,
    model,
    selectLine: (...args) => selectLineRef.current(...args),
  });

  const selectLine = (
    fileIndex: number,
    anchor: string,
    opts: { keepOccurrences?: boolean } = {}
  ) => {
    const m = modelRef.current;
    const key = fileAnchorKey(fileIndex, anchor);
    usePerfStore.getState().markFileStart();
    setActiveIndex(fileIndex);
    activeIndexRef.current = fileIndex;
    persistFileIndex(fileIndex);
    setCommentIndex(0);
    if (!(findOpenRef.current || opts.keepOccurrences)) {
      setOccSpec(null);
    }
    keyboardHoldRef.current = true;
    setInputMode("keyboard");
    setCursor({ anchor, fileIndex });
    setFlashKey(key);
    if (flashTimerRef.current) {
      clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = setTimeout(() => setFlashKey(null), 1600);
    const itemIndex = m.anchorItem.get(key);
    if (itemIndex !== undefined) {
      listRef.current?.centerItem(itemIndex);
    }
  };

  useLayoutEffect(() => {
    selectLineRef.current = selectLine;
  });

  const filesForHighlightRef = useLatest(files);

  useEffect(() => {
    const cachedFiles = filesForHighlightRef.current;
    if (cachedFiles.length === 0) {
      return;
    }
    return warmHighlightCache(cachedFiles);
  }, [filesForHighlightRef]);

  useReviewHeadShaSync(keyValue, pr);
  useInboxDetailNudge(keyValue, pr);
  useViewedFileReconcile(
    keyValue,
    pr,
    files,
    reconcileViewed,
    setChangedSinceViewed,
    setToast
  );

  const resumeCorrectedRef = useRef(false);
  useReviewResumeScroll({
    initialMem,
    listRef,
    modelRef,
    resumeCorrectedRef,
  });

  useEffect(() => {
    requestAnimationFrame(() => usePerfStore.getState().completeFile());
  }, []);

  /**
   * Scroll → debounce → snapshot the virtualizer state into review memory.
   * The snapshot IS the resume position (restoreStateFrom on next mount).
   */
  function handleListScroll() {
    if (saveStateTimerRef.current) {
      clearTimeout(saveStateTimerRef.current);
    }
    saveStateTimerRef.current = setTimeout(() => {
      const topRow = listRef.current?.firstVisibleRow() ?? undefined;
      listRef.current?.getState((state) => {
        updateReviewMemory(keyValue, { listState: state, topRow });
      });
    }, 300);
  }

  const cursorRef = useLatest(liveCursor);

  const userMovedCursorRef = useRef(false);

  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const isRealPointerAt = (x: number, y: number) =>
    isRealPointer(x, y, keyboardHoldRef, lastPointRef);

  const pendingDeltaRef = useRef(0);
  const cursorRafRef = useRef<number | null>(null);
  const heldRepeatsRef = useRef(0);

  const cursorMoverRefs = {
    activeIndexRef,
    cursorRafRef,
    cursorRef,
    heldRepeatsRef,
    keyboardHoldRef,
    listRef,
    modelRef,
    pendingDeltaRef,
    setActiveIndex,
    setCursor,
    setInputMode,
    userMovedCursorRef,
  };

  const dragRef = useRef<{
    fileIndex: number;
    side: string;
    hunkIndex: number;
    from: string;
  } | null>(null);

  const listCallbacks = useReviewListCallbacks({
    activeThreadRef,
    addPendingStore,
    addReviewComment,
    copyTimerRef,
    dragRef,
    filesRef,
    handleListScroll,
    headShaRef,
    isRealPointerAt,
    keyboardHoldRef,
    keyValue,
    lastPointRef,
    liveSelectionRef,
    modelRef,
    removePendingStore,
    reply,
    resolveThread,
    setActiveIndex,
    setChangedSinceViewed,
    setCollapsed,
    setCopiedPathIndex,
    setCursor,
    setDragging,
    setInputMode,
    setOpenBoxes,
    setSelection,
    toggleViewed,
  });

  const {
    commentAtCursor,
    cycleFile,
    extendSelection,
    fileRafRef,
    nextFile,
    pageScroll,
    prevFile,
    scrollToFile,
    selectFileFromSearch,
  } = useReviewFileNavigation({
    activeIndexRef,
    cursorMoverRefs,
    cursorRef,
    fileCountRef,
    keyboardHoldRef,
    listCallbacks,
    listRef,
    liveSelectionRef,
    modelRef,
    persistFileIndex,
    selectionRef,
    setActiveIndex,
    setCommentIndex,
    setCursor,
    setInputMode,
    setOccSpec,
    setSelection,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only cleanup for timer/raf refs
  useEffect(
    () => () => {
      const flashTimer = flashTimerRef.current;
      const threadFlash = threadFlashRef.current;
      const copyTimer = copyTimerRef.current;
      const saveStateTimer = saveStateTimerRef.current;
      const fileRaf = fileRafRef.current;
      const cursorRaf = cursorRafRef.current;
      if (flashTimer) {
        clearTimeout(flashTimer);
      }
      if (threadFlash) {
        clearTimeout(threadFlash);
      }
      if (copyTimer) {
        clearTimeout(copyTimer);
      }
      if (saveStateTimer) {
        clearTimeout(saveStateTimer);
      }
      if (fileRaf !== null) {
        cancelAnimationFrame(fileRaf);
      }
      if (cursorRaf !== null) {
        cancelAnimationFrame(cursorRaf);
      }
    },
    [
      copyTimerRef,
      cursorRafRef,
      fileRafRef,
      flashTimerRef,
      saveStateTimerRef,
      threadFlashRef,
    ]
  );

  const occMatchList = occSpec
    ? occurrenceMatches(files[occSpec.fileIndex] ?? {}, occSpec)
    : EMPTY_OCC;
  const occMatchListRef = useLatest(occMatchList);

  const occNavRefs = {
    occMatchListRef,
    occNavRef,
    occOriginRef,
    occSpecRef,
    selectLineRef,
  };

  useOccurrenceTracking({
    findOpenRef,
    occMatchListRef,
    occNavRef,
    occOriginRef,
    occRestoreRef,
    occSpecRef,
    selectLineRef,
    setOccSpec,
  });

  useLayoutEffect(() => {
    const captured = occRestoreRef.current;
    occRestoreRef.current = null;
    if (captured) {
      restoreCodeSelection(captured);
    }
  }, []);

  const marks = resolveMarks(findOpen, findQuery, findCase, occSpec);

  const rulerFractions = resolveRulerFractions(
    model,
    findOpen,
    findQuery,
    findMatches,
    occSpec,
    occMatchList
  );

  const advanceAfterSubmit = () =>
    advanceToNextReview(owner, repo, number, goInbox);

  const {
    goToComment,
    jumpToThread,
    replyToActiveThreadOrNextFile,
    resolveActiveThread,
  } = useReviewThreadActions({
    activeIndexRef,
    activeThreadRef,
    commentIndex,
    commentsRef,
    filesRef,
    listRef,
    modelRef,
    nextFile,
    replyNonceRef,
    resolveThread,
    setActiveIndex,
    setCommentIndex,
    setReplyReq,
    setRightOpen,
    threadFlashRef,
  });

  const {
    copyFilePath,
    copyLink,
    handleSubmitReview,
    markViewedAndNext,
    openSubmit,
    toggleViewedFile,
  } = useReviewSubmitActions({
    activeFile,
    activeIndexRef,
    advanceAfterSubmit,
    clearPendingComments,
    keyValue,
    number,
    owner,
    pending,
    pr,
    prUrl: pr?.url,
    repo,
    scrollToFile,
    setFlash,
    setSubmitOpen,
    setToast,
    submitReview,
    toggleViewedWithFp,
    viewedSet,
  });

  const onOpenPrUrl = () => {
    if (pr?.url) {
      openUrl(pr.url);
    }
  };

  const onToggleRightPanel = () => {
    setRightOpen((open) => !open);
  };

  const onCloseRightPanel = () => {
    setRightOpen(false);
  };

  const onCloseSubmitModal = () => {
    setSubmitOpen(false);
  };

  const onClosePrSearch = () => {
    setPrSearch(null);
  };

  const onAddIssueComment = async (body: string) => {
    await addIssueComment.mutateAsync({ body });
  };

  const onOpenPrFiles = () => {
    if (!pr?.url) {
      return;
    }
    const urlFilesPath = pr.url.includes("/-/merge_requests/")
      ? "/diffs"
      : "/files";
    openUrl(pr.url + urlFilesPath);
  };

  useReviewHotkeys({
    closeFind,
    commentAtCursor,
    copyFilePath,
    copyLink,
    cursorMoverRefs,
    cycleFile,
    extendSelection,
    findOpen,
    findOpenRef,
    findStep,
    goInbox,
    goToComment,
    markViewedAndNext,
    occNavRefs,
    occSpec,
    openFind,
    openPrFiles: onOpenPrFiles,
    openSubmit,
    pageScroll,
    prevFile,
    replyToActiveThreadOrNextFile,
    resolveActiveThread,
    rightOpenRef,
    selectionRef,
    setPrSearch,
    setRightOpen,
    setSelection,
    toggleViewedFile,
  });

  if (!(detail && pr)) {
    return (
      <ReviewScreenPending
        error={error}
        goInbox={goInbox}
        isError={isError}
        number={number}
        owner={owner}
        repo={repo}
      />
    );
  }

  const stateClass = resolvePrStateClass(pr);
  const stateLabel = resolvePrStateLabel(pr);

  const viewedNow = viewedSet.size;
  const isOwnPr = !!activeLogin && pr.author === activeLogin;
  const reviews = detail.reviews ?? [];

  const convoCount =
    (detail.issueComments?.length ?? 0) +
    reviews.filter((r) => r.body.trim().length > 0).length +
    detail.comments.filter((c) => c.inReplyToId === null).length;
  return (
    <div className="dir-quiet relative flex h-full min-h-0 overflow-hidden">
      <aside className="w-[300px] shrink-0 border-line border-r">
        <FileSidebar
          changed={changedSinceViewed}
          comments={detail.comments}
          files={files}
          onSelect={scrollToFile}
          pending={pending}
          prKeyValue={keyValue}
          selectedIndex={clampedIndex}
        />
      </aside>

      <main className="qf-main flex min-w-0 flex-1 flex-col">
        <header className="qf-header flex shrink-0 items-center gap-4 px-6 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={cn("qf-state", stateClass)}>
                <span className="qf-state-dot" />
                {stateLabel}
              </span>
              <h1 className="qf-pr-title truncate" title={pr.title}>
                <TicketTitle title={pr.title} trackerBase={trackerBase} />
              </h1>
            </div>
            <div className="qf-pr-sub mt-1 flex items-center gap-2">
              <span className="qf-pr-num">#{pr.number}</span>
              <span className="qf-dot">·</span>
              <span>{pr.repo}</span>
              <span className="qf-dot">·</span>
              <Avatar name={pr.author} size={15} url={pr.authorAvatarUrl} />
              <span className="qf-muted">{pr.author}</span>
              {!!pr.baseRef && !!pr.headRef && (
                <>
                  <span className="qf-dot">·</span>
                  <span className="qf-branch">
                    <BranchChip
                      label="Target branch — click to copy"
                      name={pr.baseRef}
                    />
                    <span className="qf-arrow">←</span>
                    <BranchChip
                      label="PR branch — click to copy"
                      name={pr.headRef}
                    />
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <ReviewVerdicts reviews={reviews} />
            <span className="qf-muted text-xs">
              {viewedNow}/{fileCount} viewed
            </span>
            <div className="qf-stat-group">
              <span className="qf-add">+{pr.additions}</span>
              <span className="qf-del">−{pr.deletions}</span>
            </div>
            <button
              className="qf-back qf-focusable"
              onClick={onOpenPrUrl}
              title="Open on GitHub (o)"
              type="button"
            >
              Open ↗
            </button>
            <button
              aria-pressed={rightOpen}
              className="qf-info-btn qf-focusable"
              onClick={onToggleRightPanel}
              title="PR description & conversation (i)"
              type="button"
            >
              i
              {convoCount > 0 && (
                <span className="qf-info-count">{convoCount}</span>
              )}
            </button>
            <button
              className="qf-submit qf-focusable"
              onClick={openSubmit}
              type="button"
            >
              {pending.length > 0 ? "Submit review" : "Review"}
              {pending.length > 0 && (
                <span className="qf-submit-badge">{pending.length}</span>
              )}
              <Kbd combo="s" />
            </button>
          </div>
        </header>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <FindBar
            caseSensitive={findCase}
            current={findMatches.length > 0 ? findSafeIndex + 1 : 0}
            focusSeq={findFocusSeq}
            onClose={closeFind}
            onNext={onFindNext}
            onPrev={onFindPrev}
            onQueryChange={changeFindQuery}
            onToggleCase={toggleFindCase}
            open={findOpen}
            query={findQuery}
            total={findMatches.length}
          />
          {fileCount === 0 ? (
            <div className="qf-empty">No files changed.</div>
          ) : (
            <ReviewList
              activeIndex={clampedIndex}
              addPending={false}
              baseSha={pr.baseSha}
              callbacks={listCallbacks}
              changedSinceViewed={changedSinceViewed}
              copiedPathIndex={copiedPathIndex}
              cursorKey={
                liveCursor
                  ? fileAnchorKey(liveCursor.fileIndex, liveCursor.anchor)
                  : null
              }
              dragging={dragging}
              files={files}
              findCurrent={findCurrent}
              flashKey={flashKey}
              headSha={pr.headSha}
              initialFileIndex={initialMem?.fileIndex ?? 0}
              inputMode={inputMode}
              marks={marks}
              model={model}
              owner={owner}
              ref={listRef}
              replyRequest={replyReq}
              repo={repo}
              restoreState={initialMem?.listState}
              selection={
                liveSelection
                  ? {
                      endItem: liveSelection.endItem,
                      fileIndex: liveSelection.fileIndex,
                      fromItem: liveSelection.fromItem,
                      toItem: liveSelection.toItem,
                    }
                  : null
              }
              viewedSet={viewedSet}
            />
          )}
          <OverviewRuler
            currentIndex={
              findOpen && findMatches.length > 0 ? findSafeIndex : null
            }
            fractions={rulerFractions}
            kind={findOpen ? "find" : "occurrence"}
          />
        </div>
      </main>

      <RightPanel
        conversation={detail.issueComments ?? []}
        fileCount={fileCount}
        inlineComments={detail.comments}
        onAddIssueComment={onAddIssueComment}
        onClose={onCloseRightPanel}
        onJumpToThread={jumpToThread}
        open={rightOpen}
        pr={pr}
        reviews={reviews}
      />

      <SubmitReviewModal
        busy={false}
        error={null}
        onClose={onCloseSubmitModal}
        onSubmit={handleSubmitReview}
        open={submitOpen}
        ownPr={isOwnPr}
        pendingCount={pending.length}
      />

      <PrSearch
        files={files}
        mode={prSearch ?? "files"}
        onClose={onClosePrSearch}
        onSelectFile={selectFileFromSearch}
        onSelectLine={selectLine}
        open={prSearch !== null}
      />
    </div>
  );
}

/** The rAF-coalesced j/k cursor over the flattened nav list — see
 *  cursorMoverRefs. Stateless over refs, so per-event instances are
 *  interchangeable; holding the key accelerates (3×/6× after ~¼s/~¾s). */
function buildCursorMover(refs: {
  modelRef: React.RefObject<ReviewListModel>;
  cursorRef: React.RefObject<CursorPos | null>;
  activeIndexRef: React.RefObject<number>;
  pendingDeltaRef: React.RefObject<number>;
  cursorRafRef: React.RefObject<number | null>;
  heldRepeatsRef: React.RefObject<number>;
  keyboardHoldRef: React.RefObject<boolean>;
  userMovedCursorRef: React.RefObject<boolean>;
  listRef: React.RefObject<ReviewListHandle | null>;
  setCursor: React.Dispatch<React.SetStateAction<CursorPos | null>>;
  setActiveIndex: (i: number) => void;
  setInputMode: (m: "keyboard" | "mouse") => void;
}): { move: (delta: number, isRepeat: boolean) => void } {
  const place = (entry: { fileIndex: number; anchor: string }) => {
    refs.setCursor({ anchor: entry.anchor, fileIndex: entry.fileIndex });
    refs.setActiveIndex(entry.fileIndex);
    refs.activeIndexRef.current = entry.fileIndex; // eager — see scrollToFile
  };
  const flush = () => {
    refs.cursorRafRef.current = null;
    const m = refs.modelRef.current;
    const delta = refs.pendingDeltaRef.current;
    refs.pendingDeltaRef.current = 0;
    if (delta === 0 || m.nav.length === 0) {
      return;
    }
    const cur = refs.cursorRef.current;
    refs.userMovedCursorRef.current = true;
    const curIdx = cur
      ? m.navIndexOf.get(fileAnchorKey(cur.fileIndex, cur.anchor))
      : undefined;
    if (curIdx === undefined) {
      const start = refs.listRef.current?.firstVisibleRowItem() ?? 0;
      const entry = m.nav.find((n) => n.itemIndex >= start) ?? m.nav[0];
      place(entry);
      return;
    }
    const nextIdx = Math.min(Math.max(curIdx + delta, 0), m.nav.length - 1);
    if (nextIdx === curIdx) {
      return;
    }
    const entry = m.nav[nextIdx];
    place(entry);
    refs.listRef.current?.nudgeItemIntoView(entry.itemIndex);
  };
  return {
    move(delta, isRepeat) {
      refs.keyboardHoldRef.current = true;
      refs.setInputMode("keyboard");
      refs.heldRepeatsRef.current = isRepeat
        ? refs.heldRepeatsRef.current + 1
        : 0;
      const held = refs.heldRepeatsRef.current;
      const multiplier = cursorRepeatMultiplier(held);
      refs.pendingDeltaRef.current += delta * multiplier;
      if (refs.cursorRafRef.current === null) {
        refs.cursorRafRef.current = requestAnimationFrame(flush);
      }
    },
  };
}

/** Occurrence navigation over the current match list — see occNavRefs. */
interface OccNav {
  /** Index in the match list of the occurrence covering (anchor, column). */
  indexAt: (anchor: string, column: number) => number;
  /** Jump to match `index` (wrapping), keeping the marks alive. */
  jumpTo: (index: number) => void;
  /** n/p: step relative to the last-jumped position (or the origin
   *  occurrence — the clicked/selected one — before any jump). */
  step: (dir: 1 | -1) => void;
}

function buildOccNav(refs: {
  occMatchListRef: React.RefObject<OccurrenceMatch[]>;
  occSpecRef: React.RefObject<OccState | null>;
  occNavRef: React.RefObject<number>;
  occOriginRef: React.RefObject<{ anchor: string; column: number } | null>;
  selectLineRef: React.RefObject<
    (
      fileIndex: number,
      anchor: string,
      opts?: { keepOccurrences?: boolean }
    ) => void
  >;
}): OccNav {
  const {
    occMatchListRef,
    occSpecRef,
    occNavRef,
    occOriginRef,
    selectLineRef,
  } = refs;
  const indexAt = (anchor: string, column: number): number =>
    occMatchListRef.current.findIndex(
      (m) => m.anchor === anchor && m.start <= column && column <= m.end
    );
  const jumpTo = (index: number): void => {
    const spec = occSpecRef.current;
    const n = occMatchListRef.current.length;
    if (!spec || n === 0) {
      return;
    }
    const next = ((index % n) + n) % n;
    occNavRef.current = next;
    selectLineRef.current(
      spec.fileIndex,
      occMatchListRef.current[next].anchor,
      {
        keepOccurrences: true,
      }
    );
  };
  const step = (dir: 1 | -1): void => {
    if (occMatchListRef.current.length === 0) {
      return;
    }
    let at = occNavRef.current;
    if (at < 0) {
      const origin = occOriginRef.current;
      if (origin) {
        const found = indexAt(origin.anchor, origin.column);
        if (found >= 0) {
          at = found;
        } else if (dir > 0) {
          at = -1;
        } else {
          at = 0;
        }
      } else if (dir > 0) {
        at = -1;
      } else {
        at = 0;
      }
    }
    jumpTo(at + dir);
  };
  return { indexAt, jumpTo, step };
}

/**
 * The first match at/after a captured viewport position (a list item index),
 * wrapping to the top when everything is behind it. Matches without an item
 * (collapsed hunks) can't be compared and are skipped.
 */
function seededMatchIndex(
  matches: FindMatch[],
  model: ReviewListModel,
  seedItemIndex: number | null
): number {
  if (seedItemIndex === null || matches.length === 0) {
    return 0;
  }
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const idx = model.anchorItem.get(fileAnchorKey(m.fileIndex, m.anchor));
    if (idx !== undefined && idx >= seedItemIndex) {
      return i;
    }
  }
  return 0;
}

/**
 * The match at `index` as (file, row anchor, occurrence ordinal). Matches on
 * one line are adjacent in the list, so the ordinal is the run-length behind.
 */
function currentMatchAt(
  matches: FindMatch[],
  index: number
): FindCurrent | null {
  const m = matches[index];
  if (!m) {
    return null;
  }
  let ordinal = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const p = matches[i];
    if (p.fileIndex !== m.fileIndex || p.anchor !== m.anchor) {
      break;
    }
    ordinal += 1;
  }
  return { anchor: m.anchor, fileIndex: m.fileIndex, ordinal };
}

/**
 * A document selection pinned to a diff code line as character offsets — the
 * form that survives the line's text nodes being replaced by a marks repaint.
 * (hljs spans and marks never add or drop characters, so text offsets within
 * a .qf-code element are stable across repaints.)
 */
interface CapturedSelection {
  code: Element;
  end: number;
  start: number;
}

/**
 * Text offset of `target`'s start within its .qf-code element. hljs spans and
 * marks never add or drop characters, so this offset IS the code column.
 */
function codeColumnOf(code: Element, target: Node): number | null {
  let offset = 0;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node === target) {
      return offset;
    }
    offset += node.data.length;
  }
  return null;
}

/** The (text node, local offset) at a line-level code column — the inverse of
 *  codeColumnOf, for building Ranges across mark-fragmented lines. */
function codePositionAt(
  code: Element,
  column: number
): { node: Text; offset: number } | null {
  let offset = 0;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (column <= offset + node.data.length) {
      return { node, offset: column - offset };
    }
    offset += node.data.length;
  }
  return null;
}

/**
 * The occurrence an occ-spec commit came from: the row anchor and code column
 * of the caret / selection start, when it sits inside a diff code line.
 */
function occurrenceOriginFromDom(): { anchor: string; column: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    return null;
  }
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) {
    return null;
  }
  const el = node.parentElement;
  const code = el?.closest(".qf-code");
  const anchor = el?.closest("[data-anchor]")?.getAttribute("data-anchor");
  if (!(code && anchor)) {
    return null;
  }
  const base = codeColumnOf(code, node);
  return base === null ? null : { anchor, column: base + range.startOffset };
}

/** The current selection as offsets within its diff code line, if it has one. */
function captureCodeSelection(): CapturedSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return null;
  }
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const el = container instanceof Element ? container : container.parentElement;
  const code = el?.closest(".qf-code");
  if (!code) {
    return null;
  }
  let offset = 0;
  let start = -1;
  let end = -1;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node === range.startContainer) {
      start = offset + range.startOffset;
    }
    if (node === range.endContainer) {
      end = offset + range.endOffset;
    }
    offset += node.data.length;
  }
  if (start < 0 || end < 0 || start >= end) {
    return null;
  }
  return { code, end, start };
}

/** Re-selects the captured offsets over the element's current text nodes. */
function restoreCodeSelection({ code, start, end }: CapturedSelection): void {
  if (!code.isConnected) {
    return;
  }
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.data.length;
    if (!startNode && start < offset + len) {
      startNode = node;
      startOffset = start - offset;
    }
    if (!endNode && end <= offset + len) {
      endNode = node;
      endOffset = end - offset;
    }
    offset += len;
  }
  if (!(startNode && endNode)) {
    return;
  }
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const sel = window.getSelection();
  if (!sel) {
    return;
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The inbox cache's view of a PR, for painting the shell before detail loads. */
function findCachedInboxPr(
  owner: string,
  repo: string,
  number: number
): PullRequest | undefined {
  const match = (p: PullRequest) =>
    p.owner === owner && p.name === repo && p.number === number;
  const inbox = queryClient.getQueryData<InboxData>(queryKeys.inbox);
  if (inbox) {
    for (const key of [
      "reviewRequested",
      "assigned",
      "created",
      "involved",
    ] as const) {
      const hit = inbox[key].prs.find(match);
      if (hit) {
        return hit;
      }
    }
  }
  return queryClient
    .getQueryData<InboxBucket>(queryKeys.subscribed)
    ?.prs.find(match);
}

/** A branch name as a copyable chip: click copies the name, the icon confirms. */
function BranchChip({ name, label }: { name: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    []
  );
  const onCopy = () => {
    copyTextToClipboard(name);
    setCopied(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      className={cn("qf-branch-chip", copied && "qf-branch-copied")}
      onClick={onCopy}
      title={copied ? "Copied" : label}
      type="button"
    >
      {copied ? (
        <Check aria-hidden size={11} />
      ) : (
        <GitBranch aria-hidden size={11} />
      )}
      {name}
    </button>
  );
}
