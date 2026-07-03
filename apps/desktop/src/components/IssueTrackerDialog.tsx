import { useEffect, useRef, useState } from "react";
import { Ticket } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { useHotkeys } from "../keyboard";

/**
 * Configure issue-tracker linking for the active account: paste the tracker's
 * browse URL (e.g. https://yourco.atlassian.net/browse/) and ticket IDs in PR
 * titles become links. `{id}` templates are supported; empty clears.
 */
export function IssueTrackerDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const activeAccountId = useAppStore((s) => s.activeAccountId);
  const current = useAppStore((s) =>
    s.activeAccountId ? (s.issueTrackers[s.activeAccountId] ?? "") : "",
  );
  const setIssueTracker = useAppStore((s) => s.setIssueTracker);
  const [url, setUrl] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUrl(current);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, current]);

  useHotkeys(
    "issue-tracker",
    [{ keys: "esc", description: "Close", hidden: true, run: () => onClose() }],
    { enabled: open },
  );

  if (!open) return null;

  function save() {
    if (activeAccountId) setIssueTracker(activeAccountId, url);
    onClose();
  }

  return (
    <div
      className="q-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="q-dialog q-dialog-top qw-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Issue tracker"
      >
        <div className="border-b border-line px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <Ticket size={14} aria-hidden className="text-accent" />
            Issue tracker links
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Ticket IDs in PR titles (SCR-2891, ABC-42, …) become links to this
            URL. Set once per account.
          </p>
        </div>

        <div className="px-5 py-4">
          <input
            ref={inputRef}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                save();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
            placeholder="https://yourco.atlassian.net/browse/"
            spellCheck={false}
            autoComplete="off"
            className="q-input font-mono"
          />
          <p className="mt-2 text-xs text-faint">
            The ticket ID is appended — or use {"{id}"} anywhere in the URL.
            Leave empty to turn linking off.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" onClick={onClose} className="q-btn q-btn-ghost">
            Cancel
          </button>
          <button type="button" onClick={save} className="q-btn q-btn-primary">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
