import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatAbsolute, formatRelativeTime } from "../../lib/time.ts";
import type { ReviewComment } from "../../types.ts";
import { Markdown } from "../Markdown.tsx";
import { Avatar } from "../ui/Avatar.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { AddCommentBox } from "./AddCommentBox.tsx";

export interface ReplyRequest {
  nonce: number;
  rootId: number;
}

interface CommentThreadProps {
  comments: ReviewComment[];
  onHoverChange?: (hovering: boolean) => void;
  onReply: (a: { inReplyTo: number; body: string }) => Promise<void>;
  onResolve?: (a: { threadId: string; resolved: boolean }) => void;
  replyPending: boolean;
  replyRequest?: ReplyRequest | null;
}

export function CommentThread({
  comments,
  onReply,
  replyPending,
  onResolve,
  onHoverChange,
  replyRequest,
}: CommentThreadProps) {
  const [replying, setReplying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const root = comments[0];
  const rootId = root?.id;

  useEffect(() => {
    if (!replyRequest || replyRequest.rootId !== rootId) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      setExpanded(true);
      setReplying(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [replyRequest, rootId]);

  if (comments.length === 0) {
    return null;
  }

  const threadId = root.threadId;
  const resolved = root.resolved;

  const hoverProps = {
    onMouseEnter: () => onHoverChange?.(true),
    onMouseLeave: () => onHoverChange?.(false),
  };

  function submitReply(body: string) {
    void onReply({ body, inReplyTo: rootId });
    setReplying(false);
  }

  if (resolved && !expanded) {
    return (
      <button
        className="qf-thread qf-thread-collapsed qf-focusable"
        data-comment-root={rootId}
        onClick={() => setExpanded(true)}
        title="Resolved — click to expand"
        type="button"
        {...hoverProps}
      >
        <CheckCircle2 aria-hidden size={13} />
        <span className="qf-resolved-tag">Resolved</span>
        <span className="qf-resolved-snip">
          {root.user} · {firstLine(root.body)}
        </span>
      </button>
    );
  }

  return (
    <div className="qf-thread" data-comment-root={rootId} {...hoverProps}>
      {resolved && (
        <div className="qf-thread-resolved-bar">
          <CheckCircle2 aria-hidden size={13} />
          <span className="qf-resolved-tag">Resolved</span>
          <button
            className="qf-resolved-collapse qf-focusable"
            onClick={() => setExpanded(false)}
            type="button"
          >
            Collapse
          </button>
        </div>
      )}
      {comments.map((c, i) => (
        <div
          className={i > 0 ? "qf-comment qf-comment-reply" : "qf-comment"}
          key={c.id}
        >
          <div className="qf-comment-head">
            <Avatar name={c.user} size={20} url={c.userAvatarUrl} />
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
      ))}
      {replying ? (
        <div className="qf-comment qf-comment-reply">
          <AddCommentBox
            autoFocus
            onCancel={() => setReplying(false)}
            onSubmit={submitReply}
            pending={replyPending}
            placeholder="Reply…"
            submitLabel="Reply"
          />
        </div>
      ) : (
        <div className="qf-thread-actions">
          <button
            className="qf-reply-btn qf-focusable"
            onClick={() => setReplying(true)}
            type="button"
          >
            Reply
            <span aria-hidden className="qf-key-hint">
              <Kbd combo="r" />
            </span>
          </button>
          {threadId != null && onResolve && (
            <button
              className="qf-reply-btn qf-resolve-btn qf-focusable"
              onClick={() => {
                onResolve({ resolved: !resolved, threadId });
                setExpanded(resolved);
              }}
              type="button"
            >
              {resolved ? "Unresolve" : "Resolve"}
              <span aria-hidden className="qf-key-hint">
                <Kbd combo="x" />
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function firstLine(body: string): string {
  return body.trim().split("\n")[0] ?? "";
}
