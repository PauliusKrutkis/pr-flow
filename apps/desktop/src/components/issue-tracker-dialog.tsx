// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { Ticket } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef } from "react";
import { useModalDialog } from "../hooks/use-modal-dialog.ts";
import { useHotkeys } from "../keyboard/use-hotkeys.ts";
import { useAppStore } from "../store/app-store.ts";

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

  if (!open) {
    return null;
  }

  return (
    <IssueTrackerDialogContent
      activeAccountId={activeAccountId}
      current={current}
      key={`${activeAccountId ?? "none"}:${current}`}
      onClose={onClose}
      setIssueTracker={setIssueTracker}
    />
  );
}

function IssueTrackerDialogContent({
  activeAccountId,
  current,
  onClose,
  setIssueTracker,
}: {
  activeAccountId: string | null;
  current: string;
  onClose: () => void;
  setIssueTracker: (accountId: string, url: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { dialogRef, onDialogCancel, onDialogClose } = useModalDialog(onClose);

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useHotkeys(
    "issue-tracker",
    [{ description: "Close", hidden: true, keys: "esc", run: () => onClose() }],
    { enabled: true }
  );

  const save = () => {
    if (activeAccountId) {
      setIssueTracker(activeAccountId, inputRef.current?.value ?? current);
    }
    onClose();
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <dialog
      aria-label="Issue tracker"
      className="q-dialog q-dialog-top qw-panel"
      onCancel={onDialogCancel}
      onClose={onDialogClose}
      ref={dialogRef}
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
          aria-label="Issue tracker URL"
          autoComplete="off"
          className="q-input font-mono"
          defaultValue={current}
          onKeyDown={onInputKeyDown}
          placeholder="https://yourco.atlassian.net/browse/"
          ref={inputRef}
          spellCheck={false}
        />
        <p className="mt-2 text-faint text-xs">
          The ticket ID is appended — or use {"{id}"} anywhere in the URL. Leave
          empty to turn linking off.
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
    </dialog>
  );
}
