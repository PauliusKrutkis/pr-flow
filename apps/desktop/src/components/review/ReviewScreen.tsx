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
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCommentMutations } from "../../hooks/useComments.ts";
import { useInboxDetailNudge } from "../../hooks/useInboxDetailNudge.ts";
import { useLatest } from "../../hooks/useLatest.ts";
import { usePullRequestDetail } from "../../hooks/usePullRequestDetail.ts";
import { useReviewHeadShaSync } from "../../hooks/useReviewHeadShaSync.ts";
import { useViewedFileReconcile } from "../../hooks/useViewedFileReconcile.ts";
import type { Binding } from "../../keyboard/types.ts";
import { useHotkeys } from "../../keyboard/useHotkeys.ts";
import { cn } from "../../lib/cn.ts";
import { type FindMatch, findInDiff } from "../../lib/findInDiff.ts";
import { warmHighlightCache } from "../../lib/highlight.ts";
import {
  type OccurrenceMatch,
  type OccurrenceSpec,
  occurrenceMatches,
  occurrenceSpecFromSelection,
} from "../../lib/occurrences.ts";
import { usePerfStore } from "../../lib/perf.ts";
import { queryClient, queryKeys } from "../../lib/queryClient.ts";
import {
  adjacentSelectableAnchor,
  anchorLine,
  buildReviewItems,
  fileAnchorKey,
  type ReviewListModel,
} from "../../lib/reviewItems.ts";
import { getReviewMemory, updateReviewMemory } from "../../lib/reviewMemory.ts";
import { fingerprintFile } from "../../lib/viewedFingerprint.ts";
import { useAppStore } from "../../store/appStore.ts";
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
import { Avatar } from "../ui/Avatar.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { TicketTitle } from "../ui/TicketTitle.tsx";
import { FileSidebar } from "./FileSidebar.tsx";
import { FindBar } from "./FindBar.tsx";
import { isImageFile } from "./ImageDiff.tsx";
import { OverviewRuler } from "./OverviewRuler.tsx";
import { PrSearch } from "./PrSearch.tsx";
import {
  type FindCurrent,
  type MarkSpec,
  ReviewList,
  type ReviewListCallbacks,
  type ReviewListHandle,
} from "./ReviewList.tsx";
import { RightPanel } from "./RightPanel.tsx";
import { SubmitReviewModal } from "./SubmitReviewModal.tsx";

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

