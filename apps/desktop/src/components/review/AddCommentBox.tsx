import { useState, type KeyboardEvent } from "react";
import { Layers, Send } from "lucide-react";
import { Kbd } from "../ui/Kbd";

interface AddCommentBoxProps {
  onSubmit: (body: string) => Promise<void> | void;
  onCancel: () => void;
  pending: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Primary button label (⌘↵). Defaults to "Comment". */
  submitLabel?: string;
  /** Optional secondary action (e.g. post immediately vs. add to a review). */
  onSecondary?: (body: string) => Promise<void> | void;
  secondaryLabel?: string;
}

/**
 * The inline comment composer. When a secondary action is provided (the diff
 * "add to review" vs. "comment now" choice) it shows a segmented control that
 * makes the mode explicit, and the primary button + ⌘↵ follow the chosen mode.
 * Replies and issue comments (no secondary) fall back to a single button.
 */
export function AddCommentBox({
  onSubmit,
  onCancel,
  pending,
  placeholder,
  autoFocus,
  submitLabel = "Comment",
  onSecondary,
  secondaryLabel = "Comment now",
}: AddCommentBoxProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"batch" | "now">("batch");
  const trimmed = text.trim();
  const canSubmit = !pending && trimmed.length > 0;

  const primaryAction =
    onSecondary && mode === "now" ? onSecondary : onSubmit;
  const primaryLabel = onSecondary && mode === "now" ? secondaryLabel : submitLabel;

  async function run(action: (body: string) => Promise<void> | void) {
    if (!canSubmit) return;
    await action(trimmed);
    setText("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void run(primaryAction);
    } else if (e.key === "Tab" && onSecondary) {
      // Tab flips between "add to review" and "comment now" without leaving
      // the textarea — focus never wanders.
      e.preventDefault();
      setMode((m) => (m === "batch" ? "now" : "batch"));
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="qa-inline">
      <textarea
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Leave a comment…  ⌘↵ to save"}
        rows={3}
        className="q-input qa-textarea"
      />

      <div className="qa-foot">
        {onSecondary ? (
          <div className="qa-seg" role="radiogroup" aria-label="When to post">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "batch"}
              className={"qa-seg-btn q-focus" + (mode === "batch" ? " qa-seg-on" : "")}
              onClick={() => setMode("batch")}
            >
              <Layers size={13} aria-hidden />
              {submitLabel}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "now"}
              className={"qa-seg-btn q-focus" + (mode === "now" ? " qa-seg-on" : "")}
              onClick={() => setMode("now")}
            >
              <Send size={13} aria-hidden />
              {secondaryLabel}
            </button>
          </div>
        ) : (
          <span className="text-xs text-faint">⌘↵ to submit · Esc to cancel</span>
        )}

        <div className="qa-actions">
          <button type="button" onClick={onCancel} className="q-btn q-btn-ghost">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void run(primaryAction)}
            disabled={!canSubmit}
            className="q-btn q-btn-primary"
          >
            {pending ? "Submitting…" : primaryLabel}
            <Kbd combo="mod+enter" />
          </button>
        </div>
      </div>

      {onSecondary && (
        <p className="qa-explain">
          {mode === "batch"
            ? "Held with your other pending comments until you submit the review."
            : "Posted to the PR immediately, on its own."}{" "}
          Tab switches.
        </p>
      )}
    </div>
  );
}
