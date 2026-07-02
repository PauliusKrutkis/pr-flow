import { useEffect, useRef, useState } from "react";
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
  ReviewEvent,
} from "../../types";
import { useAppStore } from "../../store/appStore";
import { useHotkeys } from "../../keyboard";
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
import { DiffViewer, type JumpTarget } from "./DiffViewer";
import { RightPanel } from "./RightPanel";
import { OrientBanner } from "./OrientBanner";
import { SubmitReviewModal } from "./SubmitReviewModal";
import { PrSearch } from "./PrSearch";

interface ReviewScreenProps {
  owner: string;
  repo: string;
  number: number;
}

export function ReviewScreen({ owner, repo, number }: ReviewScreenProps) {
  const keyValue = prKey({ owner, name: repo, number });

  const { data, isError, error } = usePullRequestDetail(owner, repo, number);
  const { addReviewComment, reply, addIssueComment, submitReview } =
    useCommentMutations(owner, repo, number);

  const detail = data;
  const pr = detail?.pr;

  // Resume position for this PR (captured once per mount, before edits).
  const [initialMem] = useState(() => getReviewMemory(keyValue));

  const [selectedFileIndex, setSelectedFileIndex] = useState(
    initialMem?.fileIndex ?? 0,
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

  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingId = useRef(0);
  const restoredScrollRef = useRef(false);
  const mountShaRef = useRef("");
  const jumpNonceRef = useRef(0);

  const goInbox = useAppStore((s) => s.goInbox);
  const toggleViewed = useAppStore((s) => s.toggleViewed);
  // Subscribe to the viewed map so the header count stays reactive.
  const viewed = useAppStore((s) => s.viewed);

  const files = detail?.files ?? [];
  const fileCount = files.length;
  const clampedIndex = Math.min(selectedFileIndex, Math.max(fileCount - 1, 0));
  const selectedFile = files[clampedIndex];
  const isCurrentViewed =
    !!selectedFile && (viewed[keyValue] ?? []).includes(selectedFile.filename);

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

  // Restore the saved scroll position once the diff is on screen.
  useEffect(() => {
    if (!detail || restoredScrollRef.current) return;
    restoredScrollRef.current = true;
    const top = initialMem?.scrollTop ?? 0;
    if (top > 0) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = top;
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

  function scrollTop() {
    scrollRef.current?.scrollTo({ top: 0 });
  }
  function pageScroll(dir: number) {
    const el = scrollRef.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.85 });
  }

  // File switching is coalesced per animation frame, mirroring the diff line
  // cursor: holding r/t (or Tab) accumulates a net delta applied once per
  // frame, so a burst of key-repeats can't queue up a remount per press.
  const fileCountRef = useRef(fileCount);
  fileCountRef.current = fileCount;
  const fileDeltaRef = useRef(0);
  const fileRafRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (fileRafRef.current != null) cancelAnimationFrame(fileRafRef.current);
    };
  }, []);

  function flushFileMove() {
    fileRafRef.current = null;
    const delta = fileDeltaRef.current;
    fileDeltaRef.current = 0;
    if (delta === 0 || fileCountRef.current === 0) return;
    usePerfStore.getState().markFileStart();
    setSelectedFileIndex((i) =>
      Math.min(Math.max(i + delta, 0), fileCountRef.current - 1),
    );
    setCommentIndex(0);
    setJump(null);
    scrollTop();
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

  function selectFile(i: number) {
    usePerfStore.getState().markFileStart();
    setSelectedFileIndex(i);
    setCommentIndex(0);
    setJump(null);
    scrollTop();
  }

  // From text search: open the file AND land on the matched line.
  function selectLine(fileIndex: number, anchor: string) {
    const target = files[fileIndex];
    if (!target) return;
    usePerfStore.getState().markFileStart();
    setSelectedFileIndex(fileIndex);
    setCommentIndex(0);
    jumpNonceRef.current += 1;
    setJump({ filename: target.filename, anchor, nonce: jumpNonceRef.current });
  }

  function toggleViewedFile() {
    if (selectedFile) toggleViewed(keyValue, selectedFile.filename);
  }
  // `e`: ensure the current file is marked viewed, then advance.
  function markViewedAndNext() {
    if (selectedFile && !isCurrentViewed) toggleViewed(keyValue, selectedFile.filename);
    nextFile();
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

  function addPendingComment(c: {
    path: string;
    line: number;
    side: string;
    body: string;
  }) {
    setPending((cur) => [...cur, { id: `p${pendingId.current++}`, ...c }]);
  }
  function removePendingComment(id: string) {
    setPending((cur) => cur.filter((p) => p.id !== id));
  }

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

  useHotkeys("review", [
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
      // cycles files (Shift+Tab goes back). This also removes stray focus
      // rings — focus never leaves the diff.
      keys: "tab",
      description: "Next / previous file",
      group: "Files",
      icon: ArrowLeftRight,
      run: (e) => (e.shiftKey ? prevFile() : nextFile()),
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

  const fileComments = selectedFile
    ? detail.comments.filter((c) => c.path === selectedFile.filename)
    : [];
  const pendingForFile = selectedFile
    ? pending.filter((p) => p.path === selectedFile.filename)
    : [];
  const selectedGlyph = selectedFile ? fileGlyph(selectedFile.status) : null;
  const viewedNow = viewed[keyValue]?.length ?? 0;

  return (
    <div className="dir-quiet relative flex h-full min-h-0 overflow-hidden">
      <aside className="w-[300px] shrink-0 border-r border-line">
        <FileSidebar
          files={files}
          selectedIndex={clampedIndex}
          onSelect={selectFile}
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

        {selectedFile && selectedGlyph && (
          <div className="qf-filebar flex shrink-0 items-center gap-3 px-6 py-2">
            <span className={"qf-file-glyph " + selectedGlyph.cls}>
              {selectedGlyph.letter}
            </span>
            <span className="qf-filebar-name min-w-0 truncate">
              {selectedFile.previousFilename &&
                selectedFile.status === "renamed" && (
                  <span className="qf-filebar-prev">
                    {selectedFile.previousFilename} →{" "}
                  </span>
                )}
              {selectedFile.filename}
            </span>
            <span className="qf-filebar-stat">
              <span className="qf-add">+{selectedFile.additions}</span>
              <span className="qf-del">−{selectedFile.deletions}</span>
            </span>
            <span className="ml-auto qf-muted text-xs">
              {viewedNow}/{fileCount} viewed
            </span>
          </div>
        )}

        <div
          ref={scrollRef}
          onScroll={() => {
            if (scrollRef.current)
              updateReviewMemory(keyValue, {
                scrollTop: scrollRef.current.scrollTop,
              });
          }}
          className="min-w-0 flex-1 overflow-y-auto"
        >
          {selectedFile ? (
            <DiffViewer
              key={selectedFile.filename}
              file={selectedFile}
              comments={fileComments}
              commitId={pr.headSha}
              jumpTo={
                jump && jump.filename === selectedFile.filename ? jump : null
              }
              pending={pendingForFile}
              onAddPending={addPendingComment}
              onRemovePending={removePendingComment}
              onAddComment={async (a) => {
                await addReviewComment.mutateAsync({
                  body: a.body,
                  commitId: pr.headSha,
                  path: a.path,
                  line: a.line,
                  side: a.side,
                });
              }}
              onReply={async (a) => {
                await reply.mutateAsync(a);
              }}
              addPending={addReviewComment.isPending || reply.isPending}
            />
          ) : (
            <div className="qf-empty">No files changed.</div>
          )}
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
        onSelectFile={selectFile}
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

/** File-status glyph for the path strip (mirrors FileSidebar's glyphs). */
function fileGlyph(status: string): { letter: string; cls: string } {
  switch (status) {
    case "added":
      return { letter: "A", cls: "qf-st-add" };
    case "removed":
      return { letter: "D", cls: "qf-st-del" };
    case "renamed":
      return { letter: "R", cls: "qf-st-ren" };
    case "copied":
      return { letter: "C", cls: "qf-st-ren" };
    default:
      return { letter: "M", cls: "qf-st-mod" };
  }
}
