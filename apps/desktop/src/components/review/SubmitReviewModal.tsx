import { useEffect, useState, type KeyboardEvent } from "react";
import { useHotkeys } from "../../keyboard";
import { cn } from "../../lib/cn";
import type { ReviewEvent } from "../../types";

const EVENTS: { value: ReviewEvent; label: string; hint: string }[] = [
  { value: "COMMENT", label: "Comment", hint: "General feedback without an explicit verdict." },
  { value: "APPROVE", label: "Approve", hint: "Approve these changes." },
  { value: "REQUEST_CHANGES", label: "Request changes", hint: "Block until changes are made." },
];

interface Props {
  open: boolean;
  pendingCount: number;
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (event: ReviewEvent, body: string) => void;
}

export function SubmitReviewModal({
  open,
  pendingCount,
  busy,
  error,
  onClose,
  onSubmit,
}: Props) {
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (open) {
      setEvent("COMMENT");
      setBody("");
    }
  }, [open]);

  // Make "submit" the active scope so the review shortcuts don't fire behind it.
  useHotkeys(
    "submit",
    [{ keys: "esc", description: "Close", hidden: true, run: onClose }],
    { enabled: open },
  );

  if (!open) return null;

  // GitHub rejects an empty COMMENT review (needs a body or pending comments).
  const needsBody = event === "COMMENT" && pendingCount === 0;
  const canSubmit = !busy && (!needsBody || body.trim().length > 0);

  function submit() {
    if (!canSubmit) return;
    onSubmit(event, body.trim());
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      className="q-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="q-dialog q-dialog-top" role="dialog" aria-modal="true">
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="text-sm font-semibold text-fg">Submit review</h2>
          <p className="mt-0.5 text-xs text-muted">
            {pendingCount > 0
              ? `${pendingCount} pending comment${pendingCount === 1 ? "" : "s"} will be included.`
              : "No pending comments — submits the verdict and summary only."}
          </p>
        </div>

        <div className="px-5 py-4">
          <div className="flex gap-2">
            {EVENTS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setEvent(opt.value)}
                title={opt.hint}
                className={cn(
                  "flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-colors",
                  event === opt.value
                    ? "border-accent bg-accent/15 text-fg"
                    : "border-line text-muted hover:bg-surface-2 hover:text-fg",
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              event === "APPROVE"
                ? "Optional approval note…"
                : event === "REQUEST_CHANGES"
                  ? "What needs to change?"
                  : "Review summary…"
            }
            rows={4}
            className="q-input mt-3"
          />

          {error ? (
            <p className="mt-2 break-words text-xs text-danger">{error}</p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-line px-5 py-3.5">
          <span className="text-xs text-faint">⌘↵ to submit · Esc to cancel</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="q-btn q-btn-ghost">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="q-btn q-btn-primary"
            >
              {busy ? "Submitting…" : "Submit review"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
