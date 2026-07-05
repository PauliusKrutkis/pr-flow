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
  Copy,
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
import { anchorFractions } from "../../lib/diff";
import { warmHighlightCache } from "../../lib/highlight";
import { findInDiff, patchMayMatch, type FindMatch } from "../../lib/findInDiff";
import {
  occurrenceMatches,
  occurrenceSpecFromSelection,
  type OccurrenceMatch,
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
import { SubmitReviewModal } from "./SubmitReviewModal";
import { PrSearch } from "./PrSearch";
import { FindBar } from "./FindBar";
import { OverviewRuler, type RulerMatch } from "./OverviewRuler";

interface ReviewScreenProps {
  owner: string;
  repo: string;
  number: number;
}

/** An occurrence query plus the file section it lights up. */
type OccState = OccurrenceSpec & { fileIndex: number };

// Idle pre-mounting applies up to this many total patch rows (see the
// mount-ahead effect); past it, sections only mount as you approach them.
const PREMOUNT_MAX_ROWS = 30_000;

const EMPTY_COMMENTS: ReviewComment[] = [];
const EMPTY_PENDING: PendingComment[] = [];
const EMPTY_MATCHES: FindMatch[] = [];
const EMPTY_OCC: OccurrenceMatch[] = [];
const EMPTY_RULER: RulerMatch[] = [];

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
  const rightOpenRef = useLatest(rightOpen);
  const [commentIndex, setCommentIndex] = useState(0);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [prSearch, setPrSearch] = useState<null | "files" | "text">(null);
  // Files whose content moved out from under a viewed mark. Feeds the quiet
  // per-file "updated" affordances (sidebar dot, section chip) instead of a
  // sticky banner — the signal lives ON the files it's about, and marking a
  // file viewed again acknowledges it away.
  const [changedSinceViewed, setChangedSinceViewed] = useState<Set<string>>(
    () => new Set(),
  );
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
  // The concrete match position once the user has navigated (Enter/arrows);
  // null means "not navigated yet — derive the current match from the
  // viewport seed" (findSeededIndex below), which is what makes find start
  // from what you're looking at instead of the top of the PR, the way
  // editors and browsers anchor find to the caret/viewport.
  const [findIndex, setFindIndex] = useState<number | null>(null);
  // Where the user was looking when the query last changed: topmost visible
  // section and how far into it. Captured at event time (captureFindSeed) —
  // the render-time derivation below must not read layout. State (not a ref)
  // because findSeededIndex derives from it during render.
  const [findSeed, setFindSeed] = useState<{
    fileIndex: number;
    frac: number;
  } | null>(null);
  // The sections whose rendered rows carry the find marks: seeded with what's
  // near the viewport when the query changes, grown as sections approach (the
  // near-IO below). Keystroke cost stays viewport-bounded this way — marking
  // EVERY mounted section made typing scale with PR size once the idle
  // pre-mounter started mounting everything. The counter and overview ruler
  // read the patch-text match list and are unaffected by this scope.
  const [findMarkScope, setFindMarkScope] = useState<Set<number>>(
    () => new Set(),
  );
  // Bumped when mod+f fires while the bar is already open → refocus/select.
  const [findFocusSeq, setFindFocusSeq] = useState(0);
  // The first Enter lands on the match already counted as current (the
  // viewport-seeded one, say "9/17"); only subsequent presses advance. Reset
  // whenever the match list changes.
  const findJumpedRef = useRef(false);
  const findOpenRef = useLatest(findOpen);
  // Selection-occurrence highlighting: click or select a token in the diff
  // and its other occurrences in THAT FILE light up (editor convention).
  // Scoped to one file both for meaning (a click asks "where else here?" —
  // ⌘F answers the cross-file question) and for speed: repainting one section
  // keeps a click instant on huge PRs. Cleared by clicks on blank code, Esc,
  // and file navigation.
  const [occSpec, setOccSpec] = useState<OccState | null>(null);
  const occSpecRef = useLatest(occSpec);
  // Repainting rows with marks replaces their text nodes, which would kill
  // the very selection that triggered the marks (and collapse → clear them
  // right back — a loop). So the selection's position is captured before the
  // spec is applied and restored over the fresh nodes after the repaint.
  const occRestoreRef = useRef<CapturedSelection | null>(null);
  // Occurrence navigation (mark clicks, n/p): the last-jumped position in the
  // memoized occurrence-match list (-1 = not yet navigated), and the
  // occurrence the spec came from — the caret/selection position at commit —
  // so the first n/p step walks from THERE, not from the top of the file.
  // Both (re)seat in commit().
  const occNavRef = useRef(-1);
  const occOriginRef = useRef<{ anchor: string; column: number } | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  // When the user last did anything (scroll, keys, pointer) — the idle
  // pre-mounter yields to live interaction, because a section mount landing
  // between two keystrokes or scroll frames IS the lag it exists to prevent.
  const lastActivityTsRef = useRef(0);
  const sectionEls = useRef(new Map<number, HTMLElement>());
  const resumedRef = useRef(false);
  const mountShaRef = useRef("");
  const jumpNonceRef = useRef(0);
  const seedNonceRef = useRef(0);

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

  // Warm the per-line highlight cache in idle time: sections mount their rows
  // synchronously as you scroll toward them, and a cold hljs pass over a big
  // file is a whole dropped frame — pre-highlighted, mounting is cheap and
  // scrolling stays smooth. Cancelled when the file list changes (head moved).
  useEffect(() => {
    if (files.length === 0) return;
    return warmHighlightCache(files);
  }, [files]);

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
      // Transient by design: "new code arrived" is an event, not a state —
      // the durable signal is the per-file "updated" marks (which the
      // reconcile effect below may immediately make more specific).
      setToast({
        title: "Pull request updated",
        message: "Showing the latest changes.",
      });
    }
  }, [pr, keyValue, setToast]);

  // When the inbox heartbeat (60s poll / window focus — it keeps running on
  // this screen via ReviewNotifier) sees this PR move past what the detail
  // payload knows, refetch the detail right away instead of waiting out its
  // own poll. The ref gates one nudge per observed updatedAt, so a provider
  // whose detail timestamp lags its list can't put us in a refetch loop.
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

  // Auto-unview: a viewed mark vouches for the content you saw, so whenever
  // detail data lands (open or background refetch) each mark's stored
  // fingerprint is checked against the current diff. Mismatches are unviewed
  // and announced; migrated legacy marks silently adopt a fingerprint. The
  // viewed map is a dependency because its persisted load can race detail on
  // a resume-into-review boot — the pass is idempotent, so re-runs (including
  // the one this effect's own write triggers) settle immediately. Declared
  // after the head-move effect so the more specific toast wins the (single)
  // slot; the lasting record is the per-file "updated" marks.
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

  // Resume: put the viewport back where it was. A LAYOUT effect that sets
  // scrollTop directly, so the first frame the user sees IS the resumed spot —
  // the old post-paint scrollIntoView painted the top of the PR first and
  // then visibly jumped. Anchoring to the file section plus a stored offset
  // (not a raw scrollTop) stays correct even though placeholder heights above
  // it are estimates.
  useLayoutEffect(() => {
    if (!detail || resumedRef.current) return;
    const idx = initialMem?.fileIndex ?? 0;
    const host = scrollRef.current;
    const el = sectionEls.current.get(idx);
    if (!host || (!el && idx > 0)) return; // sections not registered yet
    resumedRef.current = true;
    const offset = initialMem?.sectionOffset ?? 0;
    if (!el || (idx === 0 && offset === 0)) return;
    const hostTop = host.getBoundingClientRect().top;
    const secTop = el.getBoundingClientRect().top - hostTop + host.scrollTop;
    host.scrollTop = Math.max(0, secTop + offset);
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

  // Which sections are near the viewport RIGHT NOW (adds and removes, unlike
  // `mounted`). Kept in a ref — it changes on every scroll and must not
  // re-render anything by itself; the find-mark scope below snapshots it.
  const nearRef = useRef(new Set<number>());
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || fileCount === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const idx = Number((en.target as HTMLElement).dataset.fileIndex);
          if (!Number.isFinite(idx)) continue;
          if (en.isIntersecting) {
            nearRef.current.add(idx);
            // A marked query is active and a fresh section is approaching:
            // pull it into the mark scope so its highlights are painted by
            // the time it's on screen. (State change, but only while find is
            // open AND only for sections not already in scope.)
            if (findOpenRef.current) {
              setFindMarkScope((prev) =>
                prev.has(idx) ? prev : new Set(prev).add(idx),
              );
            }
          } else {
            nearRef.current.delete(idx);
          }
        }
      },
      { root, rootMargin: "1500px 0px" },
    );
    for (const el of sectionEls.current.values()) io.observe(el);
    return () => {
      io.disconnect();
      nearRef.current.clear();
    };
  }, [fileCount, findOpenRef]);

  useEffect(() => {
    return () => {
      if (fileRafRef.current != null) cancelAnimationFrame(fileRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle mount-ahead: the IntersectionObserver above mounts sections as you
  // APPROACH them, which means a fast scroll pays each section's mount inside
  // a scrolled frame — the ~100ms hitch that reads as sticky-header stutter.
  // While you're reading (not scrolling), idle time quietly mounts the rest,
  // one section per idle slice, so scrolling lands on already-built DOM.
  // Bounded: skipped for monster PRs where holding every section's rows is
  // not worth it (content-visibility keeps mounted-but-offscreen rows cheap,
  // but DOM memory still scales with row count).
  const totalPatchRows = useMemo(
    () =>
      files.reduce((n, f) => n + (f.patch ? f.patch.split("\n").length : 0), 0),
    [files],
  );
  const mountedRef = useLatest(mounted);
  useEffect(() => {
    if (fileCount === 0 || totalPatchRows > PREMOUNT_MAX_ROWS) return;
    let cancelled = false;
    let handle: number | ReturnType<typeof setTimeout> | null = null;
    const idle =
      typeof requestIdleCallback === "function"
        ? window.requestIdleCallback.bind(window)
        : null;

    // "Idle" to requestIdleCallback just means the frame has slack — a pause
    // BETWEEN keystrokes qualifies, and a ~100ms section mount landing there
    // makes typing (find bar, comments) feel laggy. So the pump defers while
    // ANY input is recent, not only scrolling.
    const touch = () => {
      lastActivityTsRef.current = performance.now();
    };
    window.addEventListener("keydown", touch, { capture: true, passive: true });
    window.addEventListener("pointerdown", touch, { capture: true, passive: true });
    window.addEventListener("wheel", touch, { capture: true, passive: true });

    const schedule = () => {
      handle = idle ? idle(pump, { timeout: 3000 }) : setTimeout(pump, 250);
    };
    const pump = () => {
      if (cancelled) return;
      // Defer while input is recent — and entirely while the find bar is
      // open: every mounted section is one more section a keystroke may have
      // to repaint, so mounting DURING a find session works against it.
      if (
        findOpenRef.current ||
        performance.now() - lastActivityTsRef.current < 400
      ) {
        schedule();
        return;
      }
      const have = mountedRef.current;
      let next = -1;
      for (let i = 0; i < fileCountRef.current; i++) {
        if (!have.has(i)) {
          next = i;
          break;
        }
      }
      if (next === -1) return; // everything mounted — done for good
      setMounted((prev) =>
        prev.has(next) ? prev : new Set(prev).add(next),
      );
      schedule();
    };
    schedule();
    return () => {
      cancelled = true;
      window.removeEventListener("keydown", touch, { capture: true });
      window.removeEventListener("pointerdown", touch, { capture: true });
      window.removeEventListener("wheel", touch, { capture: true });
      if (handle != null) {
        if (idle) cancelIdleCallback(handle as number);
        else clearTimeout(handle as ReturnType<typeof setTimeout>);
      }
    };
  }, [fileCount, totalPatchRows, mountedRef, fileCountRef]);

  function handleScroll() {
    lastActivityTsRef.current = performance.now();
    const host = scrollRef.current;
    if (!host) return;
    // Position relative to the active file's section — what resume replays.
    // One rect read against clean layout (we're inside a scroll event).
    const sec = sectionEls.current.get(activeIndexRef.current);
    const sectionOffset = sec
      ? Math.round(
          host.getBoundingClientRect().top - sec.getBoundingClientRect().top,
        )
      : 0;
    updateReviewMemory(keyValue, { scrollTop: host.scrollTop, sectionOffset });
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
  function selectLine(
    fileIndex: number,
    anchor: string,
    opts: { keepOccurrences?: boolean } = {},
  ) {
    const target = files[fileIndex];
    if (!target) return;
    usePerfStore.getState().markFileStart();
    setMounted((prev) =>
      prev.has(fileIndex) ? prev : new Set(prev).add(fileIndex),
    );
    setActiveIndex(fileIndex);
    setCommentIndex(0);
    // A search jump is navigation too — drop stale occurrence marks. Two
    // exceptions: with the find bar open the occurrence state is frozen (and
    // suppressed), so leave it for the bar's close to restore; and occurrence
    // NAVIGATION (clicking a mark, n/p) rides selectLine to move BETWEEN the
    // marks — clearing the spec would tear the marks down mid-walk, so those
    // jumps opt out explicitly.
    if (!findOpenRef.current && !opts.keepOccurrences) setOccSpec(null);
    jumpNonceRef.current += 1;
    setJump({ filename: target.filename, anchor, nonce: jumpNonceRef.current });
  }
  // Ref'd so the mount-once click handler (occurrence-mark jumps) never calls
  // a stale closure over `files`.
  const selectLineRef = useLatest(selectLine);

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
  /** Re-anchor find to the viewport: remember the topmost visible section and
   *  the fraction of it scrolled past. Called from the query-change handlers
   *  (event time), so the seeded-index memo below stays layout-read-free. */
  function captureFindSeed() {
    const host = scrollRef.current;
    let seed: { fileIndex: number; frac: number } | null = null;
    if (host) {
      const hostTop = host.getBoundingClientRect().top;
      for (const [i, el] of sectionEls.current) {
        if (seed && seed.fileIndex <= i) continue;
        const r = el.getBoundingClientRect();
        if (r.bottom <= hostTop + 1) continue; // fully scrolled past
        const frac =
          r.top >= hostTop ? 0 : (hostTop - r.top) / Math.max(r.height, 1);
        seed = { fileIndex: i, frac };
      }
    }
    setFindSeed(seed);
  }

  // The first match at/after the captured viewport position, wrapping to the
  // top when everything is behind you — the editor convention (VS Code /
  // browsers anchor find to the caret; ours is the viewport). Row order
  // within the seed file compares by the same patch-fraction approximation
  // the overview ruler places its ticks with.
  const findSeededIndex = useMemo(() => {
    const seed = findSeed;
    if (!seed || findMatches.length === 0) return 0;
    for (let i = 0; i < findMatches.length; i++) {
      const m = findMatches[i];
      if (m.fileIndex < seed.fileIndex) continue;
      if (m.fileIndex > seed.fileIndex) return i;
      // anchorFractions caches per patch (lib/diff), so this stays one lookup.
      const fractions = anchorFractions(files[seed.fileIndex]?.patch);
      if ((fractions.get(m.anchor) ?? 0) >= seed.frac) return i;
    }
    return 0;
  }, [findMatches, files, findSeed]);

  // The file list can change under an open bar (PR head moved) — stay valid.
  const findSafeIndex =
    findMatches.length > 0
      ? Math.min(findIndex ?? findSeededIndex, findMatches.length - 1)
      : 0;

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

  // Every query edit re-anchors to the viewport: after a jump the viewport IS
  // the last match, so typing more keeps searching from where you are. The
  // mark scope re-snapshots to the sections near the viewport for the same
  // reason (see findMarkScope).
  function changeFindQuery(q: string) {
    captureFindSeed();
    setFindMarkScope(new Set(nearRef.current));
    setFindQuery(q);
    setFindIndex(null);
    findJumpedRef.current = false;
  }
  function toggleFindCase() {
    captureFindSeed();
    setFindMarkScope(new Set(nearRef.current));
    setFindCase((c) => !c);
    setFindIndex(null);
    findJumpedRef.current = false;
  }
  function openFind() {
    if (!findOpenRef.current) {
      // Reopening with a kept query still re-seeds from wherever you are now.
      captureFindSeed();
      setFindMarkScope(new Set(nearRef.current));
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

  // The occurrence spec's matches across its WHOLE file, from the patch text
  // (off-screen rows count). Feeds the overview ruler's ticks and, in occ
  // mode, click/n/p navigation between occurrences.
  const occMatchList = useMemo(
    () =>
      occSpec
        ? occurrenceMatches(files[occSpec.fileIndex] ?? {}, occSpec)
        : EMPTY_OCC,
    [occSpec, files],
  );
  const occMatchListRef = useLatest(occMatchList);

  // ---- occurrence navigation (clicking a mark, n/p) --------------------------
  // These read only refs, so the mount-once click handler can call them
  // without going stale. Declared ABOVE that handler's effect: function
  // declarations hoist at runtime, but the React Compiler doesn't model
  // hoisting and refuses to optimize a component that calls before declaring.

  /** Index in the match list of the occurrence covering (anchor, column). */
  function occIndexAt(anchor: string, column: number): number {
    return occMatchListRef.current.findIndex(
      (m) => m.anchor === anchor && m.start <= column && column <= m.end,
    );
  }

  /** Jump to match `index` (wrapping), keeping the marks alive. */
  function occJumpTo(index: number) {
    const spec = occSpecRef.current;
    const n = occMatchListRef.current.length;
    if (!spec || n === 0) return;
    const next = ((index % n) + n) % n;
    occNavRef.current = next;
    selectLineRef.current(spec.fileIndex, occMatchListRef.current[next].anchor, {
      keepOccurrences: true,
    });
  }

  /** n/p: step through the occurrences relative to the last-jumped position
   *  (or the origin occurrence — the clicked/selected one — before any jump). */
  function occStep(dir: 1 | -1) {
    if (occMatchListRef.current.length === 0) return;
    let at = occNavRef.current;
    if (at < 0) {
      const origin = occOriginRef.current;
      const found = origin ? occIndexAt(origin.anchor, origin.column) : -1;
      // No resolvable origin: n starts at the first match, p at the last.
      at = found >= 0 ? found : dir > 0 ? -1 : 0;
    }
    occJumpTo(at + dir);
  }

  // ---- selection → occurrence highlights ------------------------------------

  // Two ways in, VS Code-style: a single CLICK on a token marks its other
  // occurrences (like resting the caret in a word — the common case), and a
  // drag/double-click SELECTION marks arbitrary selected text. The
  // selectionchange listener is debounced (drag-selecting fires a burst) and
  // only ever SETS marks — clearing belongs to clicks on non-word code, Esc,
  // and file navigation, so the marks a click just placed aren't torn down by
  // the selection collapse that same click causes.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Skip identity-preserving updates entirely: no repaint on selection
    // noise, and no pointless selection restore. Capture even when clearing:
    // un-marking repaints rows too, and a fresh (non-qualifying) drag
    // selection shouldn't be eaten by that repaint.
    function commit(next: OccState | null) {
      const prev = occSpecRef.current;
      // (Re)seat occurrence navigation: n/p start walking from the occurrence
      // the spec came from (the caret / selection start). Updated even on
      // identity-preserving re-clicks — clicking the same token in another
      // spot moves the walk's starting point there.
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

    /** The file-section index a code element belongs to. */
    function sectionIndexOf(el: Element): number | null {
      const v = el.closest(".qf-fsec")?.getAttribute("data-file-index");
      const n = v == null ? NaN : Number(v);
      return Number.isFinite(n) ? n : null;
    }

    function specFromDomSelection(): OccState | null {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
      const container = sel.getRangeAt(0).commonAncestorContainer;
      const el =
        container instanceof Element ? container : container.parentElement;
      // Only selections inside ONE diff code line qualify: the range's common
      // ancestor sits inside a .qf-code exactly when the selection doesn't
      // cross rows, touch gutters, or leave the diff.
      const code = codeAround(el);
      if (!code) return null;
      const fileIndex = sectionIndexOf(code);
      if (fileIndex == null) return null;
      const spec = occurrenceSpecFromSelection(sel.toString());
      return spec && { ...spec, fileIndex };
    }

    /** The \w+ word around the caret position at (x, y), expanded within its
     *  text node (hljs keeps identifiers whole, so one node suffices). */
    function wordAtPoint(x: number, y: number): OccState | null {
      // caretPositionFromPoint is the standard; Chromium/WebKit still ship
      // the older caretRangeFromPoint — take whichever exists.
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
      const fileIndex = sectionIndexOf(code);
      if (fileIndex == null) return null;
      // Expand over the WHOLE LINE's text, not the caret's text node: marks
      // (intraline emphasis, find/occurrence highlights) fragment a line into
      // many text nodes, and expanding within one fragment would turn a click
      // on the emphasized `Limit` of `retryLimit` into the sub-word "Limit".
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
      // caret-from-point snaps to the NEAREST text position, so a click in
      // the blank area right of a line would otherwise "find" the line's
      // last word instead of reading as blank (which clears).
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
      // state instead of updating it, so closing the bar restores the
      // selection's highlights untouched.
      if (findOpenRef.current) return;
      const sel = window.getSelection();
      // A collapsed selection is silence, not a clear: the click that
      // collapsed it decides what happens (word → new marks, blank → clear).
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
      // A click that ends a drag-select carries the selection — that path owns it.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      // Clicking an EXISTING occurrence mark navigates instead of
      // re-committing the same spec: jump to the occurrence after the clicked
      // one (wrapping). The clicked occurrence is located by row anchor +
      // code column, which stays correct even when one occurrence renders as
      // several mark fragments (marks wrap per text node).
      const mark = target?.closest("mark.qf-occ-mark");
      if (mark && occSpecRef.current) {
        const code = codeAround(mark);
        const anchor = mark.closest("[data-anchor]")?.getAttribute("data-anchor");
        const textNode = mark.firstChild;
        if (code && anchor && textNode) {
          const column = codeColumnOf(code, textNode);
          const at = column == null ? -1 : occIndexAt(anchor, column);
          occJumpTo((at >= 0 ? at : occNavRef.current) + 1);
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

  // One marks identity, changing only with the query — so typing repaints
  // highlights once and FileSection memoization holds otherwise. Find wins
  // while its bar is open (even with an empty query): two mark systems at
  // once is noise. Occurrence marks come back when the bar closes, if the
  // selection survived. Find marks go to every section WITH a hit (the bar
  // counts across files, but sections whose patch can't contain the query
  // keep a null prop so their memo holds through typing); occurrence marks
  // only to their own file (see occSpec).
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
  // Which files get the find marks: a cheap superset test per file (raw patch
  // substring), NOT the capped match list — past MAX_MATCHES the list goes
  // silent on later files but their rendered highlights must still paint.
  const findMarkFiles = useMemo<Set<number> | null>(() => {
    if (!marks || marks.kind !== "find") return null;
    const set = new Set<number>();
    for (let i = 0; i < files.length; i++) {
      if (patchMayMatch(files[i].patch, marks.query, marks.caseSensitive)) {
        set.add(i);
      }
    }
    return set;
  }, [marks, files]);
  const marksFor = (i: number): MarkSpec | null =>
    marks &&
    (marks.kind === "find"
      ? // In scope (near the viewport when the query changed, or approached
        // since) AND possibly matching — plus the current match's section
        // unconditionally, so an Enter into a far file paints immediately.
        (!!findMarkFiles?.has(i) &&
          (findMarkScope.has(i) || findCurrent?.fileIndex === i))
      : occSpec?.fileIndex === i)
      ? marks
      : null;

  // What the overview ruler ticks: mirrors the marks precedence above — find
  // owns the diff while its bar is open, else the selection's occurrences.
  const rulerMatches = useMemo<ReadonlyArray<RulerMatch>>(() => {
    if (findOpen) return findQuery ? findMatches : EMPTY_RULER;
    if (!occSpec) return EMPTY_RULER;
    const fileIndex = occSpec.fileIndex;
    return occMatchList.map((m) => ({ fileIndex, anchor: m.anchor }));
  }, [findOpen, findQuery, findMatches, occSpec, occMatchList]);

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
  }, [fileCountRef]);

  // Hovering a row claims the keyboard for that file.
  const handleActivate = useCallback((index: number) => {
    setActiveIndex((cur) => (cur === index ? cur : index));
  }, []);

  // Declared above the closures that read it (the compiler doesn't model
  // use-before-declaration): the PR head sha, ref'd so stable callbacks stamp
  // the CURRENT head.
  const headShaRef = useLatest(pr?.headSha ?? "");

  // Marks are stamped with the file's current content fingerprint, so a later
  // push that touches the file can drop the mark (see the reconcile effect).
  // Toggling also retires the file's "updated" mark — touching the viewed
  // state is the acknowledgement the mark was asking for.
  const toggleViewedWithFp = useCallback(
    (f: ChangedFile) => {
      toggleViewed(keyValue, f.filename, fingerprintFile(f, headShaRef.current));
      setChangedSinceViewed((prev) => {
        if (!prev.has(f.filename)) return prev;
        const next = new Set(prev);
        next.delete(f.filename);
        return next;
      });
    },
    [toggleViewed, keyValue, headShaRef],
  );
  const handleToggleViewedAt = useCallback(
    (index: number) => {
      const f = filesRef.current[index];
      if (f) toggleViewedWithFp(f);
    },
    [toggleViewedWithFp, filesRef],
  );

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
  // Both copies confirm through the shared toast host — `y` used to be silent
  // and read as "does nothing".
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
    [addReviewComment.mutateAsync, headShaRef],
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
      // The editor convention (VS Code's "copy path" chord family). Plain
      // shift+letter can't be its own binding (the dispatcher lowercases),
      // hence the mod combo.
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
    // While a token's occurrences are marked, n/p walk between them with
    // wrap-around, riding the same selectLine jump machinery as find (and
    // explicitly NOT clearing the marks — see selectLine). Registered only
    // while a spec is active; n/p are otherwise unbound in this scope.
    ...(occSpec
      ? ([
          {
            keys: "n",
            description: "Next occurrence",
            hidden: true,
            run: () => occStep(1),
          },
          {
            keys: "p",
            description: "Previous occurrence",
            hidden: true,
            run: () => occStep(-1),
          },
        ] satisfies Binding[])
      : []),
    {
      // Esc walks out one layer at a time: find bar, then the info drawer,
      // then the inbox. Occurrence marks deliberately DON'T consume an Esc —
      // they're passive furniture (a blank click or clicking elsewhere clears
      // them), and spending a keypress on them makes "Esc → inbox" feel broken.
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
                marks={marksFor(i)}
                findCurrent={
                  findCurrent && findCurrent.fileIndex === i ? findCurrent : null
                }
                changed={changedSinceViewed.has(file.filename)}
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
          {/* Overview ruler: match ticks along the scroll range. Anchored to
              the same relative wrapper as the find bar so it hugs the scroll
              host's edge without scrolling away. */}
          <OverviewRuler
            hostRef={scrollRef}
            sectionEls={sectionEls}
            files={files}
            kind={findOpen ? "find" : "occurrence"}
            matches={rulerMatches}
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
 * of the caret / selection start, when it sits inside a diff code line. Both
 * commit paths leave the DOM selection there (a click collapses the caret
 * into the word; a drag/double-click IS the selection), so this is readable
 * at commit time without threading positions through the spec.
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
