import { type KeyboardEvent, useEffect, useState } from "react";
import { useHotkeys } from "../../keyboard/useHotkeys.ts";
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
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [body, setBody] = useState("");

  useEffect(() => {
    if (open) {
      setEvent("COMMENT");
      setBody("");
    }
  }, [open]);

  useHotkeys(
    "submit",
    [{ description: "Close", hidden: true, keys: "esc", run: onClose }],
    { enabled: open }
  );

  if (!open) {
    return null;
  }

  const needsBody = event === "COMMENT" && pendingCount === 0;
  const canSubmit = !busy && (!needsBody || body.trim().length > 0);

  function submit() {
    if (!canSubmit) {
      return;
    }
    onSubmit(event, body.trim());
  }

  const disabledEvent = (value: ReviewEvent) => ownPr && value !== "COMMENT";

  function cycleEvent(dir: number) {
    setEvent((cur) => {
      let i = EVENTS.findIndex((ev) => ev.value === cur);
      for (let step = 0; step < EVENTS.length; step++) {
        i = (i + dir + EVENTS.length) % EVENTS.length;
        if (!disabledEvent(EVENTS[i].value)) {
          return EVENTS[i].value;
        }
      }
      return cur;
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
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
  }

  return (
    <div
      className="q-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div aria-modal="true" className="q-dialog q-dialog-top" role="dialog">
        <div className="border-line border-b px-5 py-3.5">
          <h2 className="font-semibold text-fg text-sm">Submit review</h2>
          <p className="mt-0.5 text-muted text-xs">
            {pendingCount > 0
              ? `${pendingCount} pending comment${pendingCount === 1 ? "" : "s"} will be included.`
              : "No pending comments — submits the verdict and summary only."}
          </p>
        </div>

        <div className="px-5 py-4">
          {ownPr && (
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
                  onClick={() => setEvent(opt.value)}
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
            autoFocus
            className="q-input mt-3"
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
            <button
              className="q-btn q-btn-ghost"
              onClick={onClose}
              type="button"
            >
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
      </div>
    </div>
  );
}
