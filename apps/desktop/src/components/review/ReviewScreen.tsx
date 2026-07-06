import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  CheckCheck,
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
import { prKey } from "../../types";
import type {
  ChangedFile,
  InboxBucket,
  InboxData,
  PendingComment,
  PullRequest,
  ReviewComment,
  ReviewEvent,
} from "../../types";
import { useAppStore } from "../../store/appStore";
import { useHotkeys } from "../../keyboard/useHotkeys";
import type { Binding } from "../../keyboard/types";
import { usePullRequestDetail } from "../../hooks/usePullRequestDetail";
import { useInbox } from "../../hooks/useInbox";
import { useCommentMutations } from "../../hooks/useComments";
import { queryClient, queryKeys } from "../../lib/queryClient";
import { useLatest } from "../../hooks/useLatest";
import { getReviewMemory, updateReviewMemory } from "../../lib/reviewMemory";
import { fingerprintFile } from "../../lib/viewedFingerprint";
import { usePerfStore } from "../../lib/perf";
import { warmHighlightCache } from "../../lib/highlight";
import { findInDiff, type FindMatch } from "../../lib/findInDiff";
import {
  occurrenceMatches,
  occurrenceSpecFromSelection,
  type OccurrenceMatch,
  type OccurrenceSpec,
} from "../../lib/occurrences";
import {
  buildReviewItems,
  fileAnchorKey,
  type ReviewListModel,
} from "../../lib/reviewItems";
import { cn } from "../../lib/cn";
import { Kbd } from "../ui/Kbd";
import { TicketTitle } from "../ui/TicketTitle";
import { Avatar } from "../ui/Avatar";
import { FileSidebar } from "./FileSidebar";
import { isImageFile } from "./ImageDiff";
import {
  ReviewList,
  type FindCurrent,
  type MarkSpec,
  type ReviewListCallbacks,
  type ReviewListHandle,
} from "./ReviewList";
import { RightPanel } from "./RightPanel";
import { SubmitReviewModal } from "./SubmitReviewModal";
import { PrSearch } from "./PrSearch";
import { FindBar } from "./FindBar";
import { OverviewRuler } from "./OverviewRuler";

interface ReviewScreenProps {
  owner: string;
  repo: string;
  number: number;
}

/** An occurrence query plus the file section it lights up. */
type OccState = OccurrenceSpec & { fileIndex: number };

/** The keyboard/hover line cursor: one row, anywhere in the PR. */
interface CursorPos {
  fileIndex: number;
  anchor: string;
}

const EMPTY_PENDING: PendingComment[] = [];
const EMPTY_MATCHES: FindMatch[] = [];
const EMPTY_OCC: OccurrenceMatch[] = [];
const EMPTY_FRACTIONS: number[] = [];
const EMPTY_COLLAPSED: ReadonlyMap<number, ReadonlySet<number>> = new Map();

