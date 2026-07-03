import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { ReviewComment } from "../../types";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Markdown } from "../Markdown";
import { Avatar } from "../ui/Avatar";
import { AddCommentBox } from "./AddCommentBox";

/** An `r`-key request to open this thread's reply composer (nonce re-fires). */
export interface ReplyRequest {
  rootId: number;
  nonce: number;
}

interface CommentThreadProps {
  /** One thread, root first then replies. */
  comments: ReviewComment[];
  onReply: (a: { inReplyTo: number; body: string }) => Promise<void>;
  replyPending: boolean;
  /** Flip the thread's resolved state (absent when the host can't resolve). */
  onResolve?: (a: { threadId: string; resolved: boolean }) => void;
  /** Pointer entered/left this thread — feeds the `r`-to-reply target. */
  onHoverChange?: (hovering: boolean) => void;
  /** When aimed at this thread's root, open the reply composer focused. */
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
  // Resolved threads collapse to a single row; expanding is per-thread local
  // state that resets when you leave the PR (matching the hosts' behavior).
  const [expanded, setExpanded] = useState(false);

  const root = comments[0];
  const rootId = root?.id;

  // `r` on the hovered / ]c-focused thread: surface the composer. Expanding
  // first means a resolved thread un-collapses instead of ignoring the key;
  // AddCommentBox's autoFocus then claims the caret.
  useEffect(() => {
    if (!replyRequest || replyRequest.rootId !== rootId) return;
    setExpanded(true);
    setReplying(true);
  }, [replyRequest, rootId]);

  if (comments.length === 0) return null;
  // Thread identity/state ride on every comment; read them off the root.
  const threadId = root.threadId;
  const resolved = root.resolved;

  const hoverProps = {
    onMouseEnter: () => onHoverChange?.(true),
    onMouseLeave: () => onHoverChange?.(false),
  };

  function submitReply(body: string) {
    // Optimistic — the reply is inserted into the cache by the mutation's
    // onMutate; close the composer immediately.
    void onReply({ inReplyTo: rootId, body });
    setReplying(false);
  }

  // Collapsed resolved thread: one quiet row that expands on click (a real
  // <button>, so Enter/Space work too). data-comment-root stays on it so the
  // drawer's jump-to-thread still lands and flashes here.
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
    // data-comment-root lets the info drawer's "Code discussion" index find
    // and flash this thread when jumping to it.
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
          </button>
          {threadId != null && onResolve && (
            <button
              type="button"
              className="qf-reply-btn qf-resolve-btn qf-focusable"
              onClick={() => {
                // Optimistic — the flip lands in the cache immediately;
                // resolving also collapses the card out of the way.
                onResolve({ threadId, resolved: !resolved });
                setExpanded(resolved);
              }}
            >
              {resolved ? "Unresolve" : "Resolve"}
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
