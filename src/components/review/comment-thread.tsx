import { CheckCircle2, MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
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
  // Resolved threads fold away by default; open ones start expanded. `collapsed`
  // resets to match whenever the resolved state flips — so resolving always
  // tidies a thread away and unresolving always brings it back open — while `z`
  // toggles it freely in between. Tracking the resolved we last saw lets us
  // react to flips made from outside this component (the keyboard `x`).
  const [collapsed, setCollapsed] = useState(resolved);
  const [wasResolved, setWasResolved] = useState(resolved);
  if (wasResolved !== resolved) {
    setWasResolved(resolved);
    setCollapsed(resolved);
    setReplying(false);
  }

  useEffect(() => {
    if (!replyRequest || replyRequest.rootId !== rootId) {
      return;
    }
    // An explicit reply request (r) is the one case that opens the composer.
    const raf = requestAnimationFrame(() => {
      setCollapsed(false);
      setReplying(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [replyRequest, rootId]);

  useEffect(() => {
    if (!toggleRequest || toggleRequest.rootId !== rootId) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      setCollapsed((v) => !v);
      setReplying(false);
    });
    return () => cancelAnimationFrame(raf);
  }, [toggleRequest, rootId]);

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
      // The fold follows the resolved state via the sync above — resolving
      // collapses, unresolving expands — so this only flips the verdict.
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
    return (
      <button
        aria-label="Expand thread"
        className={cn(
          "qf-thread qf-thread-collapsed qf-focusable",
          !resolved && "qf-thread-collapsed-open"
        )}
        data-comment-root={rootId}
        onClick={expand}
        title="Expand (z)"
        type="button"
        {...hoverProps}
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
        <span className="qf-thread-fold qf-thread-fold-hint">
          Expand
          <span className="qf-key-hint">
            <Kbd combo="z" />
          </span>
        </span>
      </button>
    );
  }

  return (
    <div className="qf-thread" data-comment-root={rootId} {...hoverProps}>
      <button
        aria-label="Collapse thread"
        className="qf-thread-fold qf-focusable"
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