export function ReviewScreen({ owner, repo, number }: ReviewScreenProps) {
  const keyValue = prKey({ owner, name: repo, number });

  const { data, isError, error } = usePullRequestDetail(owner, repo, number);
  const { addReviewComment, reply, addIssueComment, submitReview } =
    useCommentMutations(owner, repo, number);

  const detail = data;
  const pr = detail?.pr;

  // Resume position for this PR (captured once per mount, before edits).
  const [initialMem] = useState(() => getReviewMemory(keyValue));

  // The "current" file: what the keyboard talks to and the sidebar highlights.
  // The CURSOR is the source of truth — it moves via j/k, hover, file
  // navigation, and search. Plain wheel-scrolling deliberately does NOT move
  // it: a scroll-derived highlight flaps at boundaries, and you haven't
  // committed to a file until you touch it (the sticky group header always
  // names what's on screen).
  const [activeIndex, setActiveIndex] = useState(initialMem?.fileIndex ?? 0);
  // The info drawer starts closed — the diff dominates until `i` opens it.
  const [rightOpen, setRightOpen] = useState(false);
  const rightOpenRef = useLatest(rightOpen);
  const [commentIndex, setCommentIndex] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [prSearch, setPrSearch] = useState<null | "files" | "text">(null);
  // Files whose content moved out from under a viewed mark. Feeds the quiet
  // per-file "updated" affordances (sidebar dot, header chip) instead of a
  // sticky banner — the signal lives ON the files it's about, and marking a
  // file viewed again acknowledges it away.
  const [changedSinceViewed, setChangedSinceViewed] = useState<Set<string>>(
    () => new Set(),
  );

  // ---- the flattened list's interaction state --------------------------------
  // Collapsed hunks and open composers feed the item model (collapsing removes
  // rows from the list; an open composer IS an item), so they live here, keyed
  // by file.
  const [collapsed, setCollapsed] = useState<
    ReadonlyMap<number, ReadonlySet<number>>
  >(EMPTY_COLLAPSED);
  const [openBoxes, setOpenBoxes] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // The line cursor (j/k, hover, jumps) — tracked by (file, anchor) so it
  // stays on the same logical line when hunks collapse or the list rebuilds.
  const [cursor, setCursor] = useState<CursorPos | null>(null);
  // Last input modality — drives which single "+" affordance shows (cursor
  // row vs hovered row) so there's never two.
  const [inputMode, setInputMode] = useState<"keyboard" | "mouse">("keyboard");
  // The row briefly lit after a search/find jump (fileAnchorKey).
  const [flashKey, setFlashKey] = useState<string | null>(null);
  // Group-header path copy confirmation (which file index, if any).
  const [copiedPathIndex, setCopiedPathIndex] = useState<number | null>(null);

  // Find-in-diff (mod+f): an editor-style bar over the diff, not a modal.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  // The concrete match position once the user has navigated (Enter/arrows);
  // null means "not navigated yet — derive the current match from the
  // viewport seed", which is what makes find start from what you're looking
  // at instead of the top of the PR (editor/browser convention).
  const [findIndex, setFindIndex] = useState<number | null>(null);
  // The first rendered item index when the query last changed — the seed the
  // current match derives from. Item indexes come straight from the
  // virtualizer, so no layout reads are involved.
  const [findSeed, setFindSeed] = useState<number | null>(null);
  // Bumped when mod+f fires while the bar is already open → refocus/select.
  const [findFocusSeq, setFindFocusSeq] = useState(0);
  // The first Enter lands on the match already counted as current (the
  // viewport-seeded one, say "9/17"); only subsequent presses advance.
  const findJumpedRef = useRef(false);
  const findOpenRef = useLatest(findOpen);

  // Selection-occurrence highlighting: click or select a token in the diff
  // and its other occurrences in THAT FILE light up (editor convention).
  const [occSpec, setOccSpec] = useState<OccState | null>(null);
  const occSpecRef = useLatest(occSpec);
  // Repainting rows with marks replaces their text nodes, which would kill
  // the very selection that triggered the marks. The selection's position is
  // captured before the spec applies and restored after the repaint.
  const occRestoreRef = useRef<CapturedSelection | null>(null);
  const occNavRef = useRef(-1);
  const occOriginRef = useRef<{ anchor: string; column: number } | null>(null);

  const listRef = useRef<ReviewListHandle>(null);
  const mountShaRef = useRef("");
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goInbox = useAppStore((s) => s.goInbox);
  const toggleViewed = useAppStore((s) => s.toggleViewed);
  const reconcileViewed = useAppStore((s) => s.reconcileViewed);
  // Subscribe to the viewed map so the sidebar and headers stay reactive.
  const viewed = useAppStore((s) => s.viewed);
  // Pending review comments live in the store, so leaving the screen (or the
  // app) never drops a draft.
  const pendingMap = useAppStore((s) => s.pendingComments);
  const pending = pendingMap[keyValue] ?? EMPTY_PENDING;
  const addPendingStore = useAppStore((s) => s.addPendingComment);
  const removePendingStore = useAppStore((s) => s.removePendingComment);
  const clearPendingComments = useAppStore((s) => s.clearPendingComments);
  const setFlash = useAppStore((s) => s.setFlash);
  const setToast = useAppStore((s) => s.setToast);
  const activeLogin = useAppStore(
    (s) => s.accounts.find((a) => a.id === s.activeAccountId)?.login,
  );
  const trackerBase = useAppStore((s) =>
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined,
  );
  const viewedFiles = viewed[keyValue];
  const viewedSet = useMemo(
    () => new Set(Object.keys(viewedFiles ?? {})),
    [viewedFiles],
  );

  const files = useMemo(() => detail?.files ?? [], [detail]);
  const fileCount = files.length;
  const clampedIndex = Math.min(activeIndex, Math.max(fileCount - 1, 0));
  const activeFile = files[clampedIndex];

  // Live refs so rAF-coalesced handlers and stable callbacks read fresh state.
  const activeIndexRef = useLatest(clampedIndex);
  const fileCountRef = useLatest(fileCount);
  const filesRef = useLatest(files);

  // Per-file comment buckets for the item model.
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

  // The whole PR as ONE flattened, virtualized list (see lib/reviewItems).
  // Plain computation — the React Compiler caches it on its inputs; the
  // blocking react-doctor gate flags any future compile bailout.
  const model: ReviewListModel = buildReviewItems({
    files,
    isImage: isImageFile,
    collapsed,
    openBoxes,
    commentsByFile,
    pendingByFile,
  });
  const modelRef = useLatest(model);

  // A cursor orphaned by a collapse simply stops APPLYING (derived, not
  // cleared in an effect) — it reappears from the viewport on the next j/k.
  const liveCursor =
    cursor && model.navIndexOf.has(fileAnchorKey(cursor.fileIndex, cursor.anchor))
      ? cursor
      : null;

  // Warm the per-line highlight cache in idle time: rows highlight as they
  // render into the viewport, and a warm cache keeps fast scrolling smooth.
  useEffect(() => {
    if (files.length === 0) return;
    return warmHighlightCache(files);
  }, [files]);

  // Seed the head sha on open (recording open latency), then only speak up if
  // the PR's head *moves while you're reviewing it*.
  useEffect(() => {
    if (!pr) return;
    const seen = mountShaRef.current;
    if (!seen) {
      usePerfStore.getState().completeOpen();
      mountShaRef.current = pr.headSha;
      updateReviewMemory(keyValue, { headSha: pr.headSha });
      return;
    }
    if (pr.headSha && pr.headSha !== seen) {
      mountShaRef.current = pr.headSha;
      updateReviewMemory(keyValue, { headSha: pr.headSha });
      // Transient by design: "new code arrived" is an event, not a state —
      // the durable signal is the per-file "updated" marks.
      setToast({
        title: "Pull request updated",
        message: "Showing the latest changes.",
      });
    }
  }, [pr, keyValue, setToast]);

  // When the inbox heartbeat (60s poll / window focus) sees this PR move past
  // what the detail payload knows, refetch the detail right away. The ref
  // gates one nudge per observed updatedAt.
  const { data: inboxHeartbeat } = useInbox();
  const nudgedForRef = useRef("");
  useEffect(() => {
    if (!pr) return;
    const buckets = inboxHeartbeat
      ? [
          inboxHeartbeat.reviewRequested,
          inboxHeartbeat.assigned,
          inboxHeartbeat.created,
          inboxHeartbeat.involved,
        ]
      : [];
    const subscribed = queryClient.getQueryData<InboxBucket>(
      queryKeys.subscribed,
    );
    if (subscribed) buckets.push(subscribed);
    const hit = buckets
      .flatMap((b) => b.prs)
      .find(
        (p) => p.owner === owner && p.name === repo && p.number === number,
      );
    if (
      hit &&
      hit.updatedAt > pr.updatedAt &&
      nudgedForRef.current !== hit.updatedAt
    ) {
      nudgedForRef.current = hit.updatedAt;
      void queryClient.invalidateQueries({
        queryKey: queryKeys.prDetail(owner, repo, number),
      });
    }
  }, [inboxHeartbeat, pr, owner, repo, number]);

  // Auto-unview: a viewed mark vouches for the content you saw — whenever
  // detail data lands, each mark's stored fingerprint is checked against the
  // current diff; mismatches are unviewed and announced. Idempotent, so the
  // re-run its own write triggers settles immediately.
  useEffect(() => {
    if (!pr || files.length === 0) return;
    const unviewed = reconcileViewed(keyValue, files, pr.headSha);
    if (unviewed.length > 0) {
      setChangedSinceViewed((prev) => {
        const next = new Set(prev);
        for (const f of unviewed) next.add(f);
        return next;
      });
      setToast({
        title: "Pull request updated",
        message:
          unviewed.length === 1
            ? `${unviewed[0]} changed since you viewed it — marked unviewed.`
            : `${unviewed.length} files changed since you viewed them — marked unviewed.`,
      });
    }
  }, [pr, files, viewedFiles, keyValue, reconcileViewed, setToast]);

  // Persist the current file for resume — but only once the real file list is
  // known, so the placeholder index 0 (while detail loads) can't clobber a
  // saved position if the user quits mid-load.
  useEffect(() => {
    if (!detail || fileCount === 0) return;
    updateReviewMemory(keyValue, { fileIndex: clampedIndex });
  }, [detail, fileCount, clampedIndex, keyValue]);

  // Record file-switch latency after the paint that follows the switch.
  useEffect(() => {
    requestAnimationFrame(() => usePerfStore.getState().completeFile());
  }, [clampedIndex]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current);
      if (fileRafRef.current != null) cancelAnimationFrame(fileRafRef.current);
      if (cursorRafRef.current != null)
        cancelAnimationFrame(cursorRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll → debounce → snapshot the virtualizer state into review memory.
  // The snapshot IS the resume position (restoreStateFrom on next mount).
  function handleListScroll() {
    if (saveStateTimerRef.current) clearTimeout(saveStateTimerRef.current);
    saveStateTimerRef.current = setTimeout(() => {
      listRef.current?.getState((state) => {
        updateReviewMemory(keyValue, { listState: state });
      });
    }, 300);
  }

  function pageScroll(dir: number) {
    const el = listRef.current?.scroller();
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.85 });
  }

  // ---- the line cursor (j/k, hover) ------------------------------------------
  // One cursor for the whole PR: the flattened nav list makes cross-file
  // movement ordinary stepping (the seed/exit handoff the per-file viewers
  // needed is gone).

  const cursorRef = useLatest(liveCursor);
  // Only auto-scroll the cursor into view for explicit user moves — never for
  // hover sync or auto-correction, so the mouse never fights the view.
  const userMovedCursorRef = useRef(false);

  // Pointer-intent gate. Scrolling under a stationary pointer fires hover
  // events with unchanged coordinates, which would steal the cursor right
  // back after every j/k or jump. While a keyboard action "holds" the cursor,
  // hover only wins once the pointer has genuinely moved (> 6px).
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

  // Cursor movement is coalesced per animation frame: rapid key-repeats (and
  // direction changes) accumulate a net delta applied once. Holding j/k
  // accelerates: ~¼s of key-repeat moves 3 lines per repeat, ~¾s six.
  const pendingDeltaRef = useRef(0);
  const cursorRafRef = useRef<number | null>(null);
  const heldRepeatsRef = useRef(0);

  // buildCursorMover is stateless over refs (like buildOccNav): instances
  // are interchangeable and built at event time in the hotkey handlers, so
  // nothing render-scoped is captured by the rAF-coalesced flush.
  const cursorMoverRefs = {
    modelRef,
    cursorRef,
    activeIndexRef,
    pendingDeltaRef,
    cursorRafRef,
    heldRepeatsRef,
    keyboardHoldRef,
    userMovedCursorRef,
    listRef,
    setCursor,
    setActiveIndex,
    setInputMode,
  };

  // Hovering a row moves the cursor (without scrolling) and claims the file.
  const cbRef = useLatest({
    onRowEnter(fileIndex: number, anchor: string, x: number, y: number) {
      if (!isRealPointer(x, y)) return;
      setInputMode((mo) => (mo === "mouse" ? mo : "mouse"));
      setCursor((cur) =>
        cur && cur.fileIndex === fileIndex && cur.anchor === anchor
          ? cur
          : { fileIndex, anchor },
      );
      setActiveIndex((cur) => (cur === fileIndex ? cur : fileIndex));
    },
    onOpenBox(fileIndex: number, anchor: string) {
      setOpenBoxes((prev) =>
        new Set(prev).add(fileAnchorKey(fileIndex, anchor)),
      );
    },
    onCloseBox(fileIndex: number, anchor: string) {
      setOpenBoxes((prev) => {
        const next = new Set(prev);
        next.delete(fileAnchorKey(fileIndex, anchor));
        return next;
      });
    },
    onToggleHunk(fileIndex: number, hunkIndex: number) {
      setCollapsed((prev) => {
        const next = new Map(prev);
        const set = new Set(next.get(fileIndex) ?? []);
        if (set.has(hunkIndex)) set.delete(hunkIndex);
        else set.add(hunkIndex);
        next.set(fileIndex, set);
        return next;
      });
    },
    onToggleViewed(fileIndex: number) {
      const f = filesRef.current[fileIndex];
      if (f) toggleViewedWithFp(f);
    },
    onCopyPath(fileIndex: number) {
      const f = filesRef.current[fileIndex];
      if (!f) return;
      void navigator.clipboard?.writeText(f.filename).catch(() => {});
      setCopiedPathIndex(fileIndex);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedPathIndex(null), 1200);
    },
    onAddPending(c: { path: string; line: number; side: string; body: string }) {
      addPendingStore(keyValue, c);
    },
    async onAddComment(a: {
      path: string;
      line: number;
      side: string;
      body: string;
    }) {
      await addReviewComment.mutateAsync({
        body: a.body,
        commitId: headShaRef.current,
        path: a.path,
        line: a.line,
        side: a.side,
      });
    },
    async onReply(a: { inReplyTo: number; body: string }) {
      await reply.mutateAsync(a);
    },
    onRemovePending(id: string) {
      removePendingStore(keyValue, id);
    },
    onScroll() {
      handleListScroll();
    },
    onMouseMove(x: number, y: number) {
      if (!isRealPointer(x, y)) return;
      setInputMode((mo) => (mo === "mouse" ? mo : "mouse"));
    },
  });
  // Stable callback identities (built once, dispatching to the latest
  // implementations) so the memoized rows never repaint over handler churn.
  const [listCallbacks] = useState<ReviewListCallbacks>(() => {
    const r = cbRef;
    return {
      onRowEnter: (...a) => r.current.onRowEnter(...a),
      onOpenBox: (...a) => r.current.onOpenBox(...a),
      onCloseBox: (...a) => r.current.onCloseBox(...a),
      onToggleHunk: (...a) => r.current.onToggleHunk(...a),
      onToggleViewed: (...a) => r.current.onToggleViewed(...a),
      onCopyPath: (...a) => r.current.onCopyPath(...a),
      onAddPending: (...a) => r.current.onAddPending(...a),
      onAddComment: (...a) => r.current.onAddComment(...a),
      onReply: (...a) => r.current.onReply(...a),
      onRemovePending: (...a) => r.current.onRemovePending(...a),
      onScroll: () => r.current.onScroll(),
      onMouseMove: (...a) => r.current.onMouseMove(...a),
    };
  });

  function commentAtCursor() {
    const m = modelRef.current;
    const cur = cursorRef.current;
    const entry = cur ?? m.nav[0];
    if (!entry) return;
    if (!cur) {
      setCursor({ fileIndex: entry.fileIndex, anchor: entry.anchor });
      setActiveIndex(entry.fileIndex);
      activeIndexRef.current = entry.fileIndex;
    }
    cbRef.current.onOpenBox(entry.fileIndex, entry.anchor);
  }

  // ---- file navigation --------------------------------------------------------

  function scrollToFile(i: number) {
    if (fileCountRef.current === 0) return;
    const target = Math.min(Math.max(i, 0), fileCountRef.current - 1);
    usePerfStore.getState().markFileStart();
    setActiveIndex(target);
    // Eager ref sync: the useLatest write lands after React commits, but the
    // next rAF-coalesced file move can flush BEFORE that — rapid r/t presses
    // were reading the stale index and losing steps.
    activeIndexRef.current = target;
    setCommentIndex(0);
    // Navigating away is moving on — stale occurrence marks would just be
    // mystery highlights with their selection off-screen.
    setOccSpec(null);
    listRef.current?.scrollToFileStart(target);
  }

  // r/t/Tab are coalesced per animation frame, mirroring the line cursor:
  // holding the key accumulates a net delta applied once per frame.
  const fileDeltaRef = useRef(0);
  const fileRafRef = useRef<number | null>(null);
  function flushFileMove() {
    fileRafRef.current = null;
    const delta = fileDeltaRef.current;
    fileDeltaRef.current = 0;
    if (delta === 0) return;
    scrollToFile(activeIndexRef.current + delta);
  }
  function moveFile(delta: number) {
    if (fileCountRef.current === 0) return;
    fileDeltaRef.current += delta;
    if (fileRafRef.current == null) {
      fileRafRef.current = requestAnimationFrame(flushFileMove);
    }
  }
  const nextFile = () => moveFile(1);
  const prevFile = () => moveFile(-1);

  // Tab cycles with wrap-around: past the last file it returns to the first.
  function cycleFile(dir: number) {
    const n = fileCountRef.current;
    if (n === 0) return;
    scrollToFile((activeIndexRef.current + dir + n) % n);
  }

  // From file search: open the file and seat the cursor on its first line,
  // so `c` (and j/k) work immediately without a hover.
  function selectFileFromSearch(fileIndex: number) {
    scrollToFile(fileIndex);
    const entry = modelRef.current.nav.find((n) => n.fileIndex === fileIndex);
    if (entry) {
      keyboardHoldRef.current = true;
      setInputMode("keyboard");
      setCursor({ fileIndex: entry.fileIndex, anchor: entry.anchor });
    }
  }

  // From text search / find / occurrence jumps: land on the matched line.
  function selectLine(
    fileIndex: number,
    anchor: string,
    opts: { keepOccurrences?: boolean } = {},
  ) {
    const m = modelRef.current;
    const key = fileAnchorKey(fileIndex, anchor);
    usePerfStore.getState().markFileStart();
    setActiveIndex(fileIndex);
    activeIndexRef.current = fileIndex; // eager — see scrollToFile
    setCommentIndex(0);
    // A search jump is navigation too — drop stale occurrence marks. Two
    // exceptions: with the find bar open the occurrence state is frozen (and
    // suppressed), and occurrence NAVIGATION rides selectLine to move BETWEEN
    // the marks — clearing would tear them down mid-walk.
    if (!findOpenRef.current && !opts.keepOccurrences) setOccSpec(null);
    keyboardHoldRef.current = true;
    setInputMode("keyboard");
    setCursor({ fileIndex, anchor });
    setFlashKey(key);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlashKey(null), 1600);
    const itemIndex = m.anchorItem.get(key);
    if (itemIndex != null) listRef.current?.centerItem(itemIndex);
  }
  // Ref'd so the mount-once click handler (occurrence-mark jumps) never calls
  // a stale closure.
  const selectLineRef = useLatest(selectLine);

  // ---- find in diff (mod+f) ---------------------------------------------------

  // Matches come from the PATCH TEXT (lib/findInDiff), so rows far outside
  // the rendered window count too; only rendered rows pay for highlighting.
  const findMatches =
    findOpen && findQuery
      ? findInDiff(files, findQuery, { caseSensitive: findCase })
      : EMPTY_MATCHES;

  /** Re-anchor find to the viewport: the first row visible below the sticky
   *  header (read from the rendered DOM — exact, and only ~40 rows exist). */
  function captureFindSeed() {
    setFindSeed(listRef.current?.firstVisibleRowItem() ?? null);
  }

  // The first match at/after the captured viewport position, wrapping to the
  // top when everything is behind you (editors anchor find to the caret; ours
  // is the viewport). Matches inside collapsed hunks have no item index and
  // are skipped for seeding purposes.
  const findSeededIndex = seededMatchIndex(findMatches, model, findSeed);

  // The file list can change under an open bar (PR head moved) — stay valid.
  const findSafeIndex =
    findMatches.length > 0
      ? Math.min(findIndex ?? findSeededIndex, findMatches.length - 1)
      : 0;

  // The current match as (row anchor, occurrence ordinal). Matches on one
  // line are adjacent in the list, so the ordinal is the run-length behind.
  const findCurrent = currentMatchAt(findMatches, findSafeIndex);

  // Every query edit re-anchors to the viewport: after a jump the viewport IS
  // the last match, so typing more keeps searching from where you are.
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
      // Reopening with a kept query still re-seeds from wherever you are now.
      captureFindSeed();
      setFindIndex(null);
      findJumpedRef.current = false;
      setFindOpen(true);
      // Browser convention: selected diff text seeds the query on open.
      const selected =
        window.getSelection()?.toString().split("\n")[0].trim() ?? "";
      if (selected) changeFindQuery(selected);
    }
    // Already open: just refocus and select the input (FindBar effect).
    setFindFocusSeq((s) => s + 1);
  }
  // Closing clears the find highlights (marks fall back to the selection's
  // occurrences, if any); focus falls back to the document — j/k works.
  function closeFind() {
    setFindOpen(false);
  }
  // Enter/next/prev: the first press jumps to the CURRENT match, later ones
  // step (with wrap-around).
  function findStep(dir: 1 | -1) {
    const n = findMatches.length;
    if (n === 0) return;
    const next = findJumpedRef.current
      ? (findSafeIndex + dir + n) % n
      : findSafeIndex;
    findJumpedRef.current = true;
    setFindIndex(next);
    const m = findMatches[next];
    selectLine(m.fileIndex, m.anchor);
  }

  // The occurrence spec's matches across its WHOLE file, from the patch text.
  const occMatchList = occSpec
    ? occurrenceMatches(files[occSpec.fileIndex] ?? {}, occSpec)
    : EMPTY_OCC;
  const occMatchListRef = useLatest(occMatchList);

  // Occurrence navigation: buildOccNav is stateless over refs, so instances
  // are interchangeable and built where they're used.
  const occNavRefs = {
    occMatchListRef,
    occSpecRef,
    occNavRef,
    occOriginRef,
    selectLineRef,
  };

  // ---- selection → occurrence highlights --------------------------------------

  // Two ways in, VS Code-style: a single CLICK on a token marks its other
  // occurrences, and a drag/double-click SELECTION marks arbitrary selected
  // text. The selectionchange listener is debounced and only ever SETS marks —
  // clearing belongs to clicks on non-word code, Esc, and file navigation.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const occNav = buildOccNav({
      occMatchListRef,
      occSpecRef,
      occNavRef,
      occOriginRef,
      selectLineRef,
    });

    // Skip identity-preserving updates entirely: no repaint on selection
    // noise, and no pointless selection restore.
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
      if (prev === next) return;
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
      const v = el.closest("[data-file-index]")?.getAttribute("data-file-index");
      const n = v == null ? NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function specFromDomSelection(): OccState | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const container = sel.getRangeAt(0).commonAncestorContainer;
      const el =
        container instanceof Element ? container : container.parentElement;
      // Only selections inside ONE diff code line qualify.
      const code = codeAround(el);
      if (!code) return null;
      const fileIndex = fileIndexOf(code);
      if (fileIndex == null) return null;
      const spec = occurrenceSpecFromSelection(sel.toString());
      return spec && { ...spec, fileIndex };
    }

    /** The \w+ word around the caret position at (x, y). */
    function wordAtPoint(x: number, y: number): OccState | null {
      const doc = document as Document & {
        caretPositionFromPoint?: (
          x: number,
          y: number,
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
      if (!node || node.nodeType !== Node.TEXT_NODE) return null;
      const parent = node.parentElement;
      if (!parent) return null;
      const code = codeAround(parent);
      if (!code) return null;
      const fileIndex = fileIndexOf(code);
      if (fileIndex == null) return null;
      // Expand over the WHOLE LINE's text, not the caret's text node: marks
      // fragment a line into many text nodes.
      const text = code.textContent ?? "";
      const nodeStart = codeColumnOf(code, node);
      if (nodeStart == null) return null;
      const col = nodeStart + offset;
      let s = col;
      let e = col;
      while (s > 0 && /\w/.test(text[s - 1])) s -= 1;
      while (e < text.length && /\w/.test(text[e])) e += 1;
      if (s === e) return null;
      // The word's glyph box must actually contain the click point:
      // caret-from-point snaps to the NEAREST text position.
      const start = codePositionAt(code, s);
      const end = codePositionAt(code, e);
      if (!start || !end) return null;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      const hit = Array.from(range.getClientRects()).some(
        (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom,
      );
      if (!hit) return null;
      const spec = occurrenceSpecFromSelection(text.slice(s, e));
      return spec && { ...spec, fileIndex };
    }

    function apply() {
      timer = null;
      // While the find bar is open its marks own the diff — freeze occurrence
      // state instead of updating it.
      if (findOpenRef.current) return;
      const sel = window.getSelection();
      // A collapsed selection is silence, not a clear: the click that
      // collapsed it decides what happens.
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      commit(specFromDomSelection());
    }

    function onSelectionChange() {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(apply, 150);
    }

    function onClick(e: MouseEvent) {
      if (findOpenRef.current) return;
      // The later clicks of a double-click ride the selection path instead.
      if (e.detail > 1) return;
      const target = e.target instanceof Element ? e.target : null;
      // Clicks outside code lines (gutters, sidebar, buttons) leave the marks
      // alone — Esc and navigation are their exits.
      if (!codeAround(target)) return;
      // A click that ends a drag-select carries the selection — that path
      // owns it.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      // Clicking an EXISTING occurrence mark navigates instead of
      // re-committing the same spec.
      const mark = target?.closest("mark.qf-occ-mark");
      if (mark && occSpecRef.current) {
        const code = codeAround(mark);
        const anchor = mark.closest("[data-anchor]")?.getAttribute("data-anchor");
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
      if (timer != null) clearTimeout(timer);
    };
    // All deps are refs (compiler-stable): attaches once in practice.
  }, [findOpenRef, occSpecRef, occMatchListRef, occNavRef, occOriginRef, selectLineRef]);

  // Re-select what the user had selected, over the row's freshly-painted text
  // nodes, before the browser paints — so the selection appears to simply
  // survive the marks appearing under it.
  useLayoutEffect(() => {
    const captured = occRestoreRef.current;
    occRestoreRef.current = null;
    if (captured) restoreCodeSelection(captured);
  }, [occSpec]);

  // One marks identity, changing only with the query. Find wins while its bar
  // is open (even with an empty query): two mark systems at once is noise.
  // With the list virtualized, marks flow to every RENDERED row — a viewport-
  // sized set — so the per-section gating the windowed implementation needed
  // no longer exists.
  const marks: MarkSpec | null = findOpen
    ? findQuery
      ? { kind: "find", query: findQuery, caseSensitive: findCase }
      : null
    : occSpec
      ? {
          kind: "occurrence",
          query: occSpec.query,
          wholeWord: occSpec.wholeWord,
          fileIndex: occSpec.fileIndex,
        }
      : null;

  // Overview ruler ticks: item-index fractions of the whole list. Matches
  // inside collapsed hunks have no item and simply don't tick.
  const rulerFractions: number[] =
    model.items.length === 0
      ? EMPTY_FRACTIONS
      : findOpen && findQuery
        ? findMatches.map((m) => {
            const idx = model.anchorItem.get(
              fileAnchorKey(m.fileIndex, m.anchor),
            );
            return idx == null ? -1 : idx / model.items.length;
          })
        : occSpec
          ? occMatchList.map((m) => {
              const idx = model.anchorItem.get(
                fileAnchorKey(occSpec.fileIndex, m.anchor),
              );
              return idx == null ? -1 : idx / model.items.length;
            })
          : EMPTY_FRACTIONS;

  // Declared above the closures that read it: the PR head sha, ref'd so
  // stable callbacks stamp the CURRENT head.
  const headShaRef = useLatest(pr?.headSha ?? "");

  // Marks are stamped with the file's current content fingerprint, so a later
  // push that touches the file can drop the mark (see the reconcile effect).
  const toggleViewedWithFp = (f: ChangedFile) => {
    toggleViewed(keyValue, f.filename, fingerprintFile(f, headShaRef.current));
    setChangedSinceViewed((prev) => {
      if (!prev.has(f.filename)) return prev;
      const next = new Set(prev);
      next.delete(f.filename);
      return next;
    });
  };

  function toggleViewedFile() {
    if (activeFile) toggleViewedWithFp(activeFile);
  }
  // `e`: toggle the current file's viewed state. Marking advances to the next
  // file; UNmarking stays put (you're revisiting, not moving on).
  function markViewedAndNext() {
    if (!activeFile) return;
    const wasViewed = viewedSet.has(activeFile.filename);
    toggleViewedWithFp(activeFile);
    if (!wasViewed) scrollToFile(activeIndexRef.current + 1);
  }
  // Both copies confirm through the shared toast host.
  function copyLink() {
    if (!pr?.url) return;
    void navigator.clipboard?.writeText(pr.url).catch(() => {});
    setToast({ title: "Copied PR link", message: pr.url });
  }
  function copyFilePath() {
    if (!activeFile) return;
    void navigator.clipboard?.writeText(activeFile.filename).catch(() => {});
    setToast({ title: "Copied file path", message: activeFile.filename });
  }

  // After submitting, jump to the next review-requested PR (or back to inbox).
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
        prKey({ owner: next.owner, name: next.name, number: next.number }),
        next.updatedAt,
      );
    } else {
      goInbox();
    }
  }

  // ]c/[c walk the comment blocks by ITEM index — virtualization means
  // off-screen comments have no DOM to query, but the model knows them all.
  function goToComment(delta: number) {
    const list = modelRef.current.commentItems;
    if (list.length === 0) return;
    const next = (commentIndex + delta + list.length) % list.length;
    setCommentIndex(next);
    listRef.current?.centerItem(list[next]);
  }

  function openSubmit() {
    submitReview.reset();
    setSubmitOpen(true);
  }

  // Optimistic: close + advance immediately; the network settles behind you.
  function handleSubmitReview(event: ReviewEvent, body: string) {
    const payload = {
      event,
      body,
      commitId: pr?.headSha ?? "",
      comments: pending.map((p) => ({
        path: p.path,
        line: p.line,
        side: p.side,
        body: p.body,
      })),
    };
    setSubmitOpen(false);
    advanceAfterSubmit();
    submitReview
      .mutateAsync(payload)
      .then(() => clearPendingComments(keyValue))
      .catch((e) => {
        setFlash(
          `Review for ${owner}/${repo}#${number} didn't submit — your comments are still pending. ${String(e)}`,
        );
      });
  }

  useHotkeys("review", [
    {
      keys: ["j", "down"],
      description: "Next line",
      group: "Navigation",
      icon: ArrowDown,
      run: (e) => buildCursorMover(cursorMoverRefs).move(1, e.repeat),
    },
    {
      keys: ["k", "up"],
      description: "Previous line",
      group: "Navigation",
      icon: ArrowUp,
      run: (e) => buildCursorMover(cursorMoverRefs).move(-1, e.repeat),
    },
    {
      keys: "c",
      description: "Comment on line",
      group: "Comments",
      icon: MessageSquarePlus,
      run: commentAtCursor,
    },
    {
      keys: ["r"],
      description: "Next file",
      group: "Files",
      icon: ChevronRight,
      run: nextFile,
    },
    {
      keys: ["t"],
      description: "Previous file",
      group: "Files",
      icon: ChevronLeft,
      run: prevFile,
    },
    {
      // Tab is repurposed Superhuman-style: instead of wandering focus, it
      // cycles files with wrap-around (Shift+Tab goes back).
      keys: "tab",
      description: "Cycle files",
      group: "Files",
      icon: ArrowLeftRight,
      run: (e) => cycleFile(e.shiftKey ? -1 : 1),
    },
    {
      keys: ["space", "pagedown"],
      description: "Page down",
      group: "Navigation",
      icon: ChevronsDown,
      run: () => pageScroll(1),
    },
    {
      keys: ["pageup"],
      description: "Page up",
      group: "Navigation",
      icon: ChevronsUp,
      run: () => pageScroll(-1),
    },
    {
      keys: "]c",
      description: "Next comment",
      group: "Comments",
      icon: MessageSquare,
      run: () => goToComment(1),
    },
    {
      keys: "[c",
      description: "Previous comment",
      group: "Comments",
      icon: MessageSquare,
      run: () => goToComment(-1),
    },
    {
      keys: "e",
      description: "Mark viewed & next",
      group: "Files",
      icon: CheckCheck,
      run: markViewedAndNext,
    },
    {
      keys: "v",
      description: "Toggle file viewed",
      group: "Files",
      icon: Check,
      run: toggleViewedFile,
    },
    {
      keys: "s",
      description: "Submit review",
      group: "Review",
      icon: Send,
      run: openSubmit,
    },
    {
      keys: "o",
      description: "Open files in the browser",
      group: "General",
      icon: ExternalLink,
      run: () => {
        if (!pr) return;
        // GitHub's files tab is /files; GitLab's is /diffs.
        const files = pr.url.includes("/-/merge_requests/") ? "/diffs" : "/files";
        void openUrl(pr.url + files);
      },
    },
    {
      keys: "y",
      description: "Copy PR link",
      group: "General",
      icon: Link,
      run: copyLink,
    },
    {
      // The editor convention (VS Code's "copy path" chord family).
      keys: "mod+shift+c",
      description: "Copy file path",
      group: "Files",
      icon: Copy,
      run: copyFilePath,
    },
    {
      keys: "i",
      description: "Toggle info panel",
      group: "General",
      icon: Info,
      run: () => setRightOpen((o) => !o),
    },
    {
      keys: "mod+t",
      description: "Find a file",
      group: "Navigation",
      icon: FileSearch,
      run: () => setPrSearch("files"),
    },
    {
      keys: "mod+r",
      description: "Search code",
      group: "Navigation",
      icon: Search,
      run: () => setPrSearch("text"),
    },
    {
      keys: "mod+f",
      description: "Find in diff",
      group: "Navigation",
      icon: TextSearch,
      run: openFind,
    },
    // While the find bar is open, Enter / F3 / mod+g step through matches even
    // after focus has returned to the diff.
    ...(findOpen
      ? ([
          {
            keys: ["enter", "f3"],
            description: "Next find match",
            hidden: true,
            run: (e) => findStep(e.shiftKey ? -1 : 1),
          },
          {
            keys: "mod+g",
            description: "Next find match",
            hidden: true,
            run: (e) => findStep(e.shiftKey ? -1 : 1),
          },
        ] satisfies Binding[])
      : []),
    // While a token's occurrences are marked, n/p walk between them.
    ...(occSpec
      ? ([
          {
            keys: "n",
            description: "Next occurrence",
            hidden: true,
            run: () => buildOccNav(occNavRefs).step(1),
          },
          {
            keys: "p",
            description: "Previous occurrence",
            hidden: true,
            run: () => buildOccNav(occNavRefs).step(-1),
          },
        ] satisfies Binding[])
      : []),
    {
      // Esc walks out one layer at a time: find bar, then the info drawer,
      // then the inbox.
      keys: "esc",
      description: "Close panel / back to inbox",
      group: "Navigation",
      icon: Inbox,
      run: () => {
        if (findOpenRef.current) closeFind();
        else if (rightOpenRef.current) setRightOpen(false);
        else goInbox();
      },
    },
  ]);

  // No detail yet: either still loading, or the fetch failed with nothing
  // cached — show an escape hatch instead of a forever spinner.
  if (!detail || !pr) {
    if (isError) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm font-medium text-danger">
            Couldn't load this pull request
          </p>
          <p className="max-w-md break-words text-xs text-muted">
            {String(error)}
          </p>
          <button
            type="button"
            onClick={goInbox}
            className="rounded-card border border-line px-3 py-1.5 text-sm text-fg hover:bg-elevated"
          >
            Back to inbox
          </button>
          <p className="text-xs text-faint">Press Esc to go back</p>
        </div>
      );
    }
    // Cold cache: no full-screen loader — paint the review shell with what the
    // inbox already knows and skeleton the rest.
    const cached = findCachedInboxPr(owner, repo, number);
    return (
      <div className="dir-quiet relative flex h-full min-h-0 overflow-hidden">
        <aside className="w-[300px] shrink-0 border-r border-line">
          <div className="qf-sidebar flex h-full flex-col">
            <div className="qf-side-head flex items-center justify-between px-4 py-3">
              <span className="qf-side-title">Files</span>
            </div>
            <div className="px-3 py-1">
              {Array.from({ length: 9 }).map((_, i) => (
                <div
                  key={i}
                  className="qf-skel"
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
                    url={cached.authorAvatarUrl}
                    name={cached.author}
                    size={15}
                  />
                  <span className="qf-muted">{cached.author}</span>
                </div>
              </>
            ) : (
              <>
                <div className="qf-skel" style={{ height: 16, width: 340 }} />
                <div
                  className="qf-skel"
                  style={{ height: 11, width: 190, marginTop: 9 }}
                />
              </>
            )}
          </header>
          <div className="min-w-0 flex-1 overflow-hidden px-6 py-5">
            {Array.from({ length: 16 }).map((_, i) => (
              <div
                key={i}
                className="qf-skel"
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
  // Design principle: no loading states — mutations are optimistic, so the
  // composers never enter a busy mode.

  return (
    <div className="dir-quiet relative flex h-full min-h-0 overflow-hidden">
      <aside className="w-[300px] shrink-0 border-r border-line">
        <FileSidebar
          files={files}
          selectedIndex={clampedIndex}
          onSelect={scrollToFile}
          prKeyValue={keyValue}
          comments={detail.comments}
          pending={pending}
          changed={changedSinceViewed}
        />
      </aside>

      <main className="qf-main flex min-w-0 flex-1 flex-col">
        <header className="qf-header flex shrink-0 items-center gap-4 px-6 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={"qf-state " + stateClass}>
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
              <Avatar url={pr.authorAvatarUrl} name={pr.author} size={15} />
              <span className="qf-muted">{pr.author}</span>
              {pr.baseRef && pr.headRef && (
                <>
                  <span className="qf-dot">·</span>
                  <span className="qf-branch">
                    <BranchChip
                      name={pr.baseRef}
                      label="Target branch — click to copy"
                    />
                    <span className="qf-arrow">←</span>
                    <BranchChip
                      name={pr.headRef}
                      label="PR branch — click to copy"
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
              type="button"
              onClick={() => void openUrl(pr.url)}
              className="qf-back qf-focusable"
              title="Open on GitHub (o)"
            >
              Open ↗
            </button>
            <button
              type="button"
              className="qf-info-btn qf-focusable"
              onClick={() => setRightOpen((o) => !o)}
              aria-pressed={rightOpen}
              title="PR description & comment (i)"
            >
              i
            </button>
            <button
              type="button"
              onClick={openSubmit}
              className="qf-submit qf-focusable"
            >
              {pending.length > 0 ? "Submit review" : "Review"}
              {pending.length > 0 && (
                <span className="qf-submit-badge">{pending.length}</span>
              )}
              <Kbd combo="s" />
            </button>
          </div>
        </header>

        {/* The find bar floats over the diff's top-right corner — anchored to
            this wrapper (not the scroller) so it never scrolls away. */}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <FindBar
            open={findOpen}
            query={findQuery}
            caseSensitive={findCase}
            current={findMatches.length > 0 ? findSafeIndex + 1 : 0}
            total={findMatches.length}
            focusSeq={findFocusSeq}
            onQueryChange={changeFindQuery}
            onToggleCase={toggleFindCase}
            onNext={() => findStep(1)}
            onPrev={() => findStep(-1)}
            onClose={closeFind}
          />
          {fileCount === 0 ? (
            <div className="qf-empty">No files changed.</div>
          ) : (
            <ReviewList
              ref={listRef}
              model={model}
              files={files}
              cursorKey={
                liveCursor
                  ? fileAnchorKey(liveCursor.fileIndex, liveCursor.anchor)
                  : null
              }
              flashKey={flashKey}
              inputMode={inputMode}
              marks={marks}
              findCurrent={findCurrent}
              activeIndex={clampedIndex}
              viewedSet={viewedSet}
              changedSinceViewed={changedSinceViewed}
              copiedPathIndex={copiedPathIndex}
              owner={owner}
              repo={repo}
              baseSha={pr.baseSha}
              headSha={pr.headSha}
              addPending={false}
              restoreState={initialMem?.listState}
              initialFileIndex={initialMem?.fileIndex ?? 0}
              callbacks={listCallbacks}
            />
          )}
          {/* Overview ruler: match ticks along the whole list's range. */}
          <OverviewRuler
            kind={findOpen ? "find" : "occurrence"}
            fractions={rulerFractions}
            currentIndex={
              findOpen && findMatches.length > 0 ? findSafeIndex : null
            }
          />
        </div>
      </main>

      <RightPanel
        pr={pr}
        fileCount={fileCount}
        conversation={detail.issueComments ?? []}
        open={rightOpen}
        onClose={() => setRightOpen(false)}
        onAddIssueComment={async (body) => {
          await addIssueComment.mutateAsync({ body });
        }}
      />

      <SubmitReviewModal
        open={submitOpen}
        ownPr={isOwnPr}
        pendingCount={pending.length}
        busy={false}
        error={null}
        onClose={() => setSubmitOpen(false)}
        onSubmit={handleSubmitReview}
      />

      <PrSearch
        open={prSearch !== null}
        mode={prSearch ?? "files"}
        onClose={() => setPrSearch(null)}
        files={files}
        onSelectFile={selectFileFromSearch}
        onSelectLine={selectLine}
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
    refs.setCursor({ fileIndex: entry.fileIndex, anchor: entry.anchor });
    refs.setActiveIndex(entry.fileIndex);
    refs.activeIndexRef.current = entry.fileIndex; // eager — see scrollToFile
  };
  const flush = () => {
    refs.cursorRafRef.current = null;
    const m = refs.modelRef.current;
    const delta = refs.pendingDeltaRef.current;
    refs.pendingDeltaRef.current = 0;
    if (delta === 0 || m.nav.length === 0) return;
    const cur = refs.cursorRef.current;
    refs.userMovedCursorRef.current = true;
    const curIdx = cur
      ? m.navIndexOf.get(fileAnchorKey(cur.fileIndex, cur.anchor))
      : undefined;
    // First move (or a cursor orphaned by a collapse) just reveals the
    // cursor — on the first row still visible in the viewport, so a mid-file
    // reader isn't yanked anywhere.
    if (curIdx === undefined) {
      const start = refs.listRef.current?.firstVisibleRowItem() ?? 0;
      const entry = m.nav.find((n) => n.itemIndex >= start) ?? m.nav[0];
      place(entry);
      return;
    }
    const nextIdx = Math.min(Math.max(curIdx + delta, 0), m.nav.length - 1);
    if (nextIdx === curIdx) return;
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
    (fileIndex: number, anchor: string, opts?: { keepOccurrences?: boolean }) => void
  >;
}): OccNav {
  const { occMatchListRef, occSpecRef, occNavRef, occOriginRef, selectLineRef } =
    refs;
  const indexAt = (anchor: string, column: number): number =>
    occMatchListRef.current.findIndex(
      (m) => m.anchor === anchor && m.start <= column && column <= m.end,
    );
  const jumpTo = (index: number): void => {
    const spec = occSpecRef.current;
    const n = occMatchListRef.current.length;
    if (!spec || n === 0) return;
    const next = ((index % n) + n) % n;
    occNavRef.current = next;
    selectLineRef.current(spec.fileIndex, occMatchListRef.current[next].anchor, {
      keepOccurrences: true,
    });
  };
  const step = (dir: 1 | -1): void => {
    if (occMatchListRef.current.length === 0) return;
    let at = occNavRef.current;
    if (at < 0) {
      const origin = occOriginRef.current;
      const found = origin ? indexAt(origin.anchor, origin.column) : -1;
      // No resolvable origin: n starts at the first match, p at the last.
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
  seedItemIndex: number | null,
): number {
  if (seedItemIndex == null || matches.length === 0) return 0;
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const idx = model.anchorItem.get(fileAnchorKey(m.fileIndex, m.anchor));
    if (idx != null && idx >= seedItemIndex) return i;
  }
  return 0;
}

/**
 * The match at `index` as (file, row anchor, occurrence ordinal). Matches on
 * one line are adjacent in the list, so the ordinal is the run-length behind.
 */
function currentMatchAt(
  matches: FindMatch[],
  index: number,
): FindCurrent | null {
  const m = matches[index];
  if (!m) return null;
  let ordinal = 0;
  for (let i = index - 1; i >= 0; i--) {
    const p = matches[i];
    if (p.fileIndex !== m.fileIndex || p.anchor !== m.anchor) break;
    ordinal += 1;
  }
  return { fileIndex: m.fileIndex, anchor: m.anchor, ordinal };
}

/**
 * A document selection pinned to a diff code line as character offsets — the
 * form that survives the line's text nodes being replaced by a marks repaint.
 * (hljs spans and marks never add or drop characters, so text offsets within
 * a .qf-code element are stable across repaints.)
 */
interface CapturedSelection {
  code: Element;
  start: number;
  end: number;
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
    if (node === target) return offset;
    offset += node.data.length;
  }
  return null;
}

/** The (text node, local offset) at a line-level code column — the inverse of
 *  codeColumnOf, for building Ranges across mark-fragmented lines. */
function codePositionAt(
  code: Element,
  column: number,
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
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const el = node.parentElement;
  const code = el?.closest(".qf-code");
  const anchor = el?.closest("[data-anchor]")?.getAttribute("data-anchor");
  if (!code || !anchor) return null;
  const base = codeColumnOf(code, node);
  return base == null ? null : { anchor, column: base + range.startOffset };
}

/** The current selection as offsets within its diff code line, if it has one. */
function captureCodeSelection(): CapturedSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const container = range.commonAncestorContainer;
  const el = container instanceof Element ? container : container.parentElement;
  const code = el?.closest(".qf-code");
  if (!code) return null;
  let offset = 0;
  let start = -1;
  let end = -1;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node === range.startContainer) start = offset + range.startOffset;
    if (node === range.endContainer) end = offset + range.endOffset;
    offset += node.data.length;
  }
  // Boundaries on elements (not text nodes) don't happen for text selections
  // we care about — bail rather than guess.
  if (start < 0 || end < 0 || start >= end) return null;
  return { code, start, end };
}

/** Re-selects the captured offsets over the element's current text nodes. */
function restoreCodeSelection({ code, start, end }: CapturedSelection): void {
  if (!code.isConnected) return;
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
  if (!startNode || !endNode) return;
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const sel = window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** The inbox cache's view of a PR, for painting the shell before detail loads. */
function findCachedInboxPr(
  owner: string,
  repo: string,
  number: number,
): PullRequest | undefined {
  const match = (p: PullRequest) =>
    p.owner === owner && p.name === repo && p.number === number;
  const inbox = queryClient.getQueryData<InboxData>(queryKeys.inbox);
  if (inbox) {
    for (const key of ["reviewRequested", "assigned", "created", "involved"] as const) {
      const hit = inbox[key].prs.find(match);
      if (hit) return hit;
    }
  }
  // PRs from watched repos live in their own bucket, not the inbox payload.
  return queryClient
    .getQueryData<InboxBucket>(queryKeys.subscribed)
    ?.prs.find(match);
}

/** A branch name as a copyable chip: click copies the name, the icon confirms. */
function BranchChip({ name, label }: { name: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
  return (
    <button
      type="button"
      className={cn("qf-branch-chip", copied && "qf-branch-copied")}
      title={copied ? "Copied" : label}
      onClick={() => {
        void navigator.clipboard?.writeText(name).catch(() => {});
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? (
        <Check size={11} aria-hidden />
      ) : (
        <GitBranch size={11} aria-hidden />
      )}
      {name}
    </button>
  );
}
