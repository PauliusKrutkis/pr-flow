import {
  CheckCircle2,
  ExternalLink,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn.ts";
import { formatAbsolute, formatRelativeTime } from "../../lib/time.ts";
import { useAppStore } from "../../store/app-store.ts";
import type {
  CiStatus,
  IssueComment,
  PullRequest,
  ReviewComment,
  ReviewSummary,
} from "../../types.ts";
import { Markdown } from "../markdown.tsx";
import { Avatar } from "../ui/avatar.tsx";
import { TicketTitle } from "../ui/ticket-title.tsx";
import { AddCommentBox } from "./add-comment-box.tsx";
import { CiPill } from "./ci-pill.tsx";

interface RightPanelProps {
  ci: CiStatus | undefined;
  conversation: IssueComment[];
  fileCount: number;
  inlineComments: ReviewComment[];
  onAddIssueComment: (body: string) => Promise<void>;
  onClose: () => void;
  onJumpToThread: (path: string, rootId: number) => void;
  onOpenGitHub: () => void;
  onToggleWide: () => void;
  open: boolean;
  pr: PullRequest;
  reviews: ReviewSummary[];
  wide: boolean;
}

/** One row of the merged conversation: a comment or a review verdict. */
type TimelineEntry =
  | { kind: "comment"; at: string; comment: IssueComment }
  | { kind: "review"; at: string; review: ReviewSummary };

const REVIEW_STATES: Record<string, { label: string; cls: string }> = {
  APPROVED: { cls: "q-pill-approved", label: "Approved" },
  CHANGES_REQUESTED: { cls: "q-pill-changes", label: "Changes requested" },
  COMMENTED: { cls: "q-pill-commented", label: "Commented" },
  DISMISSED: { cls: "q-pill-muted", label: "Dismissed" },
};

/**
 * The info drawer (toggled with `i`, Esc closes): the PR description, the
 * complete conversation (PR-level comments merged with review verdicts), an
 * index of inline code threads, and a composer. Comments post optimistically —
 * the composer never blocks.
 */
export function RightPanel({
  ci,
  pr,
  fileCount,
  conversation,
  reviews,
  inlineComments,
  open,
  wide,
  onClose,
  onToggleWide,
  onAddIssueComment,
  onJumpToThread,
  onOpenGitHub,
}: RightPanelProps) {
  const body = pr.body.trim();
  const trackerBase = useAppStore((s) =>
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined
  );

  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) {
      return;
    }
    if (open) {
      el.focus({ preventScroll: true });
    } else if (el.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
      document
        .querySelector<HTMLElement>(".qf-scrollhost")
        ?.focus({ preventScroll: true });
    }
  }, [open]);

  const timeline: TimelineEntry[] = [
    ...conversation.map((c) => ({
      at: c.createdAt,
      comment: c,
      kind: "comment" as const,
    })),
    ...reviews.map((r) => ({
      at: r.submittedAt,
      kind: "review" as const,
      review: r,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const replyCounts = new Map<number, number>();
  for (const c of inlineComments) {
    if (c.inReplyToId !== null) {
      replyCounts.set(c.inReplyToId, (replyCounts.get(c.inReplyToId) ?? 0) + 1);
    }
  }
  const threads = inlineComments
    .filter((c) => c.inReplyToId === null)
    .map((root) => ({ replyCount: replyCounts.get(root.id) ?? 0, root }));

  const handleJumpToThread = (e: React.MouseEvent<HTMLButtonElement>) => {
    const path = e.currentTarget.dataset.threadPath;
    const rootId = Number(e.currentTarget.dataset.threadRoot);
    if (path && Number.isFinite(rootId)) {
      onJumpToThread(path, rootId);
    }
  };

  const handleAddIssueComment = (text: string) => {
    onAddIssueComment(text);
  };

  return (
    <>
      <button
        aria-label="Close panel"
        className={cn("qf-drawer-scrim", open && "qf-drawer-open")}
        onClick={onClose}
        type="button"
      />
      <aside
        aria-hidden={!open}
        className={cn(
          "qf-drawer",
          open && "qf-drawer-open",
          wide && "qf-drawer-wide"
        )}
        inert={!open}
        ref={panelRef}
        tabIndex={-1}
      >
        <div className="qf-drawer-head">
          <span className="qf-drawer-title">Pull request</span>
          <div className="qf-drawer-head-actions">
            <button
              aria-label={wide ? "Narrow panel" : "Widen panel"}
              aria-pressed={wide}
              className="qf-drawer-wide-btn qf-focusable"
              onClick={onToggleWide}
              title={`${wide ? "Narrow" : "Widen"} panel (⇧I)`}
              type="button"
            >
              {wide ? (
                <PanelRightClose aria-hidden size={15} />
              ) : (
                <PanelRightOpen aria-hidden size={15} />
              )}
            </button>
            <button
              aria-label="Close"
              className="qf-drawer-close qf-focusable"
              onClick={onClose}
              title="Close (Esc)"
              type="button"
            >
              Esc
            </button>
          </div>
        </div>

        <div className="qf-drawer-body">
          <section className="qf-drawer-section">
            <div className="qf-drawer-pr">
              <span className="qf-pr-num">#{pr.number}</span>
              <span className="qf-drawer-pr-title">
                <TicketTitle title={pr.title} trackerBase={trackerBase} />
              </span>
            </div>
            <div className="qf-drawer-meta">
              <Avatar name={pr.author} size={15} url={pr.authorAvatarUrl} />
              <span>{pr.author}</span>
              <span className="qf-dot">·</span>
              <span>
                {fileCount} file{fileCount === 1 ? "" : "s"}
              </span>
              <span className="qf-dot">·</span>
              <span className="qf-add">+{pr.additions}</span>
              <span className="qf-del">−{pr.deletions}</span>
              <span className="qf-dot">·</span>
              <span className="qf-muted" title={formatAbsolute(pr.updatedAt)}>
                {formatRelativeTime(pr.updatedAt)}
              </span>
            </div>
            <div className="qf-drawer-links">
              <CiPill ci={ci} />
              <button
                className="qf-drawer-link qf-focusable"
                onClick={onOpenGitHub}
                type="button"
              >
                Open on GitHub
                <ExternalLink aria-hidden size={13} />
              </button>
            </div>
          </section>

          <section className="qf-drawer-section">
            <h3 className="qf-drawer-h">Description</h3>
            {body ? (
              <Markdown>{body}</Markdown>
            ) : (
              <p className="text-faint text-sm">No description.</p>
            )}
          </section>

          <section className="qf-drawer-section">
            <h3 className="qf-drawer-h">
              Conversation
              {timeline.length > 0 && (
                <span className="qf-drawer-count">{timeline.length}</span>
              )}
            </h3>
            {timeline.length === 0 ? (
              <p className="text-faint text-sm">
                No discussion yet — start one below.
              </p>
            ) : (
              <div className="qf-convo">
                {timeline.map((entry) =>
                  entry.kind === "comment" ? (
                    <ConversationItem
                      at={entry.comment.createdAt}
                      avatarUrl={entry.comment.userAvatarUrl}
                      body={entry.comment.body}
                      key={`c-${entry.comment.id}`}
                      user={entry.comment.user}
                    />
                  ) : (
                    <ConversationItem
                      at={entry.review.submittedAt}
                      avatarUrl={entry.review.userAvatarUrl}
                      body={entry.review.body}
                      key={`r-${entry.review.id}`}
                      state={entry.review.state}
                      user={entry.review.user}
                    />
                  )
                )}
              </div>
            )}
          </section>

          {threads.length > 0 && (
            <section className="qf-drawer-section">
              <h3 className="qf-drawer-h">
                Code discussion
                <span className="qf-drawer-count">{threads.length}</span>
              </h3>
              <div className="qf-drawer-threads">
                {threads.map(({ root, replyCount }) => (
                  <button
                    className="qf-thread-row qf-focusable"
                    data-thread-path={root.path}
                    data-thread-root={root.id}
                    key={root.id}
                    onClick={handleJumpToThread}
                    title="Jump to this thread in the diff"
                    type="button"
                  >
                    <span className="qf-thread-loc">
                      {!!root.resolved && (
                        <CheckCircle2
                          aria-label="Resolved"
                          className="qf-thread-check"
                          size={12}
                        />
                      )}
                      <span className="qf-thread-path">{root.path}</span>
                      <span className="qf-thread-line">
                        {root.line === null ? " · outdated" : `:${root.line}`}
                      </span>
                      {replyCount > 0 && (
                        <span className="qf-thread-replies">
                          {replyCount} {replyCount === 1 ? "reply" : "replies"}
                        </span>
                      )}
                    </span>
                    <span className="qf-thread-snip">
                      {firstLine(root.body)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <section className="qf-drawer-section">
            <AddCommentBox
              autoFocus={false}
              onCancel={onClose}
              onSubmit={handleAddIssueComment}
              pending={false}
              placeholder="Comment on this pull request…"
              submitLabel="Comment"
            />
          </section>
        </div>
      </aside>
    </>
  );
}

/** A single conversation row — a comment, or a review verdict with its chip. */
function ConversationItem({
  user,
  avatarUrl,
  at,
  body,
  state,
}: {
  user: string;
  avatarUrl: string;
  at: string;
  body: string;
  state?: string;
}) {
  const chip = state ? (REVIEW_STATES[state] ?? REVIEW_STATES.COMMENTED) : null;
  const trimmed = body.trim();
  return (
    <div className="qf-convo-item">
      <Avatar name={user} size={20} url={avatarUrl} />
      <div className="qf-convo-main">
        <div className="qf-convo-head">
          <span className="qf-comment-author">{user}</span>
          {chip === null ? null : (
            <span className={cn("q-pill", chip.cls)}>{chip.label}</span>
          )}
          <span className="qf-comment-time" title={formatAbsolute(at)}>
            {formatRelativeTime(at)}
          </span>
        </div>
        {!!trimmed && (
          <div className="qf-comment-body">
            <Markdown>{trimmed}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}

function firstLine(body: string): string {
  return body.trim().split("\n")[0] ?? "";
}
