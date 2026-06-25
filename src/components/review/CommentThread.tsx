import { useState } from "react";
import type { ReviewComment } from "../../types";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Markdown } from "../Markdown";
import { AddCommentBox } from "./AddCommentBox";

interface CommentThreadProps {
  /** One thread, root first then replies. */
  comments: ReviewComment[];
  onReply: (a: { inReplyTo: number; body: string }) => Promise<void>;
  replyPending: boolean;
}

export function CommentThread({
  comments,
  onReply,
  replyPending,
}: CommentThreadProps) {
  const [replying, setReplying] = useState(false);

  if (comments.length === 0) return null;
  const rootId = comments[0].id;

  async function submitReply(body: string) {
    await onReply({ inReplyTo: rootId, body });
    setReplying(false);
  }

  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="divide-y divide-line">
        {comments.map((c) => (
          <div key={c.id} className="p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <img
                src={c.userAvatarUrl}
                alt=""
                className="h-5 w-5 rounded-full"
              />
              <span className="text-sm font-medium text-fg">{c.user}</span>
              <span
                className="text-xs text-muted"
                title={formatAbsolute(c.createdAt)}
              >
                {formatRelativeTime(c.createdAt)}
              </span>
            </div>
            <Markdown className="text-sm">{c.body}</Markdown>
          </div>
        ))}
      </div>
      <div className="border-t border-line p-2">
        {replying ? (
          <AddCommentBox
            onSubmit={submitReply}
            onCancel={() => setReplying(false)}
            pending={replyPending}
            placeholder="Reply…"
            autoFocus
          />
        ) : (
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="rounded px-2 py-1 text-xs text-muted hover:bg-elevated hover:text-fg"
          >
            Reply
          </button>
        )}
      </div>
    </div>
  );
}
