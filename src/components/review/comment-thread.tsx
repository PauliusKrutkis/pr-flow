import { CheckCircle2, MessageSquare } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { formatAbsolute, formatRelativeTime } from "../../lib/time.ts";
import { useAppStore } from "../../store/app-store.ts";
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

export interface EditRequest {
  nonce: number;
  rootId: number;
}

interface CommentThreadProps {
  comments: ReviewComment[];
  editRequest?: EditRequest | null;
  onEdit?: (a: { commentId: number; body: string }) => Promise<void>;
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
  lastNonce: number,
  setLastNonce: (nonce: number) => void,
  apply: () => void
): void {
  if (!request || request.rootId !== rootId || request.nonce === lastNonce) {
    return;
  }
  setLastNonce(request.nonce);
  apply();
}

export function CommentThread({
  comments,
  onReply,
  replyPending,
  onResolve,
  onEdit,
  onHoverChange,
  replyRequest,
  toggleRequest,
  editRequest,
}: CommentThreadProps) {
  const [root] = comments;
  const rootId = root?.id;
  const threadId = root?.threadId ?? null;
  const resolved = root?.resolved ?? false;
  const ownLogin = useAppStore(
    (s) => s.accounts.find((a) => a.id === s.activeAccountId)?.login
  );
  const ownComments = comments.filter((c) => c.user === ownLogin);
  const lastOwnId = ownComments.at(-1)?.id;

  const [replying, setReplying] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState(resolved);
  const [wasResolved, setWasResolved] = useState(resolved);
  const [lastReplyNonce, setLastReplyNonce] = useState(0);
  const [lastToggleNonce, setLastToggleNonce] = useState(0);
  const [lastEditNonce, setLastEditNonce] = useState(0);

  if (wasResolved !== resolved) {
    setWasResolved(resolved);
    setCollapsed(resolved);
    setReplying(false);
    setEditingId(null);
  }

  applyCommand(replyRequest, rootId, lastReplyNonce, setLastReplyNonce, () => {
    setCollapsed(false);
    setReplying(true);
    setEditingId(null);
  });
  applyCommand(
    toggleRequest,
    rootId,
    lastToggleNonce,
    setLastToggleNonce,
    () => {
      setCollapsed((v) => !v);
      setReplying(false);
      setEditingId(null);
    }
  );
  applyCommand(editRequest, rootId, lastEditNonce, setLastEditNonce, () => {
    if (lastOwnId === undefined || !onEdit) {
      return;
    }
    setCollapsed(false);
    setReplying(false);
    setEditingId(lastOwnId);
  });

  const submitReply = (body: string) => {
    if (rootId !== undefined) {
      onReply({ body, inReplyTo: rootId });
    }
    setReplying(false);
  };

  const submitEdit = (body: string) => {
    if (editingId !== null) {
      onEdit?.({ body, commentId: editingId });
    }
    setEditingId(null);
  };

  const handleStartEdit = (e: React.MouseEvent<HTMLButtonElement>) => {
    const id = Number(e.currentTarget.dataset.commentId);
    if (Number.isFinite(id)) {
      setEditingId(id);
      setReplying(false);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
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
            {!!onEdit && c.user === ownLogin && editingId !== c.id && (
              <span className="qf-comment-tools">
                <button
                  aria-label="Edit comment"
                  className="qf-comment-tool qf-focusable"
                  data-comment-id={c.id}
                  onClick={handleStartEdit}
                  type="button"
                >
                  Edit
                  {c.id === lastOwnId && (
                    <span aria-hidden className="qf-key-hint">
                      <Kbd combo="shift+e" />
                    </span>
                  )}
                </button>
              </span>
            )}
          </div>
          {editingId === c.id ? (
            <AddCommentBox
              autoFocus
              initialMarkdown={c.body}
              onCancel={handleCancelEdit}
              onSubmit={submitEdit}
              pending={false}
              placeholder="Edit your comment…"
              submitLabel="Save"
            />
          ) : (
            <div className="qf-comment-body">
              <Markdown>{c.body}</Markdown>
            </div>
          )}
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
