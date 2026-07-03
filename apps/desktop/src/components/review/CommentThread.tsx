import { useState } from "react";
import type { ReviewComment } from "../../types";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Markdown } from "../Markdown";
import { Avatar } from "../ui/Avatar";
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

  function submitReply(body: string) {
    // Optimistic — the reply is inserted into the cache by the mutation's
    // onMutate; close the composer immediately.
    void onReply({ inReplyTo: rootId, body });
    setReplying(false);
  }

  return (
    // data-comment-root lets the info drawer's "Code discussion" index find
    // and flash this thread when jumping to it.
    <div className="qf-thread" data-comment-root={rootId}>
      {comments.map((c, i) => (
        <div key={c.id} className={i > 0 ? "qf-comment qf-comment-reply" : "qf-comment"}>
          <div className="qf-comment-head">
            <Avatar url={c.userAvatarUrl} name={c.user} size={20} />
            <span className="qf-comment-author">{c.user}</span>
            <span className="qf-comment-time" title={formatAbsolute(c.createdAt)}>
              {formatRelativeTime(c.createdAt)}
            </span>
          </div>
          <div className="qf-comment-body">
            <Markdown>{c.body}</Markdown>
          </div>
        </div>
      ))}
      {replying ? (
        <div className="qf-comment qf-comment-reply">
          <AddCommentBox
            onSubmit={submitReply}
            onCancel={() => setReplying(false)}
            pending={replyPending}
            placeholder="Reply…"
            submitLabel="Reply"
            autoFocus
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setReplying(true)}
          className="qf-reply-btn qf-focusable"
        >
          Reply
        </button>
      )}
    </div>
  );
}
