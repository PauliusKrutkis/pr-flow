import { CheckCircle2, MessageSquare } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
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

function applyCommand(
  request: { nonce: number; rootId: number } | null | undefined,
  rootId: number | undefined,
  lastNonce: RefObject<number>,
  apply: () => void
): void {
  if (!request || request.rootId !== rootId || request.nonce === lastNonce.current) {
    return;
  }
  lastNonce.current = request.nonce;
  apply();
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
  const [root] = comments;
  const rootId = root?.id;
  const threadId = root?.threadId ?? null;
  const resolved = root?.resolved ?? false;

  const [replying, setReplying] = useState(false);
  const [collapsed, setCollapsed] = useState(resolved);
  const [wasResolved, setWasResolved] = useState(resolved);
  const lastReplyNonce = useRef(0);
  const lastToggleNonce = useRef(0);

  if (wasResolved !== resolved) {
    setWasResolved(resolved);
    setCollapsed(resolved);
    setReplying(false);
  }

  applyCommand(replyRequest, rootId, lastReplyNonce, () => {
    setCollapsed(false);
    setReplying(true);
  });
  applyCommand(toggleRequest, rootId, lastToggleNonce, () => {
    setCollapsed((v) => !v);
    setReplying(false);
  });

  const submitReply = (body: string) => {
    if (rootId !== undefined) {
      onReply({ body, inReplyTo: rootId });
    }
    setReplying(false);
  };

  const expand = () => {
    setCollapsed(false);
  };

  const collapse = () => {
    setCollapsed(true);
    setReplying(false);
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
    }
  };

  if (comments.length === 0 || !root) {
    return null;
  }

  const hoverProps = {
    onMouseEnter: () => onHoverChange?.(true),
    onMouseLeave: () => onHoverChange?.(false),
  };

  if (collapsed) {
    const canResolve = threadId !== null && !!onResolve;
    return (
      <div
        className={cn(
          "qf-thread qf-thread-collapsed",
          !resolved && "qf-thread-collapsed-open"
        )}
        data-comment-root={rootId}
        {...hoverProps}
      >
        <button
          className="qf-thread-collapsed-lead qf-focusable"
          onClick={expand}
          title="Expand (z)"
          type="button"
        >
          {resolved ? (
            <CheckCircle2 aria-hidden size={13} />
          ) : (
            <MessageSquare aria-hidden size={13} />
          )}
          {!!resolved && <span className="qf-resolved-tag">Resolved</span>}
          <span className="qf-resolved-snip">
            {root.user} · {firstLine(root.body)}
          </span>
        </button>
        <div className="qf-thread-collapsed-actions">
          {resolved && canResolve && (
            <button
              className="qf-thread-fold qf-focusable"
              onClick={handleResolve}
              type="button"
            >
              Unresolve
              <span aria-hidden className="qf-key-hint">
                <Kbd combo="x" />
              </span>
            </button>
          )}
          <button
            aria-label="Expand thread"
            className="qf-thread-fold qf-focusable"
            onClick={expand}
            title="Expand (z)"
            type="button"
          >
            Expand
            <span aria-hidden className="qf-key-hint">
              <Kbd combo="z" />
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="qf-thread" data-comment-root={rootId} {...hoverProps}>
      <button
        aria-label="Collapse thread"
        className="qf-thread-fold qf-thread-fold-corner qf-focusable"
        onClick={collapse}
        title="Collapse (z)"
        type="button"
      >
        Collapse
        <span aria-hidden className="qf-key-hint">
          <Kbd combo="z" />
        </span>
      </button>
      {!!resolved && (
        <div className="qf-thread-resolved-bar">
          <CheckCircle2 aria-hidden size={13} />
          <span className="qf-resolved-tag">Resolved</span>
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
