import { Layers, Send } from "lucide-react";
import { type Ref, useImperativeHandle, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { Kbd } from "../ui/kbd.tsx";
import {
  ComposerEditor,
  type ComposerEditorHandle,
} from "./composer-editor.tsx";

export interface AddCommentBoxHandle {
  focus: () => void;
}

interface AddCommentBoxProps {
  autoFocus?: boolean;
  initialMarkdown?: string;
  onCancel: () => void;
  /** Mirrors the editor's empty state to the parent (the drawer's collapsed
      prompt uses it to advertise a surviving draft). */
  onEmptyChange?: (empty: boolean) => void;
  onSecondary?: (body: string) => Promise<void> | void;
  onSubmit: (body: string) => Promise<void> | void;
  pending: boolean;
  placeholder?: string;
  ref?: Ref<AddCommentBoxHandle>;
  secondaryLabel?: string;
  submitLabel?: string;
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
  ref,
  onSubmit,
  onCancel,
  onEmptyChange,
  pending,
  placeholder,
  autoFocus,
  initialMarkdown,
  submitLabel = "Comment",
  onSecondary,
  secondaryLabel = "Comment now",
  suggestionText,
}: AddCommentBoxProps) {
  const [mode, setMode] = useState<"batch" | "now">("batch");
  const [empty, setEmpty] = useState(() => !initialMarkdown?.trim());
  const editorRef = useRef<ComposerEditorHandle>(null);
  const canSubmit = !(pending || empty);

  useImperativeHandle(
    ref,
    (): AddCommentBoxHandle => ({
      focus: () => editorRef.current?.focus(),
    }),
    []
  );

  const handleEmptyChange = (isEmpty: boolean) => {
    setEmpty(isEmpty);
    onEmptyChange?.(isEmpty);
  };

  const primaryAction = onSecondary && mode === "now" ? onSecondary : onSubmit;
  const primaryLabel =
    onSecondary && mode === "now" ? secondaryLabel : submitLabel;

  const run = async (action: (body: string) => Promise<void> | void) => {
    if (pending) {
      return;
    }
    const body = editorRef.current?.getMarkdown().trim() ?? "";
    if (!body) {
      return;
    }
    await action(body);
    editorRef.current?.clear();
  };

  const handleSubmitRequest = () => {
    run(primaryAction);
  };

  const handleBatchMode = () => {
    setMode("batch");
  };

  const handleNowMode = () => {
    setMode("now");
  };

  const handlePrimaryClick = () => {
    run(primaryAction);
  };

  const handleModeFlip = () => {
    setMode((m) => (m === "batch" ? "now" : "batch"));
  };

  return (
    <div className="qa-inline">
      <ComposerEditor
        autoFocus={autoFocus}
        initialMarkdown={initialMarkdown}
        onCancel={onCancel}
        onEmptyChange={handleEmptyChange}
        onModeFlip={onSecondary ? handleModeFlip : undefined}
        onSubmitRequest={handleSubmitRequest}
        placeholder={placeholder ?? "Leave a comment…  ⌘↵ to save"}
        ref={editorRef}
        suggestionText={suggestionText}
      />

      <div className="qa-foot">
        {onSecondary ? (
          <div aria-label="When to post" className="qa-seg" role="radiogroup">
            <label
              className={cn(
                "qa-seg-btn q-focus",
                mode === "batch" && "qa-seg-on"
              )}
            >
              <input
                aria-checked={mode === "batch"}
                checked={mode === "batch"}
                className="sr-only"
                name="post-mode"
                onChange={handleBatchMode}
                type="radio"
              />
              <Layers aria-hidden size={13} />
              {submitLabel}
            </label>
            <label
              className={cn(
                "qa-seg-btn q-focus",
                mode === "now" && "qa-seg-on"
              )}
            >
              <input
                aria-checked={mode === "now"}
                checked={mode === "now"}
                className="sr-only"
                name="post-mode"
                onChange={handleNowMode}
                type="radio"
              />
              <Send aria-hidden size={13} />
              {secondaryLabel}
            </label>
          </div>
        ) : null}

        <div className="qa-actions">
          <button
            className="q-btn q-btn-ghost"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="q-btn q-btn-primary"
            disabled={!canSubmit}
            onClick={handlePrimaryClick}
            type="button"
          >
            {pending ? "Submitting…" : (primaryLabel ?? "")}
            <Kbd combo="mod+enter" />
          </button>
        </div>
      </div>

      {!!onSecondary && (
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
