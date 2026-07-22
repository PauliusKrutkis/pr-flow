/**
 * The comment-row internals shared by both comment surfaces — inline threads
 * (comment-thread.tsx) and the drawer conversation (right-panel.tsx) — so the
 * own-comment affordances can't drift apart. The surfaces keep their own
 * layout; what they share is the Edit/Delete tools and the body that swaps
 * into a composer while editing. CommentTools' `editKbd` is the hotkey chip
 * shown on Edit — the thread surface passes it on its last own comment.
 */
import { useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Markdown } from "../markdown.tsx";
import { Kbd } from "../ui/kbd.tsx";
import { AddCommentBox } from "./add-comment-box.tsx";

interface CommentToolsProps {
  commentId: number;
  editKbd?: string;
  onDelete?: (commentId: number) => void;
  onStartEdit?: (commentId: number) => void;
}

/** Edit + two-step Delete ("Delete" → "Delete?", disarmed on blur/mouse-leave). */
export function CommentTools({
  commentId,
  editKbd,
  onStartEdit,
  onDelete,
}: CommentToolsProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleStartEdit = () => {
    setConfirmingDelete(false);
    onStartEdit?.(commentId);
  };

  const handleDelete = () => {
    if (confirmingDelete) {
      setConfirmingDelete(false);
      onDelete?.(commentId);
    } else {
      setConfirmingDelete(true);
    }
  };

  const disarmDelete = () => {
    setConfirmingDelete(false);
  };

  return (
    <span className="qf-comment-tools">
      {!!onStartEdit && (
        <button
          aria-label="Edit comment"
          className="qf-comment-tool qf-focusable"
          onClick={handleStartEdit}
          type="button"
        >
          Edit
          {editKbd !== undefined && (
            <span aria-hidden className="qf-key-hint">
              <Kbd combo={editKbd} />
            </span>
          )}
        </button>
      )}
      {!!onDelete && (
        <button
          aria-label="Delete comment"
          className={cn(
            "qf-comment-tool qf-focusable",
            confirmingDelete && "qf-comment-tool-danger"
          )}
          onBlur={disarmDelete}
          onClick={handleDelete}
          onMouseLeave={disarmDelete}
          type="button"
        >
          {confirmingDelete ? "Delete?" : "Delete"}
        </button>
      )}
    </span>
  );
}

interface CommentBodyProps {
  body: string;
  editing: boolean;
  onCancelEdit: () => void;
  onSubmitEdit: (body: string) => void;
  owner?: string;
  repo?: string;
}

/** Markdown body, or the composer prefilled with it while editing. */
export function CommentBody({
  body,
  editing,
  onCancelEdit,
  onSubmitEdit,
  owner,
  repo,
}: CommentBodyProps) {
  if (editing) {
    return (
      <AddCommentBox
        autoFocus
        initialMarkdown={body}
        onCancel={onCancelEdit}
        onSubmit={onSubmitEdit}
        pending={false}
        placeholder="Edit your comment…"
        submitLabel="Save"
      />
    );
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }
  return (
    <div className="qf-comment-body">
      <Markdown owner={owner} repo={repo}>
        {trimmed}
      </Markdown>
    </div>
  );
}