export function ReviewScreen({ routeKey }: ReviewScreenProps) {
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

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findIndex, setFindIndex] = useState<number | null>(null);
  const [findSeed, setFindSeed] = useState<number | null>(null);
  const [findFocusSeq, setFindFocusSeq] = useState(0);

  const findJumpedRef = useRef(false);
  const findOpenRef = useLatest(findOpen);

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

  const activeThreadRef = useRef<{ rootId: number; path: string } | null>(null);

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
  const viewedSet = useMemo(
    () => new Set(Object.keys(viewedFiles ?? {})),
    [viewedFiles]
  );

  const files = useMemo(() => detail?.files ?? [], [detail]);
  const fileCount = files.length;
  const clampedIndex = Math.min(activeIndex, Math.max(fileCount - 1, 0));
  const activeFile = files[clampedIndex];

  const activeIndexRef = useLatest(clampedIndex);
  const fileCountRef = useLatest(fileCount);
  const filesRef = useLatest(files);
  const commentsRef = useLatest<ReviewComment[]>(
    detail?.comments ?? EMPTY_COMMENTS
  );

  useEffect(() => {
    activeThreadRef.current = null;
  }, [files]);

  const commentsByFile = useMemo(() => {
    const m = new Map<string, ReviewComment[]>();
    for (const c of detail?.comments ?? []) {
      const arr = m.get(c.path) ?? [];
      arr.push(c);
      m.set(c.path, arr);
    }
    return m;
  }, [detail?.comments]);
  const pendingByFile = useMemo(() => {
    const m = new Map<string, PendingComment[]>();
    for (const p of pending) {
      const arr = m.get(p.path) ?? [];
      arr.push(p);
      m.set(p.path, arr);
    }
    return m;
  }, [pending]);

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

  const liveSelection = (() => {
    if (!selection) {
      return null;
    }
    const a = model.anchorItem.get(
      fileAnchorKey(selection.fileIndex, selection.from)
    );
    const b = model.anchorItem.get(
      fileAnchorKey(selection.fileIndex, selection.to)
    );
    if (a == null || b == null || a === b) {
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
  })();
  const selectionRef = useLatest(selection);
  const liveSelectionRef = useLatest(liveSelection);

  useEffect(() => {
    if (files.length === 0) {
      return;
    }
    return warmHighlightCache(files);
  }, [files]);

  useReviewHeadShaSync(keyValue, pr, setToast);
  useInboxDetailNudge(keyValue, pr);
  useViewedFileReconcile(
    keyValue,
    pr,
    files,
    viewedFiles,
    reconcileViewed,
    setChangedSinceViewed,
    setToast
  );

  useEffect(() => {
    if (!detail || fileCount === 0) {
      return;
    }
    updateReviewMemory(keyValue, { fileIndex: clampedIndex });
  }, [detail, fileCount, clampedIndex, keyValue]);

  const resumeCorrectedRef = useRef(false);
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
      } else if (idx != null) {
        listRef.current?.scrollItemTo(idx, t.top);
      }
      tries += 1;
      if (tries < 12) {
        raf = requestAnimationFrame(step);
      }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [detail, initialMem, modelRef]);

  useEffect(() => {
    requestAnimationFrame(() => usePerfStore.getState().completeFile());
  }, [clampedIndex]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
      if (threadFlashRef.current) {
        clearTimeout(threadFlashRef.current);
      }
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      if (saveStateTimerRef.current) {
        clearTimeout(saveStateTimerRef.current);
      }
      if (fileRafRef.current != null) {
        cancelAnimationFrame(fileRafRef.current);
      }
      if (cursorRafRef.current != null) {
        cancelAnimationFrame(cursorRafRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function pageScroll(dir: number) {
    const el = listRef.current?.scroller();
    if (el) {
      el.scrollBy({ top: dir * el.clientHeight * 0.85 });
    }
  }

  const cursorRef = useLatest(liveCursor);

  const userMovedCursorRef = useRef(false);

  const keyboardHoldRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const isRealPointer = (x: number, y: number): boolean => {
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
  };

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

  /**
   * shift+j/k: grow (or shrink) the range one row at a time. The moving end
   * follows the keyboard; the cursor rides along so the accent and any
   * follow-up `c` agree about where you are.
   */
  function extendSelection(delta: 1 | -1) {
    const m = modelRef.current;
    keyboardHoldRef.current = true;
    setInputMode("keyboard");
    const sel = selectionRef.current;
    if (sel) {
      const next = adjacentSelectableAnchor(
        m,
        sel.fileIndex,
        sel.side,
        sel.hunkIndex,
        sel.to,
        delta
      );
      if (!next) {
        return;
      }
      if (next === sel.from) {
        setSelection(null);
        setCursor({ anchor: next, fileIndex: sel.fileIndex });
        return;
      }
      setSelection({ ...sel, to: next });
      setCursor({ anchor: next, fileIndex: sel.fileIndex });
      const itemIndex = m.anchorItem.get(fileAnchorKey(sel.fileIndex, next));
      if (itemIndex != null) {
        listRef.current?.nudgeItemIntoView(itemIndex);
      }
      return;
    }

    const cur = cursorRef.current;
    if (!cur) {
      buildCursorMover(cursorMoverRefs).move(delta, false);
      return;
    }
    const item =
      m.items[m.anchorItem.get(fileAnchorKey(cur.fileIndex, cur.anchor)) ?? -1];
    if (item?.kind !== "row" || item.target == null) {
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
    if (itemIndex != null) {
      listRef.current?.nudgeItemIntoView(itemIndex);
    }
  }

  const dragRef = useRef<{
    fileIndex: number;
    side: string;
    hunkIndex: number;
    from: string;
  } | null>(null);

  const cbRef = useLatest({
    async onAddComment(a: {
      path: string;
      line: number;
      side: string;
      body: string;
      startLine?: number;
    }) {
      await addReviewComment.mutateAsync({
        body: a.body,
        commitId: headShaRef.current,
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
      addPendingStore(keyValue, c);
    },
    onCloseBox(fileIndex: number, anchor: string) {
      setOpenBoxes((prev) => {
        const next = new Map(prev);
        next.delete(fileAnchorKey(fileIndex, anchor));
        return next;
      });
      setSelection(null);
    },
    onCopyPath(fileIndex: number) {
      const f = filesRef.current[fileIndex];
      if (!f) {
        return;
      }
      void navigator.clipboard?.writeText(f.filename).catch(() => {});
      setCopiedPathIndex(fileIndex);
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = setTimeout(() => setCopiedPathIndex(null), 1200);
    },
    onMouseMove(x: number, y: number) {
      if (!isRealPointer(x, y)) {
        return;
      }
      setInputMode((mo) => (mo === "mouse" ? mo : "mouse"));
    },
    onOpenBox(fileIndex: number, anchor: string, startLine?: number) {
      setOpenBoxes((prev) =>
        new Map(prev).set(fileAnchorKey(fileIndex, anchor), startLine ?? null)
      );
    },
    onPlusDragEnd() {
      const d = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!d) {
        return;
      }
      const live = liveSelectionRef.current;
      const m = modelRef.current;
      if (live && live.fileIndex === d.fileIndex) {
        const endItem = m.items[live.toItem];
        const startItem = m.items[live.fromItem];
        if (
          endItem?.kind === "row" &&
          endItem.anchor &&
          startItem?.kind === "row"
        ) {
          cbRef.current.onOpenBox(
            d.fileIndex,
            endItem.anchor,
            anchorLine(startItem.anchor ?? endItem.anchor)
          );
          return;
        }
      }
      cbRef.current.onOpenBox(d.fileIndex, d.from);
    },
    onPlusDragOver(fileIndex: number, anchor: string) {
      const d = dragRef.current;
      if (!d || fileIndex !== d.fileIndex) {
        return;
      }
      setCursor({ anchor, fileIndex });
      if (anchor === d.from) {
        setSelection(null);
        return;
      }

      const m = modelRef.current;
      const fromIdx = m.navIndexOf.get(fileAnchorKey(fileIndex, d.from));
      const toIdx = m.navIndexOf.get(fileAnchorKey(fileIndex, anchor));
      if (fromIdx == null || toIdx == null) {
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
        setSelection(null);
        return;
      }
      setSelection({
        fileIndex: d.fileIndex,
        from: d.from,
        hunkIndex: d.hunkIndex,
        side: d.side,
        to: last,
      });
    },
    onPlusDragStart(fileIndex: number, anchor: string) {
      const m = modelRef.current;
      const item =
        m.items[m.anchorItem.get(fileAnchorKey(fileIndex, anchor)) ?? -1];
      if (item?.kind !== "row" || item.target == null) {
        return;
      }
      dragRef.current = {
        fileIndex,
        from: anchor,
        hunkIndex: item.hunkIndex,
        side: item.target.side,
      };
      setDragging(true);
    },
    onRemovePending(id: string) {
      removePendingStore(keyValue, id);
    },
    async onReply(a: { inReplyTo: number; body: string }) {
      await reply.mutateAsync(a);
    },
    onResolveThread(a: { threadId: string; resolved: boolean }) {
      resolveThread.mutate(a);
    },
    onRowEnter(fileIndex: number, anchor: string, x: number, y: number) {
      if (!isRealPointer(x, y)) {
        return;
      }
      setInputMode((mo) => (mo === "mouse" ? mo : "mouse"));
      setCursor((cur) =>
        cur && cur.fileIndex === fileIndex && cur.anchor === anchor
          ? cur
          : { anchor, fileIndex }
      );
      setActiveIndex((cur) => (cur === fileIndex ? cur : fileIndex));
    },
    onScroll() {
      handleListScroll();
    },
    onThreadHover(t: { rootId: number; path: string } | null) {
      activeThreadRef.current = t;
    },
    onToggleHunk(fileIndex: number, hunkIndex: number) {
      setCollapsed((prev) => {
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
      const f = filesRef.current[fileIndex];
      if (f) {
        toggleViewedWithFp(f);
      }
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

  function commentAtCursor() {
    const m = modelRef.current;

    const sel = liveSelectionRef.current;
    if (sel) {
      const endItem = m.items[sel.toItem];
      const startItem = m.items[sel.fromItem];
      if (
        endItem?.kind === "row" &&
        endItem.anchor != null &&
        startItem?.kind === "row" &&
        startItem.anchor != null
      ) {
        cbRef.current.onOpenBox(
          sel.fileIndex,
          endItem.anchor,
          anchorLine(startItem.anchor)
        );
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
    cbRef.current.onOpenBox(entry.fileIndex, entry.anchor);
  }

  function scrollToFile(i: number) {
    if (fileCountRef.current === 0) {
      return;
    }
    const target = Math.min(Math.max(i, 0), fileCountRef.current - 1);
    usePerfStore.getState().markFileStart();
    setActiveIndex(target);
    activeIndexRef.current = target;
    setCommentIndex(0);
    setOccSpec(null);
    setSelection(null);
    listRef.current?.scrollToFileStart(target);
  }

  const fileDeltaRef = useRef(0);
  const fileRafRef = useRef<number | null>(null);
  function flushFileMove() {
    fileRafRef.current = null;
    const delta = fileDeltaRef.current;
    fileDeltaRef.current = 0;
    if (delta === 0) {
      return;
    }
    scrollToFile(activeIndexRef.current + delta);
  }
  function moveFile(delta: number) {
    if (fileCountRef.current === 0) {
      return;
    }
    fileDeltaRef.current += delta;
    if (fileRafRef.current == null) {
      fileRafRef.current = requestAnimationFrame(flushFileMove);
    }
  }
  const nextFile = () => moveFile(1);
  const prevFile = () => moveFile(-1);

  function cycleFile(dir: number) {
    const n = fileCountRef.current;
    if (n === 0) {
      return;
    }
    scrollToFile((activeIndexRef.current + dir + n) % n);
  }

  /**
   * From file search: open the file and seat the cursor on its first line,
   * so `c` (and j/k) work immediately without a hover.
   */
  function selectFileFromSearch(fileIndex: number) {
    scrollToFile(fileIndex);
    const entry = modelRef.current.nav.find((n) => n.fileIndex === fileIndex);
    if (entry) {
      keyboardHoldRef.current = true;
      setInputMode("keyboard");
      setCursor({ anchor: entry.anchor, fileIndex: entry.fileIndex });
    }
  }

  function selectLine(
    fileIndex: number,
    anchor: string,
    opts: { keepOccurrences?: boolean } = {}
  ) {
    const m = modelRef.current;
    const key = fileAnchorKey(fileIndex, anchor);
    usePerfStore.getState().markFileStart();
    setActiveIndex(fileIndex);
    activeIndexRef.current = fileIndex;
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
    if (itemIndex != null) {
      listRef.current?.centerItem(itemIndex);
    }
  }

  const selectLineRef = useLatest(selectLine);

  const findMatches =
    findOpen && findQuery
      ? findInDiff(files, findQuery, { caseSensitive: findCase })
      : EMPTY_MATCHES;

  /** Re-anchor find to the viewport: the first row visible below the sticky
   *  header (read from the rendered DOM — exact, and only ~40 rows exist). */
  function captureFindSeed() {
    setFindSeed(listRef.current?.firstVisibleRowItem() ?? null);
  }

  const findSeededIndex = seededMatchIndex(findMatches, model, findSeed);

  const findSafeIndex =
    findMatches.length > 0
      ? Math.min(findIndex ?? findSeededIndex, findMatches.length - 1)
      : 0;

  const findCurrent = currentMatchAt(findMatches, findSafeIndex);

  /**
   * Every query edit re-anchors to the viewport: after a jump the viewport IS
   * the last match, so typing more keeps searching from where you are.
   */
  function changeFindQuery(q: string) {
    captureFindSeed();
    setFindQuery(q);
    setFindIndex(null);
    findJumpedRef.current = false;
  }
  function toggleFindCase() {
    captureFindSeed();
    setFindCase((c) => !c);
    setFindIndex(null);
    findJumpedRef.current = false;
  }
  function openFind() {
    if (!findOpenRef.current) {
      captureFindSeed();
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
  }
  /**
   * Closing clears the find highlights (marks fall back to the selection's
   * occurrences, if any); focus falls back to the document — j/k works.
   */
  function closeFind() {
    setFindOpen(false);
  }
  /**
   * Enter/next/prev: the first press jumps to the CURRENT match, later ones
   * step (with wrap-around).
   */
  function findStep(dir: 1 | -1) {
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
  }

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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const occNav = buildOccNav({
      occMatchListRef,
      occNavRef,
      occOriginRef,
      occSpecRef,
      selectLineRef,
    });

    /**
     * Skip identity-preserving updates entirely: no repaint on selection
     * noise, and no pointless selection restore.
     */

    function commit(next: OccState | null) {
      const prev = occSpecRef.current;
      occOriginRef.current = next ? occurrenceOriginFromDom() : null;
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

    /** The code element around `el`, or null off the diff / on hunk headers
     *  (they share .qf-code but are metadata, not code). */
    function codeAround(el: Element | null | undefined): Element | null {
      const code = el?.closest(".qf-code") ?? null;
      return code && !el?.closest(".qf-row-hunk") ? code : null;
    }

    /** The file index a code element belongs to (rows carry it directly). */
    function fileIndexOf(el: Element): number | null {
      const v = el
        .closest("[data-file-index]")
        ?.getAttribute("data-file-index");
      const n = v == null ? Number.NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function specFromDomSelection(): OccState | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        return null;
      }
      const container = sel.getRangeAt(0).commonAncestorContainer;
      const el =
        container instanceof Element ? container : container.parentElement;

      const code = codeAround(el);
      if (!code) {
        return null;
      }
      const fileIndex = fileIndexOf(code);
      if (fileIndex == null) {
        return null;
      }
      const spec = occurrenceSpecFromSelection(sel.toString());
      return spec && { ...spec, fileIndex };
    }

    /** The \w+ word around the caret position at (x, y). */
    function wordAtPoint(x: number, y: number): OccState | null {
      const doc = document as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number
        ) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      };
      let node: Node | null = null;
      let offset = 0;
      if (doc.caretPositionFromPoint) {
        const pos = doc.caretPositionFromPoint(x, y);
        if (pos) {
          node = pos.offsetNode;
          offset = pos.offset;
        }
      } else if (doc.caretRangeFromPoint) {
        const r = doc.caretRangeFromPoint(x, y);
        if (r) {
          node = r.startContainer;
          offset = r.startOffset;
        }
      }
      if (!node || node.nodeType !== Node.TEXT_NODE) {
        return null;
      }
      const parent = node.parentElement;
      if (!parent) {
        return null;
      }
      const code = codeAround(parent);
      if (!code) {
        return null;
      }
      const fileIndex = fileIndexOf(code);
      if (fileIndex == null) {
        return null;
      }

      const text = code.textContent ?? "";
      const nodeStart = codeColumnOf(code, node);
      if (nodeStart == null) {
        return null;
      }
      const col = nodeStart + offset;
      let s = col;
      let e = col;
      while (s > 0 && /\w/.test(text[s - 1])) {
        s -= 1;
      }
      while (e < text.length && /\w/.test(text[e])) {
        e += 1;
      }
      if (s === e) {
        return null;
      }

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
      return spec && { ...spec, fileIndex };
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
      if (timer != null) {
        clearTimeout(timer);
      }
      timer = setTimeout(apply, 150);
    }

    function onClick(e: MouseEvent) {
      if (findOpenRef.current) {
        return;
      }
      if (e.detail > 1) {
        return;
      }
      const target = e.target instanceof Element ? e.target : null;
      if (!codeAround(target)) {
        return;
      }

      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) {
        return;
      }

      const mark = target?.closest("mark.qf-occ-mark");
      if (mark && occSpecRef.current) {
        const code = codeAround(mark);
        const anchor = mark
          .closest("[data-anchor]")
          ?.getAttribute("data-anchor");
        const textNode = mark.firstChild;
        if (code && anchor && textNode) {
          const column = codeColumnOf(code, textNode);
          const at = column == null ? -1 : occNav.indexAt(anchor, column);
          occNav.jumpTo((at >= 0 ? at : occNavRef.current) + 1);
          return;
        }
      }
      commit(wordAtPoint(e.clientX, e.clientY));
    }

    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("click", onClick);
      if (timer != null) {
        clearTimeout(timer);
      }
    };
  }, [
    findOpenRef,
    occSpecRef,
    occMatchListRef,
    occNavRef,
    occOriginRef,
    selectLineRef,
  ]);

  useLayoutEffect(() => {
    const captured = occRestoreRef.current;
    occRestoreRef.current = null;
    if (captured) {
      restoreCodeSelection(captured);
    }
  }, [occSpec]);

  const marks: MarkSpec | null = findOpen
    ? findQuery
      ? { caseSensitive: findCase, kind: "find", query: findQuery }
      : null
    : occSpec
      ? {
          fileIndex: occSpec.fileIndex,
          kind: "occurrence",
          query: occSpec.query,
          wholeWord: occSpec.wholeWord,
        }
      : null;

  const rulerFractions: number[] =
    model.items.length === 0
      ? EMPTY_FRACTIONS
      : findOpen && findQuery
        ? findMatches.map((m) => {
            const idx = model.anchorItem.get(
              fileAnchorKey(m.fileIndex, m.anchor)
            );
            return idx == null ? -1 : idx / model.items.length;
          })
        : occSpec
          ? occMatchList.map((m) => {
              const idx = model.anchorItem.get(
                fileAnchorKey(occSpec.fileIndex, m.anchor)
              );
              return idx == null ? -1 : idx / model.items.length;
            })
          : EMPTY_FRACTIONS;

  const headShaRef = useLatest(pr?.headSha ?? "");

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

  function toggleViewedFile() {
    if (activeFile) {
      toggleViewedWithFp(activeFile);
    }
  }
  /**
   * `e`: toggle the current file's viewed state. Marking advances to the next
   * file; UNmarking stays put (you're revisiting, not moving on).
   */

  function markViewedAndNext() {
    if (!activeFile) {
      return;
    }
    const wasViewed = viewedSet.has(activeFile.filename);
    toggleViewedWithFp(activeFile);
    if (!wasViewed) {
      scrollToFile(activeIndexRef.current + 1);
    }
  }
  /** Both copies confirm through the shared toast host. */

  function copyLink() {
    if (!pr?.url) {
      return;
    }
    void navigator.clipboard?.writeText(pr.url).catch(() => {});
    setToast({ message: pr.url, title: "Copied PR link" });
  }
  function copyFilePath() {
    if (!activeFile) {
      return;
    }
    void navigator.clipboard?.writeText(activeFile.filename).catch(() => {});
    setToast({ message: activeFile.filename, title: "Copied file path" });
  }

  /** After submitting, jump to the next review-requested PR (or back to inbox). */

  function advanceAfterSubmit() {
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

  const threadFlashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function jumpToThread(path: string, rootId: number) {
    const m = modelRef.current;
    const fileIndex = filesRef.current.findIndex((f) => f.filename === path);
    if (fileIndex < 0) {
      return;
    }
    setRightOpen(false);
    usePerfStore.getState().markFileStart();
    setActiveIndex(fileIndex);
    activeIndexRef.current = fileIndex; // eager — see scrollToFile
    const itemIndex = m.commentItems.find((i) => {
      const it = m.items[i];
      return (
        it.kind === "comments" &&
        it.fileIndex === fileIndex &&
        it.threads.some((t) => t[0]?.id === rootId)
      );
    });
    if (itemIndex == null) {
      listRef.current?.scrollToFileStart(fileIndex);
      return;
    }
    listRef.current?.centerItem(itemIndex);
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

  /**
   * ]c/[c walk the comment blocks by ITEM index — virtualization means
   * off-screen comments have no DOM to query, but the model knows them all.
   */

  function goToComment(delta: number) {
    const list = modelRef.current.commentItems;
    if (list.length === 0) {
      return;
    }
    const next = (commentIndex + delta + list.length) % list.length;
    setCommentIndex(next);
    listRef.current?.centerItem(list[next]);

    const item = modelRef.current.items[list[next]];
    activeThreadRef.current =
      item?.kind === "comments" && item.threads.length > 0
        ? {
            path: filesRef.current[item.fileIndex]?.filename ?? "",
            rootId: item.threads[0][0].id,
          }
        : null;
  }

  /**
   * `r`: reply to the hovered/]c-focused thread when there is one (and its
   * root still exists in the cache — it may have vanished on a refetch);
   * otherwise keep its historical meaning, next file.
   */

  function replyToActiveThreadOrNextFile() {
    const t = activeThreadRef.current;
    if (t && commentsRef.current.some((c) => c.id === t.rootId)) {
      replyNonceRef.current += 1;
      setReplyReq({ ...t, nonce: replyNonceRef.current });
      return;
    }
    nextFile();
  }

  /**
   * `x`: flip the hovered/]c-focused thread's resolved state. Same target as
   * `r`, but no fallback meaning — with no thread under aim, nothing happens.
   * The root is re-read from the cache: threadId/resolved must be current, and
   * the thread may have vanished on a refetch.
   */

  function resolveActiveThread() {
    const t = activeThreadRef.current;
    if (!t) {
      return;
    }
    const root = commentsRef.current.find((c) => c.id === t.rootId);
    if (!root || root.threadId == null) {
      return;
    }
    resolveThread.mutate({ resolved: !root.resolved, threadId: root.threadId });
  }

  function openSubmit() {
    submitReview.reset();
    setSubmitOpen(true);
  }

  /** Optimistic: close + advance immediately; the network settles behind you. */

  function handleSubmitReview(event: ReviewEvent, body: string) {
    const payload = {
      body,
      comments: pending.map((p) => ({
        body: p.body,
        line: p.line,
        path: p.path,
        side: p.side,
        startLine: p.startLine,
      })),
      commitId: pr?.headSha ?? "",
      event,
    };
    setSubmitOpen(false);
    advanceAfterSubmit();
    submitReview
      .mutateAsync(payload)
      .then(() => clearPendingComments(keyValue))
      .catch((e) => {
        setFlash(
          `Review for ${owner}/${repo}#${number} didn't submit — your comments are still pending. ${String(e)}`
        );
      });
  }

  useHotkeys("review", [
    {
      description: "Next line",
      group: "Navigation",
      icon: ArrowDown,
      keys: ["j", "down"],
      run: (e) => {
        setSelection(null);
        buildCursorMover(cursorMoverRefs).move(1, e.repeat);
      },
    },
    {
      description: "Previous line",
      group: "Navigation",
      icon: ArrowUp,
      keys: ["k", "up"],
      run: (e) => {
        setSelection(null);
        buildCursorMover(cursorMoverRefs).move(-1, e.repeat);
      },
    },
    {
      description: "Extend selection down",
      group: "Comments",
      icon: ArrowDown,
      keys: ["shift+j", "shift+down"],
      run: () => extendSelection(1),
    },
    {
      description: "Extend selection up",
      group: "Comments",
      icon: ArrowUp,
      keys: ["shift+k", "shift+up"],
      run: () => extendSelection(-1),
    },
    {
      description: "Comment on line / selection",
      group: "Comments",
      icon: MessageSquarePlus,
      keys: "c",
      run: commentAtCursor,
    },
    {
      description: "Reply to comment / next file",
      group: "Files",
      icon: ChevronRight,
      keys: ["r"],
      run: replyToActiveThreadOrNextFile,
    },
    {
      description: "Previous file",
      group: "Files",
      icon: ChevronLeft,
      keys: ["t"],
      run: prevFile,
    },
    {
      description: "Cycle files",
      group: "Files",
      icon: ArrowLeftRight,
      keys: "tab",
      run: (e) => cycleFile(e.shiftKey ? -1 : 1),
    },
    {
      description: "Page down",
      group: "Navigation",
      icon: ChevronsDown,
      keys: ["space", "pagedown"],
      run: () => pageScroll(1),
    },
    {
      description: "Page up",
      group: "Navigation",
      icon: ChevronsUp,
      keys: ["pageup"],
      run: () => pageScroll(-1),
    },
    {
      description: "Next comment",
      group: "Comments",
      icon: MessageSquare,
      keys: "]c",
      run: () => goToComment(1),
    },
    {
      description: "Previous comment",
      group: "Comments",
      icon: MessageSquare,
      keys: "[c",
      run: () => goToComment(-1),
    },
    {
      description: "Resolve / unresolve comment",
      group: "Comments",
      icon: CheckCircle2,
      keys: "x",
      run: resolveActiveThread,
    },
    {
      description: "Mark viewed & next",
      group: "Files",
      icon: CheckCheck,
      keys: "e",
      run: markViewedAndNext,
    },
    {
      description: "Toggle file viewed",
      group: "Files",
      icon: Check,
      keys: "v",
      run: toggleViewedFile,
    },
    {
      description: "Submit review",
      group: "Review",
      icon: Send,
      keys: "s",
      run: openSubmit,
    },
    {
      description: "Open files in the browser",
      group: "General",
      icon: ExternalLink,
      keys: "o",
      run: () => {
        if (!pr) {
          return;
        }

        const files = pr.url.includes("/-/merge_requests/")
          ? "/diffs"
          : "/files";
        void openUrl(pr.url + files);
      },
    },
    {
      description: "Copy PR link",
      group: "General",
      icon: Link,
      keys: "y",
      run: copyLink,
    },
    {
      description: "Copy file path",
      group: "Files",
      icon: Copy,
      keys: "mod+shift+c",
      run: copyFilePath,
    },
    {
      description: "Toggle info panel",
      group: "General",
      icon: Info,
      keys: "i",
      run: () => setRightOpen((o) => !o),
    },
    {
      description: "Find a file",
      group: "Navigation",
      icon: FileSearch,
      keys: "mod+t",
      run: () => setPrSearch("files"),
    },
    {
      description: "Search code",
      group: "Navigation",
      icon: Search,
      keys: "mod+r",
      run: () => setPrSearch("text"),
    },
    {
      description: "Find in diff",
      group: "Navigation",
      icon: TextSearch,
      keys: "mod+f",
      run: openFind,
    },
    ...(findOpen
      ? ([
          {
            description: "Next find match",
            hidden: true,
            keys: ["enter", "f3"],
            run: (e) => findStep(e.shiftKey ? -1 : 1),
          },
          {
            description: "Next find match",
            hidden: true,
            keys: "mod+g",
            run: (e) => findStep(e.shiftKey ? -1 : 1),
          },
        ] satisfies Binding[])
      : []),
    ...(occSpec
      ? ([
          {
            description: "Next occurrence",
            hidden: true,
            keys: "n",
            run: () => buildOccNav(occNavRefs).step(1),
          },
          {
            description: "Previous occurrence",
            hidden: true,
            keys: "p",
            run: () => buildOccNav(occNavRefs).step(-1),
          },
        ] satisfies Binding[])
      : []),
    {
      description: "Close panel / back to inbox",
      group: "Navigation",
      icon: Inbox,
      keys: "esc",
      run: () => {
        if (selectionRef.current) {
          setSelection(null);
        } else if (findOpenRef.current) {
          closeFind();
        } else if (rightOpenRef.current) {
          setRightOpen(false);
        } else {
          goInbox();
        }
      },
    },
  ]);

  if (!(detail && pr)) {
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
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  className="qf-skel"
                  key={i}
                  style={{
                    height: 17,
                    margin: "10px 8px",
                    width: `${88 - (i % 4) * 16}%`,
                  }}
                />
              ))}
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
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                className="qf-skel"
                key={i}
                style={{
                  height: 12,
                  margin: "11px 0",
                  width: `${((i * 37) % 52) + 32}%`,
                }}
              />
            ))}
          </div>
        </main>
      </div>
    );
  }

  const stateClass = pr.draft
    ? "qf-state-draft"
    : pr.merged
      ? "qf-state-merged"
      : pr.state === "open"
        ? "qf-state-open"
        : "qf-state-draft";
  const stateLabel = pr.draft
    ? "Draft"
    : pr.merged
      ? "Merged"
      : pr.state === "open"
        ? "Open"
        : pr.state;

  const viewedNow = viewedSet.size;
  const isOwnPr = !!activeLogin && pr.author === activeLogin;
  const reviews = detail.reviews ?? [];

  const convoCount =
    (detail.issueComments?.length ?? 0) +
    reviews.filter((r) => r.body.trim().length > 0).length +
    detail.comments.filter((c) => c.inReplyToId == null).length;
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
              {pr.baseRef && pr.headRef && (
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
            <span className="qf-muted text-xs">
              {viewedNow}/{fileCount} viewed
            </span>
            <div className="qf-stat-group">
              <span className="qf-add">+{pr.additions}</span>
              <span className="qf-del">−{pr.deletions}</span>
            </div>
            <button
              className="qf-back qf-focusable"
              onClick={() => void openUrl(pr.url)}
              title="Open on GitHub (o)"
              type="button"
            >
              Open ↗
            </button>
            <button
              aria-pressed={rightOpen}
              className="qf-info-btn qf-focusable"
              onClick={() => setRightOpen((o) => !o)}
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
            onNext={() => findStep(1)}
            onPrev={() => findStep(-1)}
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
        onAddIssueComment={async (body) => {
          await addIssueComment.mutateAsync({ body });
        }}
        onClose={() => setRightOpen(false)}
        onJumpToThread={jumpToThread}
        open={rightOpen}
        pr={pr}
        reviews={reviews}
      />

      <SubmitReviewModal
        busy={false}
        error={null}
        onClose={() => setSubmitOpen(false)}
        onSubmit={handleSubmitReview}
        open={submitOpen}
        ownPr={isOwnPr}
        pendingCount={pending.length}
      />

      <PrSearch
        files={files}
        mode={prSearch ?? "files"}
        onClose={() => setPrSearch(null)}
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
  setCursor: (c: CursorPos) => void;
  setActiveIndex: (i: number) => void;
  setInputMode: (m: "keyboard" | "mouse") => void;
}): { move(delta: number, isRepeat: boolean): void } {
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
      const multiplier = held >= 24 ? 6 : held >= 8 ? 3 : 1;
      refs.pendingDeltaRef.current += delta * multiplier;
      if (refs.cursorRafRef.current == null) {
        refs.cursorRafRef.current = requestAnimationFrame(flush);
      }
    },
  };
}

