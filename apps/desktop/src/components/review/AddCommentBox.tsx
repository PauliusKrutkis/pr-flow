import { useRef, useState } from "react";
import { Layers, Send } from "lucide-react";
import { Kbd } from "../ui/Kbd";
import {
  ComposerEditor,
  type ComposerEditorHandle,
} from "./ComposerEditor";

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
  /**
   * The commented line's current (head-side) text. When set, the editor's
   * hint bar gains a "Suggestion" button that inserts a suggestion block
   * prefilled with it — only line composers pass this; replies don't know
   * their line's current content, so they don't offer it.
   */
  suggestionText?: string;
}

/**
 * The inline comment composer: a rich editor surface (see ComposerEditor)
 * that submits markdown. When a secondary action is provided (the diff
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
  suggestionText,
}: AddCommentBoxProps) {
  const [mode, setMode] = useState<"batch" | "now">("batch");
  // Mirrors the editor's emptiness so the submit affordance reacts without
  // the parent owning the text.
  const [empty, setEmpty] = useState(true);
  const editorRef = useRef<ComposerEditorHandle>(null);
  const canSubmit = !pending && !empty;

  const primaryAction = onSecondary && mode === "now" ? onSecondary : onSubmit;
  const primaryLabel =
    onSecondary && mode === "now" ? secondaryLabel : submitLabel;

  async function run(action: (body: string) => Promise<void> | void) {
    if (pending) return;
    const body = editorRef.current?.getMarkdown().trim() ?? "";
    if (!body) return;
    await action(body);
    editorRef.current?.clear();
  }

  return (
    <div className="qa-inline">
      <ComposerEditor
        ref={editorRef}
        placeholder={placeholder ?? "Leave a comment…  ⌘↵ to save"}
        autoFocus={autoFocus}
        suggestionText={suggestionText}
        onSubmitRequest={() => void run(primaryAction)}
        onCancel={onCancel}
        onModeFlip={
          onSecondary
            ? () => setMode((m) => (m === "batch" ? "now" : "batch"))
            : undefined
        }
        onEmptyChange={setEmpty}
      />

      <div className="qa-foot">
        {onSecondary ? (
          <div className="qa-seg" role="radiogroup" aria-label="When to post">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "batch"}
              className={
                "qa-seg-btn q-focus" + (mode === "batch" ? " qa-seg-on" : "")
              }
              onClick={() => setMode("batch")}
            >
              <Layers size={13} aria-hidden />
              {submitLabel}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "now"}
              className={
                "qa-seg-btn q-focus" + (mode === "now" ? " qa-seg-on" : "")
              }
              onClick={() => setMode("now")}
            >
              <Send size={13} aria-hidden />
              {secondaryLabel}
            </button>
          </div>
        ) : (
          <span className="text-xs text-faint">
            ⌘↵ to submit · Esc to cancel
          </span>
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
