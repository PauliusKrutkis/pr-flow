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
  // A resolved thread collapses by default (done — out of the way); an open one
  // stays expanded but can be collapsed to a one-line row. Two independent flags
  // so resolving keeps its own default without clobbering a manual collapse of an
  // open thread; `collapsed` is the single value the render reads.
  const [expanded, setExpanded] = useState(false);
  const [openCollapsed, setOpenCollapsed] = useState(false);
  const collapsed = resolved ? !expanded : openCollapsed;

  useEffect(() => {
    if (!replyRequest || replyRequest.rootId !== rootId) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (resolved) {
        setExpanded(true);
      } else {
        setOpenCollapsed(false);
      }
      setReplying(true);
    });
    return () => cancelAnimationFrame(raf);
  }, [replyRequest, rootId, resolved]);

  useEffect(() => {
    if (!toggleRequest || toggleRequest.rootId !== rootId) {
      return;
    }
    const raf = requestAnimationFrame(() => {
      if (resolved) {
        setExpanded((v) => !v);
      } else {
        setOpenCollapsed((v) => !v);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [toggleRequest, rootId, resolved]);

  const submitReply = (body: string) => {
    if (rootId !== undefined) {
      onReply({ body, inReplyTo: rootId });
    }
    setReplying(false);
  };

  const handleExpand = () => {
    if (resolved) {
      setExpanded(true);
    } else {
      setOpenCollapsed(false);
    }
  };

  const handleCollapse = () => {
    if (resolved) {
      setExpanded(false);
    } else {
      setOpenCollapsed(true);
    }
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
      // Becoming resolved → collapse it; becoming open → show it expanded.
      if (resolved) {
        setOpenCollapsed(false);
      } else {
        setExpanded(false);
      }
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
        className={cn(
          "qf-thread qf-thread-collapsed qf-focusable",
          !resolved && "qf-thread-collapsed-open"
        )}
        data-comment-root={rootId}
        onClick={handleExpand}
        title={
          resolved
            ? "Resolved — click or press z to expand"
            : "Collapsed — click or press z to expand"
        }
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
        <span aria-hidden className="qf-key-hint qf-collapsed-key">
          <Kbd combo="z" />
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
            <span aria-hidden className="qf-key-hint">
              <Kbd combo="z" />
            </span>
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
          {!resolved && (
            <button
              className="qf-reply-btn qf-collapse-btn qf-focusable"
              onClick={handleCollapse}
              type="button"
            >
              Collapse
              <span aria-hidden className="qf-key-hint">
                <Kbd combo="z" />
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