/** Occurrence navigation over the current match list — see occNavRefs. */
interface OccNav {
  /** Index in the match list of the occurrence covering (anchor, column). */
  indexAt(anchor: string, column: number): number;
  /** Jump to match `index` (wrapping), keeping the marks alive. */
  jumpTo(index: number): void;
  /** n/p: step relative to the last-jumped position (or the origin
   *  occurrence — the clicked/selected one — before any jump). */
  step(dir: 1 | -1): void;
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
      const found = origin ? indexAt(origin.anchor, origin.column) : -1;
      at = found >= 0 ? found : dir > 0 ? -1 : 0;
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
  if (seedItemIndex == null || matches.length === 0) {
    return 0;
  }
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const idx = model.anchorItem.get(fileAnchorKey(m.fileIndex, m.anchor));
    if (idx != null && idx >= seedItemIndex) {
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
  for (let i = index - 1; i >= 0; i--) {
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
  return base == null ? null : { anchor, column: base + range.startOffset };
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
  return (
    <button
      className={cn("qf-branch-chip", copied && "qf-branch-copied")}
      onClick={() => {
        void navigator.clipboard?.writeText(name).catch(() => {});
        setCopied(true);
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        timerRef.current = setTimeout(() => setCopied(false), 1200);
      }}
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
