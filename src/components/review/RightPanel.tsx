import type { PullRequest } from "../../types";
import { Markdown } from "../Markdown";
import { AddCommentBox } from "./AddCommentBox";

interface RightPanelProps {
  pr: PullRequest;
  onAddIssueComment: (body: string) => Promise<void>;
  issuePending: boolean;
}

export function RightPanel({
  pr,
  onAddIssueComment,
  issuePending,
}: RightPanelProps) {
  const body = pr.body?.trim() ?? "";

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface">
      <div className="p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Description
        </h2>
        {body ? (
          <Markdown className="text-sm">{body}</Markdown>
        ) : (
          <p className="text-sm text-muted">No description.</p>
        )}
      </div>

      <div className="border-t border-line p-4">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Add a comment
        </h2>
        <AddCommentBox
          onSubmit={onAddIssueComment}
          onCancel={() => {}}
          pending={issuePending}
          placeholder="Comment on this pull request…"
          autoFocus={false}
        />
      </div>
    </div>
  );
}
