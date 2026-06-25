import { useState, type KeyboardEvent } from "react";
import { cn } from "../../lib/cn";

interface AddCommentBoxProps {
  onSubmit: (body: string) => Promise<void> | void;
  onCancel: () => void;
  pending: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

export function AddCommentBox({
  onSubmit,
  onCancel,
  pending,
  placeholder,
  autoFocus,
}: AddCommentBoxProps) {
  const [text, setText] = useState("");
  const trimmed = text.trim();
  const canSubmit = !pending && trimmed.length > 0;

  async function submit() {
    if (!canSubmit) return;
    await onSubmit(trimmed);
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface-2 p-2">
      <textarea
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Leave a comment…"}
        rows={3}
        className={cn(
          "w-full resize-y rounded border border-line bg-bg px-2 py-1.5",
          "font-mono text-xs text-fg placeholder:text-faint",
          "focus:border-accent focus:outline-none",
        )}
      />
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-faint">⌘↵ to submit · Esc to cancel</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-2.5 py-1 text-xs text-muted hover:bg-elevated hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canSubmit}
            className={cn(
              "rounded px-2.5 py-1 text-xs font-medium",
              canSubmit
                ? "bg-accent text-accent-fg hover:opacity-90"
                : "cursor-not-allowed bg-elevated text-faint",
            )}
          >
            {pending ? "Submitting…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
