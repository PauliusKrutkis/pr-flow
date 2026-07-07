import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { ReviewComment } from "../../types";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Markdown } from "../Markdown";
import { Avatar } from "../ui/Avatar";
import { Kbd } from "../ui/Kbd";
import { AddCommentBox } from "./AddCommentBox";

export interface ReplyRequest {
  rootId: number;
  nonce: number;
}

interface CommentThreadProps {
  comments: ReviewComment[];
  onReply: (a: { inReplyTo: number; body: string }) => Promise<void>;
  replyPending: boolean;
  onResolve?: (a: { threadId: string; resolved: boolean }) => void;
  onHoverChange?: (hovering: boolean) => void;
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
    if (!replyRequest || replyRequest.rootId !== rootId) return;
    const raf = requestAnimationFrame(() => {
      setExpanded(true);
      setReplying(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [replyRequest, rootId]);

  if (comments.length === 0) return null;

  const threadId = root.threadId;
  const resolved = root.resolved;

  const hoverProps = {
    onMouseEnter: () => onHoverChange?.(true),
    onMouseLeave: () => onHoverChange?.(false),
  };

  function submitReply(body: string) {
    void onReply({ inReplyTo: rootId, body });
    setReplying(false);
  }

  if (resolved && !expanded) {
    return (
      <button
        type="button"
        className="qf-thread qf-thread-collapsed qf-focusable"
        data-comment-root={rootId}
        onClick={() => setExpanded(true)}
        title="Resolved — click to expand"
        {...hoverProps}
      >
        <CheckCircle2 size={13} aria-hidden />
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
          <CheckCircle2 size={13} aria-hidden />
          <span className="qf-resolved-tag">Resolved</span>
          <button
            type="button"
            className="qf-resolved-collapse qf-focusable"
            onClick={() => setExpanded(false)}
          >
            Collapse
          </button>
        </div>
      )}
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
        <div className="qf-thread-actions">
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="qf-reply-btn qf-focusable"
          >
            Reply
            <span aria-hidden className="qf-key-hint">
              <Kbd combo="r" />
            </span>
          </button>
          {threadId != null && onResolve && (
            <button
              type="button"
              className="qf-reply-btn qf-resolve-btn qf-focusable"
              onClick={() => {
                onResolve({ threadId, resolved: !resolved });
                setExpanded(resolved);
              }}
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
