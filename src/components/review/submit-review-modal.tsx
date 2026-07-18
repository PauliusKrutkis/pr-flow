import { type KeyboardEvent, useRef, useState } from "react";
import { useModalDialog } from "../../hooks/use-modal-dialog.ts";
import { useHotkeys } from "../../keyboard/use-hotkeys.ts";
import { cn } from "../../lib/cn.ts";
import type { ReviewEvent } from "../../types.ts";

const EVENTS: { value: ReviewEvent; label: string; hint: string }[] = [
  {
    hint: "General feedback without an explicit verdict.",
    label: "Comment",
    value: "COMMENT",
  },
  { hint: "Approve these changes.", label: "Approve", value: "APPROVE" },
  {
    hint: "Block until changes are made.",
    label: "Request changes",
    value: "REQUEST_CHANGES",
  },
];

const PLACEHOLDERS: Record<ReviewEvent, string> = {
  APPROVE: "Optional approval note…",
  COMMENT: "Review summary…",
  REQUEST_CHANGES: "What needs to change?",
};

interface Props {
  busy: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (event: ReviewEvent, body: string) => void;
  open: boolean;
  ownPr?: boolean;
  pendingCount: number;
}

export function SubmitReviewModal({
  open,
  ownPr = false,
  pendingCount,
  busy,
  error,
  onClose,
  onSubmit,
}: Props) {
  if (!open) {
    return null;
  }
  return (
    <SubmitReviewModalContent
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={onSubmit}
      ownPr={ownPr}
      pendingCount={pendingCount}
    />
  );
}

function SubmitReviewModalContent({
  ownPr,
  pendingCount,
  busy,
  error,
  onClose,
  onSubmit,
}: Omit<Props, "open">) {
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const { dialogRef, onDialogCancel, onDialogClose } = useModalDialog(
    onClose,
    bodyRef
  );

  useHotkeys(
    "submit",
    [{ description: "Close", hidden: true, keys: "esc", run: onClose }],
    { enabled: true }
  );

  const disabledEvent = (value: ReviewEvent) => ownPr && value !== "COMMENT";

  const cycleEvent = (dir: number) => {
    setEvent((cur) => {
      let i = EVENTS.findIndex((ev) => ev.value === cur);
      for (const _ev of EVENTS) {
        i = (i + dir + EVENTS.length) % EVENTS.length;
        if (!disabledEvent(EVENTS[i].value)) {
          return EVENTS[i].value;
        }
      }
      return cur;
    });
  };

  const needsBody = event === "COMMENT" && pendingCount === 0;
  const canSubmit = !busy && (!needsBody || body.trim().length > 0);

  const submit = () => {
    if (!canSubmit) {
      return;
    }
    onSubmit(event, body.trim());
  };

  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setBody(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Tab") {
      e.preventDefault();
      cycleEvent(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const handleSelectEvent = (value: ReviewEvent) => () => {
    if (!disabledEvent(value)) {
      setEvent(value);
    }
  };

  const placeholder = PLACEHOLDERS[event];

  return (
    <dialog
      aria-label="Submit review"
      className="q-dialog q-dialog-top"
      onCancel={onDialogCancel}
      onClose={onDialogClose}
      ref={dialogRef}
    >
      <div className="border-line border-b px-5 py-3.5">
        <h2 className="font-semibold text-fg text-sm">Submit review</h2>
        <p className="mt-0.5 text-muted text-xs">
          {pendingCount > 0
            ? `${pendingCount} pending comment${pendingCount === 1 ? "" : "s"} will be included.`
            : "No pending comments — submits the verdict and summary only."}
        </p>
      </div>

      <div className="px-5 py-4">
        {!!ownPr && (
          <p className="mb-2.5 text-faint text-xs">
            This is your own PR — only a comment review can be submitted.
          </p>
        )}
        <div className="flex gap-2">
          {EVENTS.map((opt) => {
            const disabled = disabledEvent(opt.value);
            return (
              <button
                className={cn(
                  "flex-1 rounded-lg border px-2 py-2 font-semibold text-xs transition-colors",
                  event === opt.value
                    ? "border-accent bg-accent/15 text-fg"
                    : "border-line text-muted hover:bg-surface-2 hover:text-fg",
                  disabled &&
                    "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted"
                )}
                disabled={disabled}
                key={opt.value}
                onClick={handleSelectEvent(opt.value)}
                title={
                  disabled
                    ? "You can't approve or request changes on your own PR"
                    : opt.hint
                }
                type="button"
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        <textarea
          aria-label="Review summary"
          className="q-input mt-3"
          onChange={handleBodyChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          ref={bodyRef}
          rows={4}
          value={body}
        />

        {error ? (
          <p className="mt-2 break-words text-danger text-xs">{error}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-between border-line border-t px-5 py-3.5">
        <span className="text-faint text-xs">
          Tab switches verdict · ⌘↵ to submit · Esc to cancel
        </span>
        <div className="flex items-center gap-2">
          <button className="q-btn q-btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="q-btn q-btn-primary"
            disabled={!canSubmit}
            onClick={submit}
            type="button"
          >
            {busy ? "Submitting…" : "Submit review"}
          </button>
        </div>
      </div>
    </dialog>
  );
}
