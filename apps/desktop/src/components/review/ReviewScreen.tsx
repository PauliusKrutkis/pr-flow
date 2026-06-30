import { useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { prKey } from "../../types";
import type { PendingComment, ReviewEvent } from "../../types";
import { useAppStore } from "../../store/appStore";
import { useHotkeys } from "../../keyboard";
import { usePullRequestDetail } from "../../hooks/usePullRequestDetail";
import { useCommentMutations } from "../../hooks/useComments";
import { Spinner } from "../ui/Spinner";
import { Badge } from "../ui/Badge";
import { FileSidebar } from "./FileSidebar";
import { DiffViewer } from "./DiffViewer";
import { RightPanel } from "./RightPanel";
import { SubmitReviewModal } from "./SubmitReviewModal";

interface ReviewScreenProps {
  owner: string;
  repo: string;
  number: number;
}

export function ReviewScreen({ owner, repo, number }: ReviewScreenProps) {
  const { data, refetch } = usePullRequestDetail(owner, repo, number);
  const { addReviewComment, reply, addIssueComment, submitReview } =
    useCommentMutations(owner, repo, number);

  const detail = data;
  const pr = detail?.pr;

  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [rightOpen, setRightOpen] = useState(true);
  const [commentIndex, setCommentIndex] = useState(0);
  const [pending, setPending] = useState<PendingComment[]>([]);
  const [submitOpen, setSubmitOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingId = useRef(0);

  const goInbox = useAppStore((s) => s.goInbox);
  const toggleViewed = useAppStore((s) => s.toggleViewed);
  // Subscribe to the viewed map so the header count stays reactive.
  const viewed = useAppStore((s) => s.viewed);

  const keyValue = prKey({ owner, name: repo, number });

  const files = detail?.files ?? [];
  const fileCount = files.length;
  const clampedIndex = Math.min(selectedFileIndex, Math.max(fileCount - 1, 0));
  const selectedFile = files[clampedIndex];

  function scrollTop() {
    scrollRef.current?.scrollTo({ top: 0 });
  }
  function pageScroll(dir: number) {
    const el = scrollRef.current;
    if (el) el.scrollBy({ top: dir * el.clientHeight * 0.85 });
  }

  function nextFile() {
    if (fileCount === 0) return;
    setSelectedFileIndex((i) => Math.min(i + 1, fileCount - 1));
    setCommentIndex(0);
    scrollTop();
  }
  function prevFile() {
    if (fileCount === 0) return;
    setSelectedFileIndex((i) => Math.max(i - 1, 0));
    setCommentIndex(0);
    scrollTop();
  }
  function selectFile(i: number) {
    setSelectedFileIndex(i);
    setCommentIndex(0);
    scrollTop();
  }

  function toggleViewedFile() {
    if (selectedFile) toggleViewed(keyValue, selectedFile.filename);
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
    } catch {
      // Error is surfaced in the modal via submitReview.error.
    }
  }

  useHotkeys("review", [
    { keys: ["n"], description: "Next file", group: "Files", run: nextFile },
    { keys: ["p"], description: "Previous file", group: "Files", run: prevFile },
    {
      keys: ["space", "pagedown"],
      description: "Page down",
      group: "Navigation",
      run: () => pageScroll(1),
    },
    {
      keys: ["pageup"],
      description: "Page up",
      group: "Navigation",
      run: () => pageScroll(-1),
    },
    {
      keys: "]c",
      description: "Next comment",
      group: "Comments",
      run: () => goToComment(1),
    },
    {
      keys: "[c",
      description: "Previous comment",
      group: "Comments",
      run: () => goToComment(-1),
    },
    {
      keys: "v",
      description: "Toggle file viewed",
      group: "Files",
      run: toggleViewedFile,
    },
    {
      keys: "s",
      description: "Submit review",
      group: "Review",
      run: openSubmit,
    },
    {
      keys: "o",
      description: "Open files on GitHub",
      group: "General",
      run: () => {
        if (pr) void openUrl(pr.url + "/files");
      },
    },
    {
      keys: "r",
      description: "Refresh",
      group: "General",
      run: () => {
        void refetch();
      },
    },
    {
      keys: "i",
      description: "Toggle info panel",
      group: "General",
      run: () => setRightOpen((o) => !o),
    },
    {
      keys: "esc",
      description: "Back to inbox",
      group: "Navigation",
      run: goInbox,
    },
  ]);

  // While loading (or before the cache seeds) there is no detail to render.
  if (!detail || !pr) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading pull request…" />
      </div>
    );
  }

  const stateTone = pr.merged
    ? "accent"
    : pr.state === "open"
      ? "success"
      : "muted";
  const stateLabel = pr.merged ? "merged" : pr.state;

  const fileComments = selectedFile
    ? detail.comments.filter((c) => c.path === selectedFile.filename)
    : [];
  const pendingForFile = selectedFile
    ? pending.filter((p) => p.path === selectedFile.filename)
    : [];

  return (
    <>
      <div className="flex h-full min-h-0">
        <aside className="w-[280px] shrink-0 border-r border-line">
          <FileSidebar
            files={files}
            selectedIndex={clampedIndex}
            onSelect={selectFile}
            prKeyValue={keyValue}
          />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-line bg-surface px-3 py-2">
            <button
              type="button"
              onClick={goInbox}
              className="shrink-0 rounded px-2 py-1 text-sm text-muted hover:bg-elevated hover:text-fg"
            >
              ← Back
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span
                className="truncate text-sm font-semibold text-fg"
                title={pr.title}
              >
                {pr.title}
              </span>
              <span className="shrink-0 text-sm text-muted">#{pr.number}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted">
              <span className="hidden sm:inline">{pr.repo}</span>
              {pr.draft ? (
                <Badge tone="warning">Draft</Badge>
              ) : (
                <Badge tone={stateTone}>{stateLabel}</Badge>
              )}
              <span className="font-mono">
                <span className="text-success">+{pr.additions}</span>{" "}
                <span className="text-danger">−{pr.deletions}</span>
              </span>
              <span>
                {viewed[keyValue]?.length ?? 0}/{fileCount} viewed
              </span>
              {pending.length > 0 && (
                <Badge tone="accent">{pending.length} pending</Badge>
              )}
              <button
                type="button"
                onClick={openSubmit}
                className="rounded px-2 py-1 font-medium text-accent hover:bg-elevated"
              >
                Review
              </button>
              <button
                type="button"
                onClick={() => void openUrl(pr.url)}
                className="rounded px-2 py-1 text-accent hover:bg-elevated"
              >
                Open ↗
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            <div ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
              {selectedFile ? (
                <DiffViewer
                  key={selectedFile.filename}
                  file={selectedFile}
                  comments={fileComments}
                  commitId={pr.headSha}
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
                <div className="p-6 text-sm text-muted">No files changed.</div>
              )}
            </div>

            {rightOpen && (
              <aside className="w-[360px] shrink-0 border-l border-line">
                <RightPanel
                  pr={pr}
                  onAddIssueComment={async (body) => {
                    await addIssueComment.mutateAsync({ body });
                  }}
                  issuePending={addIssueComment.isPending}
                />
              </aside>
            )}
          </div>
        </main>
      </div>

      <SubmitReviewModal
        open={submitOpen}
        pendingCount={pending.length}
        busy={submitReview.isPending}
        error={submitReview.error ? String(submitReview.error) : null}
        onClose={() => setSubmitOpen(false)}
        onSubmit={handleSubmitReview}
      />
    </>
  );
}
