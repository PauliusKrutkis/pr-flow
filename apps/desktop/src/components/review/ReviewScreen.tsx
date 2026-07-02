import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { cn } from "../../lib/cn";
import { Spinner } from "../ui/Spinner";
import { Kbd } from "../ui/Kbd";
import { Avatar } from "../ui/Avatar";
import { FileSidebar } from "./FileSidebar";
import { FileSection } from "./FileSection";
import { isImageFile } from "./ImageDiff";
import type { CursorSeed, JumpTarget } from "./DiffViewer";
import { RightPanel } from "./RightPanel";
import { OrientBanner } from "./OrientBanner";
import { SubmitReviewModal } from "./SubmitReviewModal";
import { PrSearch } from "./PrSearch";

interface ReviewScreenProps {
  owner: string;
  repo: string;
  number: number;
}

const EMPTY_COMMENTS: ReviewComment[] = [];
const EMPTY_PENDING: PendingComment[] = [];

/** A section counts as "current" once its header crosses this offset. */
const ACTIVE_OFFSET = 48;

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
  // Driven by scrolling (topmost visible section), hover, and file navigation.
  const [activeIndex, setActiveIndex] = useState(initialMem?.fileIndex ?? 0);
  // Windowing: sections whose diff bodies are rendered. Grows as you approach
  // sections; never shrinks, so scrolling back is always instant.
  const [mounted, setMounted] = useState<Set<number>>(
    () => new Set([0, initialMem?.fileIndex ?? 0]),
  );
  // The info drawer starts closed — the diff dominates until `i` opens it.
  const [rightOpen, setRightOpen] = useState(false);
  const [commentIndex, setCommentIndex] = useState(0);
  const [pending, setPending] = useState<PendingComment[]>([]);
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionEls = useRef(new Map<number, HTMLElement>());
  const pendingId = useRef(0);
  const resumedRef = useRef(false);
  const mountShaRef = useRef("");
  const jumpNonceRef = useRef(0);
  const seedNonceRef = useRef(0);
  const scrollRafRef = useRef<number | null>(null);

  const goInbox = useAppStore((s) => s.goInbox);
  const toggleViewed = useAppStore((s) => s.toggleViewed);
  // Subscribe to the viewed map so the sidebar and headers stay reactive.
  const viewed = useAppStore((s) => s.viewed);
  const viewedFiles = viewed[keyValue];
  const viewedSet = useMemo(() => new Set(viewedFiles ?? []), [viewedFiles]);

  const files = useMemo(() => detail?.files ?? [], [detail]);
  const fileCount = files.length;
  const clampedIndex = Math.min(activeIndex, Math.max(fileCount - 1, 0));
  const activeFile = files[clampedIndex];
  const isCurrentViewed = !!activeFile && viewedSet.has(activeFile.filename);

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
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
      if (fileRafRef.current != null) cancelAnimationFrame(fileRafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The topmost section whose header has crossed the active line is "current".
  function lastCrossedIndex(threshold: number): number {
    const c = scrollRef.current;
    if (!c) return 0;
    const top = c.getBoundingClientRect().top;
    let cur = 0;
    for (let i = 0; i < fileCountRef.current; i++) {
      const el = sectionEls.current.get(i);
      if (!el) continue;
      if (el.getBoundingClientRect().top - top <= threshold) cur = i;
      else break;
    }
    return cur;
  }

  // Hysteresis: advancing (scrolling down) switches as soon as the next header
  // crosses the line; retreating (scrolling up) waits until the current header
  // is clearly below it. The dead zone in between stops the sidebar highlight
  // from flapping between two files on small scrolls.
  function computeActive() {
    const current = activeIndexRef.current;
    const ahead = lastCrossedIndex(ACTIVE_OFFSET);
    if (ahead > current) {
      setActiveIndex(ahead);
      return;
    }
    const behind = lastCrossedIndex(ACTIVE_OFFSET + 40);
    if (behind < current) setActiveIndex(behind);
  }

  function handleScroll() {
    if (scrollRef.current) {
      updateReviewMemory(keyValue, { scrollTop: scrollRef.current.scrollTop });
    }
    if (scrollRafRef.current == null) {
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = null;
        computeActive();
      });
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
    jumpNonceRef.current += 1;
    setJump({ filename: target.filename, anchor, nonce: jumpNonceRef.current });
  }

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
  // `e`: ensure the current file is marked viewed, then advance.
  function markViewedAndNext() {
    if (activeFile && !isCurrentViewed) toggleViewed(keyValue, activeFile.filename);
    scrollToFile(activeIndexRef.current + 1);
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
      setPending((cur) => [...cur, { id: `p${pendingId.current++}`, ...c }]);
    },
    [],
  );
  const removePendingComment = useCallback((id: string) => {
    setPending((cur) => cur.filter((p) => p.id !== id));
  }, []);

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

  async function handleSubmitReview(event: ReviewEvent, body: string) {
    try {
      await submitReview.mutateAsync({
        event,
        body,
        commitId: pr?.headSha ?? "",
        comments: pending.map((p) => ({
          path: p.path,
          line: p.line,
          side: p.side,
          body: p.body,
        })),
      });
      setPending([]);
      setSubmitOpen(false);
      advanceAfterSubmit();
    } catch {
      // Error is surfaced in the modal via submitReview.error.
    }
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
      description: "Open files on GitHub",
      group: "General",
      icon: ExternalLink,
      run: () => {
        if (pr) void openUrl(pr.url + "/files");
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
      keys: "mod+f",
      description: "Search code",
      group: "Navigation",
      icon: Search,
      run: () => setPrSearch("text"),
    },
    {
      keys: "esc",
      description: "Back to inbox",
      group: "Navigation",
      icon: Inbox,
      run: goInbox,
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
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading pull request…" />
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
  const mutationPending = addReviewComment.isPending || reply.isPending;

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
                {pr.title}
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
              addPending={mutationPending}
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
          {/* Scroll-past-end room so the last file can reach the top and
              become the current file for keyboard navigation. */}
          {fileCount > 1 && <div style={{ height: "55vh" }} aria-hidden />}
        </div>
      </main>

      <RightPanel
        pr={pr}
        fileCount={fileCount}
        open={rightOpen}
        onClose={() => setRightOpen(false)}
        onAddIssueComment={async (body) => {
          await addIssueComment.mutateAsync({ body });
        }}
        issuePending={addIssueComment.isPending}
      />

      <SubmitReviewModal
        open={submitOpen}
        pendingCount={pending.length}
        busy={submitReview.isPending}
        error={submitReview.error ? String(submitReview.error) : null}
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
