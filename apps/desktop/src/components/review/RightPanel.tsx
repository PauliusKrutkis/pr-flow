import type { PullRequest } from "../../types";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Markdown } from "../Markdown";
import { AddCommentBox } from "./AddCommentBox";

interface RightPanelProps {
  pr: PullRequest;
  fileCount: number;
  open: boolean;
  onClose: () => void;
  onAddIssueComment: (body: string) => Promise<void>;
  issuePending: boolean;
}

/**
 * The Quiet info drawer — a slide-in panel (toggled with `i`) holding the PR
 * description, quick meta, and an issue-comment composer. It positions against
 * the review root (`.dir-quiet`, which is `position: relative`).
 */
export function RightPanel({
  pr,
  fileCount,
  open,
  onClose,
  onAddIssueComment,
  issuePending,
}: RightPanelProps) {
  const body = pr.body?.trim() ?? "";

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
            title="Close (i)"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="qf-drawer-body">
          <section className="qf-drawer-section">
            <div className="qf-drawer-pr">
              <span className="qf-pr-num">#{pr.number}</span>
              <span className="qf-drawer-pr-title">{pr.title}</span>
            </div>
            <div className="qf-drawer-meta">
              <span>
                {fileCount} file{fileCount === 1 ? "" : "s"}
              </span>
              <span className="qf-dot">·</span>
              <span className="qf-add">+{pr.additions}</span>
              <span className="qf-del">−{pr.deletions}</span>
              <span className="qf-dot">·</span>
              <span className="qf-muted" title={formatAbsolute(pr.updatedAt)}>
                updated {formatRelativeTime(pr.updatedAt)}
              </span>
            </div>
          </section>

          <section className="qf-drawer-section">
            <h3 className="qf-drawer-h">Description</h3>
            {body ? (
              <Markdown>{body}</Markdown>
            ) : (
              <p className="text-sm text-muted">No description.</p>
            )}
          </section>

          <section className="qf-drawer-section">
            <h3 className="qf-drawer-h">Add a comment</h3>
            <AddCommentBox
              onSubmit={onAddIssueComment}
              onCancel={() => {}}
              pending={issuePending}
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
