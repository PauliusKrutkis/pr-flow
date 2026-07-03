import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowLeftRight,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  ExternalLink,
  FileSearch,
  GitBranch,
  Inbox,
  Info,
  Link,
  MessageSquare,
  Search,
  Send,
  TextSearch,
} from "lucide-react";
import { prKey } from "../../types";
import type {
  InboxData,
  PendingComment,
  PullRequest,
  ReviewComment,
  ReviewEvent,
} from "../../types";
import { useAppStore } from "../../store/appStore";
import { useHotkeys } from "../../keyboard";
import type { Binding } from "../../keyboard/types";
import { usePullRequestDetail } from "../../hooks/usePullRequestDetail";
import { useCommentMutations } from "../../hooks/useComments";
import { queryClient, queryKeys } from "../../lib/queryClient";
import { getReviewMemory, updateReviewMemory } from "../../lib/reviewMemory";
import { usePerfStore } from "../../lib/perf";
import { findInDiff, type FindMatch } from "../../lib/findInDiff";
import {
  occurrenceSpecFromSelection,
  type OccurrenceSpec,
} from "../../lib/occurrences";
import { cn } from "../../lib/cn";
import { Kbd } from "../ui/Kbd";
import { TicketTitle } from "../ui/TicketTitle";
import { Avatar } from "../ui/Avatar";
import { FileSidebar } from "./FileSidebar";
import { FileSection } from "./FileSection";
import { isImageFile } from "./ImageDiff";
import type {
  CursorSeed,
  FindCurrent,
  JumpTarget,
  MarkSpec,
} from "./DiffViewer";
import { RightPanel } from "./RightPanel";
import { OrientBanner } from "./OrientBanner";
import { SubmitReviewModal } from "./SubmitReviewModal";
import { PrSearch } from "./PrSearch";
import { FindBar } from "./FindBar";

interface ReviewScreenProps {
  owner: string;
  repo: string;
  number: number;
}

