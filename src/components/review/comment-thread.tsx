import { CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatAbsolute, formatRelativeTime } from "../../lib/time.ts";
import type { ReviewComment } from "../../types.ts";
import { Markdown } from "../markdown.tsx";
import { Avatar } from "../ui/avatar.tsx";
import { Kbd } from "../ui/kbd.tsx";
import { AddCommentBox } from "./add-comment-box.tsx";

export interface ReplyRequest {
  nonce: number;
  rootId: number;
}

export interface ToggleRequest {
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
  toggleRequest?: ToggleRequest | null;
}

export function CommentThread({
  comments,
  onReply,
  replyPending,
  onResolve,
  onHoverChange,
  replyRequest,
  toggleRequest,
}: CommentThreadProps) {
  const [replying, setReplying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const [root] = comments;
  const rootId = root?.id;
  const threadId = root?.threadId ?? null;
  const resolved = root?.resolved ?? false;

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

  useEffect(() => {
    if (!toggleRequest || toggleRequest.rootId !== rootId) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      setExpanded((v) => !v);
    });
    return () => cancelAnimationFrame(raf);
  }, [toggleRequest, rootId]);

  const submitReply = (body: string) => {
    if (rootId !== undefined) {
      onReply({ body, inReplyTo: rootId });
    }
    setReplying(false);
  };

  const handleExpand = () => {
    setExpanded(true);
  };

  const handleCollapse = () => {
    setExpanded(false);
  };

  const handleCancelReply = () => {
    setReplying(false);
  };

  const handleStartReply = () => {
    setReplying(true);
  };

  const handleResolve = () => {
    if (threadId !== null && onResolve) {
      onResolve({ resolved: !resolved, threadId });
      setExpanded(resolved);
    }
  };

  if (comments.length === 0 || !root) {
    return null;
  }

  const hoverProps = {
    onMouseEnter: () => onHoverChange?.(true),
    onMouseLeave: () => onHoverChange?.(false),
  };

  if (resolved && !expanded) {
    return (
      <button
        className="qf-thread qf-thread-collapsed qf-focusable"
        data-comment-root={rootId}
        onClick={handleExpand}
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
      {!!resolved && (
        <div className="qf-thread-resolved-bar">
          <CheckCircle2 aria-hidden size={13} />
          <span className="qf-resolved-tag">Resolved</span>
          <button
            className="qf-resolved-collapse qf-focusable"
            onClick={handleCollapse}
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
            onCancel={handleCancelReply}
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
            onClick={handleStartReply}
            type="button"
          >
            Reply
            <span aria-hidden className="qf-key-hint">
              <Kbd combo="r" />
            </span>
          </button>
          {threadId !== null && onResolve && (
            <button
              className="qf-reply-btn qf-resolve-btn qf-focusable"
              onClick={handleResolve}
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
