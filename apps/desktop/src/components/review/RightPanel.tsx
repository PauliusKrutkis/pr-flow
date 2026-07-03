import type { IssueComment, PullRequest } from "../../types";
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
  open: boolean;
  onClose: () => void;
  onAddIssueComment: (body: string) => Promise<void>;
}

/**
 * The info drawer (toggled with `i`, Esc closes): the PR description, the
 * PR-level conversation, and a composer. Comments post optimistically — the
 * composer never blocks.
 */
export function RightPanel({
  pr,
  fileCount,
  conversation,
  open,
  onClose,
  onAddIssueComment,
}: RightPanelProps) {
  const body = pr.body?.trim() ?? "";
  const trackerBase = useAppStore((s) =>
    s.activeAccountId ? s.issueTrackers[s.activeAccountId] : undefined,
  );

  return (
    <>
      <div
        className={"qf-drawer-scrim" + (open ? " qf-drawer-open" : "")}
        onClick={onClose}
        role="presentation"
      />
      <aside
        className={"qf-drawer" + (open ? " qf-drawer-open" : "")}
        aria-hidden={!open}
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
              {conversation.length > 0 && (
                <span className="qf-drawer-count">{conversation.length}</span>
              )}
            </h3>
            {conversation.length === 0 ? (
              <p className="text-sm text-faint">
                No discussion yet — start one below.
              </p>
            ) : (
              <div className="qf-convo">
                {conversation.map((c) => (
                  <div key={c.id} className="qf-convo-item">
                    <Avatar url={c.userAvatarUrl} name={c.user} size={20} />
                    <div className="qf-convo-main">
                      <div className="qf-convo-head">
                        <span className="qf-comment-author">{c.user}</span>
                        <span
                          className="qf-comment-time"
                          title={formatAbsolute(c.createdAt)}
                        >
                          {formatRelativeTime(c.createdAt)}
                        </span>
                      </div>
                      <div className="qf-comment-body">
                        <Markdown>{c.body}</Markdown>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

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
