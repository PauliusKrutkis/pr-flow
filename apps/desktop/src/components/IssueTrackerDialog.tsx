import { Ticket } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useHotkeys } from "../keyboard/useHotkeys.ts";
import { useAppStore } from "../store/appStore.ts";

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
    s.activeAccountId ? (s.issueTrackers[s.activeAccountId] ?? "") : ""
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
    [{ description: "Close", hidden: true, keys: "esc", run: () => onClose() }],
    { enabled: open }
  );

  if (!open) {
    return null;
  }

  function save() {
    if (activeAccountId) {
      setIssueTracker(activeAccountId, url);
    }
    onClose();
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
      <div
        aria-label="Issue tracker"
        aria-modal="true"
        className="q-dialog q-dialog-top qw-panel"
        role="dialog"
      >
        <div className="border-line border-b px-5 py-3.5">
          <h2 className="flex items-center gap-2 font-semibold text-fg text-sm">
            <Ticket aria-hidden className="text-accent" size={14} />
            Issue tracker links
          </h2>
          <p className="mt-0.5 text-muted text-xs">
            Ticket IDs in PR titles (SCR-2891, ABC-42, …) become links to this
            URL. Set once per account.
          </p>
        </div>

        <div className="px-5 py-4">
          <input
            autoComplete="off"
            className="q-input font-mono"
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
            ref={inputRef}
            spellCheck={false}
            value={url}
          />
          <p className="mt-2 text-faint text-xs">
            The ticket ID is appended — or use {"{id}"} anywhere in the URL.
            Leave empty to turn linking off.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 border-line border-t px-5 py-3">
          <button className="q-btn q-btn-ghost" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="q-btn q-btn-primary" onClick={save} type="button">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