const EMPTY_COMMENTS: ReviewComment[] = [];
const EMPTY_PENDING: PendingComment[] = [];
const EMPTY_MATCHES: FindMatch[] = [];

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
  // it: a scroll-derived highlight flaps at section boundaries, and you
  // haven't committed to a file until you touch it (the sticky section header
  // always names what's on screen).
  const [activeIndex, setActiveIndex] = useState(initialMem?.fileIndex ?? 0);
  // Windowing: sections whose diff bodies are rendered. Grows as you approach
  // sections; never shrinks, so scrolling back is always instant.
  const [mounted, setMounted] = useState<Set<number>>(
    () => new Set([0, initialMem?.fileIndex ?? 0]),
  );
  // The info drawer starts closed — the diff dominates until `i` opens it.
  const [rightOpen, setRightOpen] = useState(false);
  const rightOpenRef = useRef(false);
  rightOpenRef.current = rightOpen;
  const [commentIndex, setCommentIndex] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [prSearch, setPrSearch] = useState<null | "files" | "text">(null);
  // Only shown when the PR's head moves mid-review (never on open).
  const [banner, setBanner] = useState<string | null>(null);
  // A pending "land on this line" request from in-PR text search.
  const [jump, setJump] = useState<(JumpTarget & { filename: string }) | null>(
    null,
  );
  // Cross-file cursor handoff (j/k moving past a file edge).
  const [seed, setSeed] = useState<(CursorSeed & { index: number }) | null>(
    null,
  );
  // Find-in-diff (mod+f): an editor-style bar over the diff, not a modal. The
  // state lives here (not in the bar) because the query has to flow down to
  // every FileSection for highlighting, and navigation reuses selectLine.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findCase, setFindCase] = useState(false);
  const [findIndex, setFindIndex] = useState(0);
  // Bumped when mod+f fires while the bar is already open → refocus/select.
  const [findFocusSeq, setFindFocusSeq] = useState(0);
  // The first Enter lands on the match already counted as current ("1/17");
  // only subsequent presses advance. Reset whenever the match list changes.
  const findJumpedRef = useRef(false);
  const findOpenRef = useRef(false);
  findOpenRef.current = findOpen;
  // Selection-occurrence highlighting: select a token in the diff and its
  // other occurrences light up (editor convention). Set from selectionchange,
  // cleared by Esc / file navigation / the selection collapsing.
  const [occSpec, setOccSpec] = useState<OccurrenceSpec | null>(null);
  const occSpecRef = useRef(occSpec);
  occSpecRef.current = occSpec;
  // Repainting rows with marks replaces their text nodes, which would kill
  // the very selection that triggered the marks (and collapse → clear them
  // right back — a loop). So the selection's position is captured before the
  // spec is applied and restored over the fresh nodes after the repaint.
  const occRestoreRef = useRef<CapturedSelection | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef(new Map<number, HTMLElement>());
  const resumedRef = useRef(false);
  const mountShaRef = useRef("");
  const jumpNonceRef = useRef(0);
  const seedNonceRef = useRef(0);

  const goInbox = useAppStore((s) => s.goInbox);
  const toggleViewed = useAppStore((s) => s.toggleViewed);
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
  const activeLogin = useAppStore(
    (s) => s.accounts.find((a) => a.id === s.activeAccountId)?.login,
  );
  const trackerBase = useAppStore((s) =>
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined,
  );
  const viewedFiles = viewed[keyValue];
  const viewedSet = useMemo(() => new Set(viewedFiles ?? []), [viewedFiles]);

  const files = useMemo(() => detail?.files ?? [], [detail]);
  const fileCount = files.length;
  const clampedIndex = Math.min(activeIndex, Math.max(fileCount - 1, 0));
  const activeFile = files[clampedIndex];

  // Live refs so rAF-coalesced handlers and stable callbacks read fresh state.
  const activeIndexRef = useRef(clampedIndex);
  activeIndexRef.current = clampedIndex;
  const fileCountRef = useRef(fileCount);
  fileCountRef.current = fileCount;
  const filesRef = useRef(files);
  filesRef.current = files;

  // Per-file buckets, memoized so FileSection memoization holds across the
  // frequent active-index re-renders.
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

  // Placeholder heights for not-yet-rendered sections, from patch line counts.
  const estimates = useMemo(
    () =>
      files.map((f) => {
        if (!f.patch) return 280;
        return Math.max(80, f.patch.split("\n").length * 26 + 56);
      }),
    [files],
  );

  // Seed the head sha on open (recording open latency), then only speak up if
  // the PR's head *moves while you're reviewing it* — no on-open summary banner.
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
      setBanner("This PR changed while you were reviewing — showing the latest.");
    }
  }, [pr, keyValue]);

  // Resume: scroll back to the file you were on. Anchoring to the file section
  // (not a raw scrollTop) stays correct even though placeholder heights above
  // it are estimates.
  useEffect(() => {
    if (!detail || resumedRef.current) return;
    resumedRef.current = true;
    const idx = initialMem?.fileIndex ?? 0;
    if (idx > 0 && idx < detail.files.length) {
      requestAnimationFrame(() => {
        sectionEls.current.get(idx)?.scrollIntoView({ block: "start" });
      });
    }
  }, [detail, initialMem]);

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

  const registerEl = useCallback((index: number, el: HTMLElement | null) => {
    if (el) sectionEls.current.set(index, el);
    else sectionEls.current.delete(index);
  }, []);

  // Mount diff bodies as their sections approach the viewport.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || fileCount === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const add: number[] = [];
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const idx = Number((en.target as HTMLElement).dataset.fileIndex);
          if (Number.isFinite(idx)) add.push(idx);
        }
        if (add.length) {
          setMounted((prev) => {
            if (add.every((i) => prev.has(i))) return prev;
            const next = new Set(prev);
            for (const i of add) next.add(i);
            return next;
          });
        }
      },
      { root, rootMargin: "1000px 0px" },
    );
    for (const el of sectionEls.current.values()) io.observe(el);
    return () => io.disconnect();
  }, [fileCount]);

  useEffect(() => {
    return () => {
      if (fileRafRef.current != null) cancelAnimationFrame(fileRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleScroll() {
    if (scrollRef.current) {
      updateReviewMemory(keyValue, { scrollTop: scrollRef.current.scrollTop });
    }
  }

  function pageScroll(dir: number) {
    const el = scrollRef.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.85 });
  }

  // ---- file navigation ------------------------------------------------------

  function scrollToFile(i: number) {
    if (fileCountRef.current === 0) return;
    const target = Math.min(Math.max(i, 0), fileCountRef.current - 1);
    usePerfStore.getState().markFileStart();
    setMounted((prev) => (prev.has(target) ? prev : new Set(prev).add(target)));
    setActiveIndex(target);
    setCommentIndex(0);
    setJump(null);
    // Navigating away is moving on — stale occurrence marks would just be
    // mystery highlights with their selection off-screen.
    setOccSpec(null);
    requestAnimationFrame(() => {
      sectionEls.current.get(target)?.scrollIntoView({ block: "start" });
    });
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

  // From file search: open the file and seed the comment cursor on its first
  // line, so `c` (and j/k) work immediately without a hover.
  function selectFileFromSearch(fileIndex: number) {
    scrollToFile(fileIndex);
    seedNonceRef.current += 1;
    setSeed({ index: fileIndex, edge: "first", nonce: seedNonceRef.current });
  }

  // From text search: reveal the file AND land on the matched line.
  function selectLine(fileIndex: number, anchor: string) {
    const target = files[fileIndex];
    if (!target) return;
    usePerfStore.getState().markFileStart();
    setMounted((prev) =>
      prev.has(fileIndex) ? prev : new Set(prev).add(fileIndex),
    );
    setActiveIndex(fileIndex);
    setCommentIndex(0);
    // A search jump is navigation too — drop stale occurrence marks. Find
    // stepping also lands here, but with the bar open the occurrence state is
    // frozen (and suppressed), so leave it for the bar's close to restore.
    if (!findOpenRef.current) setOccSpec(null);
    jumpNonceRef.current += 1;
    setJump({ filename: target.filename, anchor, nonce: jumpNonceRef.current });
  }

  // ---- find in diff (mod+f) -------------------------------------------------

  // Matches come from the PATCH TEXT (lib/findInDiff), so unmounted sections
  // count too; only rendered rows pay for highlighting.
  const findMatches = useMemo(
    () =>
      findOpen && findQuery
        ? findInDiff(files, findQuery, { caseSensitive: findCase })
        : EMPTY_MATCHES,
    [findOpen, findQuery, findCase, files],
  );
  // The file list can change under an open bar (PR head moved) — stay valid.
  const findSafeIndex =
    findMatches.length > 0 ? Math.min(findIndex, findMatches.length - 1) : 0;

  // The current match as (row anchor, occurrence ordinal). Matches on one line
  // are adjacent in the list, so the ordinal is the run-length behind us.
  const findCurrent = useMemo<(FindCurrent & { fileIndex: number }) | null>(() => {
    const m = findMatches[findSafeIndex];
    if (!m) return null;
    let ordinal = 0;
    for (let i = findSafeIndex - 1; i >= 0; i--) {
      const p = findMatches[i];
      if (p.fileIndex !== m.fileIndex || p.anchor !== m.anchor) break;
      ordinal += 1;
    }
    return { fileIndex: m.fileIndex, anchor: m.anchor, ordinal };
  }, [findMatches, findSafeIndex]);

  function changeFindQuery(q: string) {
    setFindQuery(q);
    setFindIndex(0);
    findJumpedRef.current = false;
  }
  function toggleFindCase() {
    setFindCase((c) => !c);
    setFindIndex(0);
    findJumpedRef.current = false;
  }
  function openFind() {
    if (!findOpenRef.current) {
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
  // occurrences, if any) and, because the input unmounts, focus falls back to
  // the document — j/k works immediately.
  function closeFind() {
    setFindOpen(false);
  }
  // Enter/next/prev: the first press jumps to the CURRENT match, later ones
  // step (with wrap-around). Every jump rides the selectLine machinery, which
  // mounts the section, scrolls the row into view, and flashes it.
  function findStep(dir: 1 | -1) {
    const n = findMatches.length;
    if (n === 0) return;
    const next = findJumpedRef.current ? (findSafeIndex + dir + n) % n : findSafeIndex;
    findJumpedRef.current = true;
    setFindIndex(next);
    const m = findMatches[next];
    selectLine(m.fileIndex, m.anchor);
  }

  // ---- selection → occurrence highlights ------------------------------------

  // Watch the document selection (debounced — drag-selecting fires a burst of
  // selectionchange events) and turn a qualifying selection inside a single
  // diff code line into an occurrence query. Double-click word selection
  // arrives through this same event, so it needs no extra handling.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    function specFromDomSelection(): OccurrenceSpec | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const container = sel.getRangeAt(0).commonAncestorContainer;
      const el =
        container instanceof Element ? container : container.parentElement;
      // Only selections inside ONE diff code line qualify: the range's common
      // ancestor sits inside a .qf-code exactly when the selection doesn't
      // cross rows, touch gutters, or leave the diff. Hunk headers share the
      // .qf-code class but are metadata, not code — skip them.
      const code = el?.closest(".qf-code");
      if (!code || el?.closest(".qf-row-hunk")) return null;
      return occurrenceSpecFromSelection(sel.toString());
    }

    function apply() {
      timer = null;
      // While the find bar is open its marks own the diff — freeze occurrence
      // state instead of updating it, so closing the bar restores the
      // selection's highlights untouched.
      if (findOpenRef.current) return;
      const next = specFromDomSelection();
      // Skip identity-preserving updates entirely: no repaint on selection
      // noise, and no pointless selection restore.
      const prev = occSpecRef.current;
      if (
        prev &&
        next &&
        prev.query === next.query &&
        prev.wholeWord === next.wholeWord
      ) {
        return;
      }
      if (prev === next) return;
      // Capture even when clearing: un-marking repaints rows too, and a fresh
      // (non-qualifying) drag selection shouldn't be eaten by that repaint.
      occRestoreRef.current = captureCodeSelection();
      setOccSpec(next);
    }

    function onSelectionChange() {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(apply, 150);
    }

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      if (timer != null) clearTimeout(timer);
    };
  }, []);

  // Re-select what the user had selected, over the row's freshly-painted text
  // nodes, before the browser paints — so the selection appears to simply
  // survive the marks appearing under it. The restore fires selectionchange
  // again, but it resolves to the same spec and the identity guard above
  // makes that a no-op instead of a loop.
  useLayoutEffect(() => {
    const captured = occRestoreRef.current;
    occRestoreRef.current = null;
    if (captured) restoreCodeSelection(captured);
  }, [occSpec]);

  // One shared marks identity for all sections, changing only with the query
  // — so typing repaints highlights once and FileSection memoization holds
  // otherwise. Find wins while its bar is open (even with an empty query):
  // two mark systems at once is noise. Occurrence marks come back when the
  // bar closes, if the selection survived.
  const marks = useMemo<MarkSpec | null>(() => {
    if (findOpen) {
      return findQuery
        ? { kind: "find", query: findQuery, caseSensitive: findCase }
        : null;
    }
    return occSpec
      ? { kind: "occurrence", query: occSpec.query, wholeWord: occSpec.wholeWord }
      : null;
  }, [findOpen, findQuery, findCase, occSpec]);

  // j/k crossing a file edge: activate the neighbour and seed its cursor.
  const handleCursorExit = useCallback((index: number, dir: 1 | -1) => {
    const next = index + dir;
    if (next < 0 || next >= fileCountRef.current) return;
    setMounted((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    setActiveIndex(next);
    seedNonceRef.current += 1;
    setSeed({
      index: next,
      edge: dir > 0 ? "first" : "last",
      nonce: seedNonceRef.current,
    });
  }, []);

  // Hovering a row claims the keyboard for that file.
  const handleActivate = useCallback((index: number) => {
    setActiveIndex((cur) => (cur === index ? cur : index));
  }, []);

  const handleToggleViewedAt = useCallback(
    (index: number) => {
      const f = filesRef.current[index];
      if (f) toggleViewed(keyValue, f.filename);
    },
    [toggleViewed, keyValue],
  );

  function toggleViewedFile() {
    if (activeFile) toggleViewed(keyValue, activeFile.filename);
  }
  // `e`: toggle the current file's viewed state. Marking advances to the next
  // file; UNmarking stays put (you're revisiting, not moving on).
  function markViewedAndNext() {
    if (!activeFile) return;
    const wasViewed = viewedSet.has(activeFile.filename);
    toggleViewed(keyValue, activeFile.filename);
    if (!wasViewed) scrollToFile(activeIndexRef.current + 1);
  }
  function copyLink() {
    if (!pr?.url) return;
    void navigator.clipboard?.writeText(pr.url).catch(() => {});
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

  function goToComment(delta: number) {
    const container = scrollRef.current;
    if (!container) return;
    const nodes = Array.from(
      container.querySelectorAll<HTMLElement>(".js-comment"),
    );
    if (nodes.length === 0) return;
    const next = (commentIndex + delta + nodes.length) % nodes.length;
    setCommentIndex(next);
    nodes[next].scrollIntoView({ block: "center" });
  }

  const addPendingComment = useCallback(
    (c: { path: string; line: number; side: string; body: string }) => {
      addPendingStore(keyValue, c);
    },
    [addPendingStore, keyValue],
  );
  const removePendingComment = useCallback(
    (id: string) => {
      removePendingStore(keyValue, id);
    },
    [removePendingStore, keyValue],
  );

  const headShaRef = useRef("");
  headShaRef.current = pr?.headSha ?? "";
  const handleAddComment = useCallback(
    async (a: { path: string; line: number; side: string; body: string }) => {
      await addReviewComment.mutateAsync({
        body: a.body,
        commitId: headShaRef.current,
        path: a.path,
        line: a.line,
        side: a.side,
      });
    },
    [addReviewComment.mutateAsync],
  );
  const handleReply = useCallback(
    async (a: { inReplyTo: number; body: string }) => {
      await reply.mutateAsync(a);
    },
    [reply.mutateAsync],
  );

  function openSubmit() {
    submitReview.reset();
    setSubmitOpen(true);
  }

  // Optimistic: close + advance immediately; the network settles behind you.
  // On failure the drafts are still pending (they only clear on success) and a
  // flash message says so.
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

  // When the current file has no diff to cursor through (an image or a plain
  // binary without a mounted viewer), j/k flow straight into the neighbours.
  // These fallbacks are listed only in that case, so a mounted DiffViewer's own
  // j/k always wins.
  const activeHasNoDiffCursor =
    !!activeFile && (isImageFile(activeFile) || !mounted.has(clampedIndex));
  const cursorFallbacks: Binding[] = activeHasNoDiffCursor
    ? [
        {
          keys: ["j", "down"],
          description: "Next line",
          hidden: true,
          run: () => handleCursorExit(activeIndexRef.current, 1),
        },
        {
          keys: ["k", "up"],
          description: "Previous line",
          hidden: true,
          run: () => handleCursorExit(activeIndexRef.current, -1),
        },
      ]
    : [];

  useHotkeys("review", [
    ...cursorFallbacks,
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
      // cycles files with wrap-around (Shift+Tab goes back). This also removes
      // stray focus rings — focus never leaves the diff.
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
    // after focus has returned to the diff. (With focus IN the bar's input,
    // the dispatcher defers to it and the input handles these keys itself, so
    // nothing fires twice.)
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
    {
      // Esc walks out one layer at a time: find bar, then occurrence marks,
      // then the info drawer, then the inbox.
      keys: "esc",
      description: "Close panel / back to inbox",
      group: "Navigation",
      icon: Inbox,
      run: () => {
        if (findOpenRef.current) closeFind();
        else if (occSpecRef.current) setOccSpec(null);
        else if (rightOpenRef.current) setRightOpen(false);
        else goInbox();
      },
    },
  ]);

  // No detail yet: either still loading, or the fetch failed with nothing
  // cached. The latter is reachable on boot when resuming into a PR that was
  // deleted / made inaccessible — show an escape hatch instead of a forever
  // spinner. (`Esc` → inbox is also bound above.)
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
    // inbox already knows (title, number, repo) and skeleton the rest.
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

        {banner && (
          <OrientBanner
            message={banner}
            tone="update"
            onDismiss={() => setBanner(null)}
          />
        )}

        {/* The find bar floats over the diff's top-right corner — anchored to
            this wrapper (not the scroll host) so it never scrolls away. */}
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
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="qf-scrollhost min-w-0 flex-1 overflow-y-auto"
          >
            {files.map((file, i) => (
              <FileSection
                key={file.filename}
                file={file}
                index={i}
                active={i === clampedIndex}
                mountedBody={mounted.has(i)}
                estimatedHeight={estimates[i]}
                registerEl={registerEl}
                viewed={viewedSet.has(file.filename)}
                owner={owner}
                repo={repo}
                baseSha={pr.baseSha}
                headSha={pr.headSha}
                comments={commentsByFile.get(file.filename) ?? EMPTY_COMMENTS}
                pending={pendingByFile.get(file.filename) ?? EMPTY_PENDING}
                jump={jump && jump.filename === file.filename ? jump : null}
                seed={seed && seed.index === i ? seed : null}
                marks={marks}
                findCurrent={
                  findCurrent && findCurrent.fileIndex === i ? findCurrent : null
                }
                addPending={false}
                onActivate={handleActivate}
                onCursorExit={handleCursorExit}
                onToggleViewed={handleToggleViewedAt}
                onAddComment={handleAddComment}
                onReply={handleReply}
                onAddPending={addPendingComment}
                onRemovePending={removePendingComment}
              />
            ))}
            {fileCount === 0 && <div className="qf-empty">No files changed.</div>}
          </div>
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
  const inbox = queryClient.getQueryData<InboxData>(queryKeys.inbox);
  if (!inbox) return undefined;
  for (const key of ["reviewRequested", "assigned", "created", "involved"] as const) {
    const hit = inbox[key].prs.find(
      (p) => p.owner === owner && p.name === repo && p.number === number,
    );
    if (hit) return hit;
  }
  return undefined;
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
