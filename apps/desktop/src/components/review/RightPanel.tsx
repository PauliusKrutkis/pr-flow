import { useEffect, useRef } from "react";
import { CheckCircle2 } from "lucide-react";
import type {
  IssueComment,
  PullRequest,
  ReviewComment,
  ReviewSummary,
} from "../../types";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Markdown } from "../Markdown";
import { Avatar } from "../ui/Avatar";
import { TicketTitle } from "../ui/TicketTitle";
import { useAppStore } from "../../store/appStore";
import { AddCommentBox } from "./AddCommentBox";

interface RightPanelProps {
  pr: PullRequest;
  fileCount: number;
  conversation: IssueComment[];
  /** Submitted review verdicts/summaries (approvals, change requests). */
  reviews: ReviewSummary[];
  /** All inline review comments — grouped into threads for "Code discussion". */
  inlineComments: ReviewComment[];
  open: boolean;
  onClose: () => void;
  onAddIssueComment: (body: string) => Promise<void>;
  /** Jump the diff to an inline thread (the drawer closes). */
  onJumpToThread: (path: string, rootId: number) => void;
}

/** One row of the merged conversation: a comment or a review verdict. */
type TimelineEntry =
  | { kind: "comment"; at: string; comment: IssueComment }
  | { kind: "review"; at: string; review: ReviewSummary };

const REVIEW_STATES: Record<string, { label: string; cls: string }> = {
  APPROVED: { label: "Approved", cls: "q-pill-approved" },
  CHANGES_REQUESTED: { label: "Changes requested", cls: "q-pill-changes" },
  COMMENTED: { label: "Commented", cls: "q-pill-commented" },
  DISMISSED: { label: "Dismissed", cls: "q-pill-muted" },
};

/**
 * The info drawer (toggled with `i`, Esc closes): the PR description, the
 * complete conversation (PR-level comments merged with review verdicts), an
 * index of inline code threads, and a composer. Comments post optimistically —
 * the composer never blocks.
 */
export function RightPanel({
  pr,
  fileCount,
  conversation,
  reviews,
  inlineComments,
  open,
  onClose,
  onAddIssueComment,
  onJumpToThread,
}: RightPanelProps) {
  const body = pr.body?.trim() ?? "";
  const trackerBase = useAppStore((s) =>
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined,
  );

  const panelRef = useRef<HTMLElement>(null);

  // Focus follows the drawer. Opening moves focus into the panel container so
  // Esc lands on a predictable, non-editable target; closing releases any
  // focus stranded in the (now off-canvas) subtree — a focused-but-hidden
  // textarea swallows every single-key shortcut and the app feels dead until
  // the user clicks. The `inert` attribute below guards the same hole for
  // mouse/tab re-entry while closed.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (open) {
      el.focus({ preventScroll: true });
    } else if (el.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
      document
        .querySelector<HTMLElement>(".qf-scrollhost")
        ?.focus({ preventScroll: true });
    }
  }, [open]);

  // PR-level comments and review verdicts interleave into one timeline.
  // ISO-8601 timestamps compare lexicographically, and optimistic comments are
  // stamped "now", so they land at the tail the instant they're typed.
  // (Plain computations, not useMemo — the React Compiler caches them.)
  const timeline: TimelineEntry[] = [
    ...conversation.map((c) => ({
      kind: "comment" as const,
      at: c.createdAt,
      comment: c,
    })),
    ...reviews.map((r) => ({
      kind: "review" as const,
      at: r.submittedAt,
      review: r,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  // Inline comments grouped into threads: roots carry no inReplyToId, replies
  // point at their root. The drawer only indexes them — the full thread lives
  // in the diff, which is where the row jumps.
  const replyCounts = new Map<number, number>();
  for (const c of inlineComments) {
    if (c.inReplyToId != null) {
      replyCounts.set(c.inReplyToId, (replyCounts.get(c.inReplyToId) ?? 0) + 1);
    }
  }
  const threads = inlineComments
    .filter((c) => c.inReplyToId == null)
    .map((root) => ({ root, replyCount: replyCounts.get(root.id) ?? 0 }));

  return (
    <>
      <div
        className={"qf-drawer-scrim" + (open ? " qf-drawer-open" : "")}
        onClick={onClose}
        role="presentation"
      />
      <aside
        ref={panelRef}
        tabIndex={-1}
        className={"qf-drawer" + (open ? " qf-drawer-open" : "")}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="qf-drawer-head">
          <span className="qf-drawer-title">Pull request</span>
          <button
            type="button"
            className="qf-drawer-close qf-focusable"
            onClick={onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            Esc
          </button>
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
              <Avatar url={pr.authorAvatarUrl} name={pr.author} size={15} />
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
          </section>

          <section className="qf-drawer-section">
            <h3 className="qf-drawer-h">Description</h3>
            {body ? (
              <Markdown>{body}</Markdown>
            ) : (
              <p className="text-sm text-faint">No description.</p>
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
              <p className="text-sm text-faint">
                No discussion yet — start one below.
              </p>
            ) : (
              <div className="qf-convo">
                {timeline.map((entry) =>
                  entry.kind === "comment" ? (
                    <ConversationItem
                      key={`c-${entry.comment.id}`}
                      user={entry.comment.user}
                      avatarUrl={entry.comment.userAvatarUrl}
                      at={entry.comment.createdAt}
                      body={entry.comment.body}
                    />
                  ) : (
                    <ConversationItem
                      key={`r-${entry.review.id}`}
                      user={entry.review.user}
                      avatarUrl={entry.review.userAvatarUrl}
                      at={entry.review.submittedAt}
                      body={entry.review.body}
                      state={entry.review.state}
                    />
                  ),
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
                    key={root.id}
                    type="button"
                    className="qf-thread-row qf-focusable"
                    onClick={() => onJumpToThread(root.path, root.id)}
                    title="Jump to this thread in the diff"
                  >
                    <span className="qf-thread-loc">
                      {root.resolved && (
                        <CheckCircle2
                          size={12}
                          className="qf-thread-check"
                          aria-label="Resolved"
                        />
                      )}
                      <span className="qf-thread-path">{root.path}</span>
                      <span className="qf-thread-line">
                        {root.line != null ? `:${root.line}` : " · outdated"}
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
              onSubmit={(text) => {
                // Optimistic — appears in the conversation instantly.
                void onAddIssueComment(text);
              }}
              onCancel={onClose}
              pending={false}
              placeholder="Comment on this pull request…"
              submitLabel="Comment"
              autoFocus={false}
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
  /** Present for review entries — rendered as a state chip. */
  state?: string;
}) {
  const chip = state ? (REVIEW_STATES[state] ?? REVIEW_STATES.COMMENTED) : null;
  const trimmed = body.trim();
  return (
    <div className="qf-convo-item">
      <Avatar url={avatarUrl} name={user} size={20} />
      <div className="qf-convo-main">
        <div className="qf-convo-head">
          <span className="qf-comment-author">{user}</span>
          {chip && <span className={"q-pill " + chip.cls}>{chip.label}</span>}
          <span className="qf-comment-time" title={formatAbsolute(at)}>
            {formatRelativeTime(at)}
          </span>
        </div>
        {trimmed && (
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
