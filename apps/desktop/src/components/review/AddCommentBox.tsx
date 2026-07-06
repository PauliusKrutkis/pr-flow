import { useRef, useState, type KeyboardEvent } from "react";
import { Diff, Layers, Send } from "lucide-react";
import { Kbd } from "../ui/Kbd";
import { Markdown } from "../Markdown";

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
   * The commented line's current (head-side) text. When set, the hint bar
   * gains a "Suggestion" button that drops a ```suggestion fence prefilled
   * with it — only line composers pass this; replies don't know their line's
   * current content, so they don't offer it.
   */
  suggestionText?: string;
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
  suggestionText,
}: AddCommentBoxProps) {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<"batch" | "now">("batch");
  // Preview swaps the textarea for rendered markdown in place — a toggle, not
  // GitHub's tab furniture. The textarea stays mounted (clipped, not removed)
  // so it keeps focus, caret and selection: every composer key — ⌘⇧P back,
  // ⌘↵, Esc, even typing — keeps working, and the preview updates live.
  const [preview, setPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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

  // Drop a ```suggestion fence at the caret, prefilled with the target line's
  // current text — then select that line so typing replaces it immediately.
  // Both hosts render/apply the fence natively once the comment posts.
  function insertSuggestion() {
    const line = suggestionText ?? "";
    const ta = textareaRef.current;
    const selStart = ta?.selectionStart ?? text.length;
    const selEnd = ta?.selectionEnd ?? text.length;
    const before = text.slice(0, selStart);
    const after = text.slice(selEnd);
    // The fence must open at column 0 — pad with a newline mid-text.
    const lead = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const block = `${lead}\`\`\`suggestion\n${line}\n\`\`\`\n`;
    setText(before + block + after);
    const lineStart = selStart + lead.length + "```suggestion\n".length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(lineStart, lineStart + line.length);
    });
  }

  // ⌘B / ⌘I: wrap the selection in markers and keep it selected, so the
  // shortcut is repeatable and the markdown stays inspectable — "rich" editing
  // without a rich-text engine, there is nothing to serialize or break.
  function wrapSelection(marker: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const inner = text.slice(start, end);
    setText(text.slice(0, start) + marker + inner + marker + text.slice(end));
    const from = start + marker.length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(from, from + inner.length);
    });
  }

  // ⌘K: [selection](url) with the placeholder selected, ready to be typed
  // over; with nothing selected the caret lands between the brackets instead.
  function wrapLink() {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const inner = text.slice(start, end);
    setText(text.slice(0, start) + "[" + inner + "](url)" + text.slice(end));
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      if (inner) {
        const urlAt = start + inner.length + 3; // past "[inner]("
        el.setSelectionRange(urlAt, urlAt + 3);
      } else {
        el.setSelectionRange(start + 1, start + 1);
      }
    });
  }

  function togglePreview() {
    setPreview((p) => !p);
    // Re-aim focus at the textarea after the flip, in case the toggle was a
    // click (keyboard toggles never let it leave).
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === "Enter") {
      e.preventDefault();
      void run(primaryAction);
    } else if (mod && !e.shiftKey && e.key === "b") {
      // stopPropagation on the formatting combos: the global hotkey listener
      // (window, bubble phase) honors mod-combos even from editable fields —
      // ⌘K in particular would open the command palette over our link insert.
      e.preventDefault();
      e.stopPropagation();
      wrapSelection("**");
    } else if (mod && !e.shiftKey && e.key === "i") {
      e.preventDefault();
      e.stopPropagation();
      wrapSelection("_");
    } else if (mod && !e.shiftKey && e.key === "k") {
      e.preventDefault();
      e.stopPropagation();
      wrapLink();
    } else if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
      e.preventDefault();
      e.stopPropagation();
      togglePreview();
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
      {/* The preview is a visual mirror of the (still focused, clipped)
          textarea — hidden from assistive tech, which keeps the real field. */}
      {preview && (
        <div className="qa-preview" aria-hidden>
          {trimmed ? (
            <Markdown>{text}</Markdown>
          ) : (
            <span className="qa-preview-empty">Nothing to preview yet.</span>
          )}
        </div>
      )}
      <textarea
        ref={textareaRef}
        autoFocus={autoFocus}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder ?? "Leave a comment…  ⌘↵ to save"}
        aria-label="Comment"
        rows={3}
        className={"q-input qa-textarea" + (preview ? " qa-textarea-ghost" : "")}
      />

      {/* The hint bar IS the toolbar: each entry names its hotkey and is a
          real button — discoverability and chrome share one quiet line. */}
      <div className="qa-tools">
        {suggestionText != null && (
          <button
            type="button"
            onClick={insertSuggestion}
            className="qa-tool qa-tool-suggest q-focus"
            aria-label="Insert suggestion"
            title="Insert a code suggestion prefilled with this line"
          >
            <Diff size={12} aria-hidden />
            Suggestion
          </button>
        )}
        <button
          type="button"
          onClick={() => wrapSelection("**")}
          className="qa-tool q-focus"
          aria-label="Bold"
          title="Bold — wraps the selection"
        >
          <Kbd combo="mod+b" />
          bold
        </button>
        <button
          type="button"
          onClick={() => wrapSelection("_")}
          className="qa-tool q-focus"
          aria-label="Italic"
          title="Italic — wraps the selection"
        >
          <Kbd combo="mod+i" />
          italic
        </button>
        <button
          type="button"
          onClick={wrapLink}
          className="qa-tool q-focus"
          aria-label="Link"
          title="Link — wraps the selection"
        >
          <Kbd combo="mod+k" />
          link
        </button>
        <button
          type="button"
          onClick={togglePreview}
          className={"qa-tool qa-tool-preview q-focus" + (preview ? " qa-tool-on" : "")}
          aria-pressed={preview}
          aria-label="Preview"
          title="Preview the rendered markdown"
        >
          <Kbd combo="mod+shift+p" />
          preview
        </button>
      </div>

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
