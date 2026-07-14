import { useQuery } from "@tanstack/react-query";
import { History, X } from "lucide-react";
import { useEffect } from "react";
import { useArmedRing } from "../hooks/use-armed-ring.ts";
import { useModalDialog } from "../hooks/use-modal-dialog.ts";
import { useHotkeys } from "../keyboard/use-hotkeys.ts";
import { api } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import { compareVersions, releasesQuery } from "../lib/releases.ts";
import { Markdown } from "./markdown.tsx";
import { Spinner } from "./ui/spinner.tsx";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const ARM_ORDER: (null | "close")[] = [null, "close"];

/**
 * Release history — every shipped version with its notes, newest first, on a
 * timeline spine. The running version wears the green "you are here" dot.
 * Opened from the command palette or the what's-new card's "All releases".
 */
export function ReleaseHistory({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) {
    return null;
  }
  return <ReleaseHistoryContent onClose={onClose} />;
}

function ReleaseHistoryContent({ onClose }: { onClose: () => void }) {
  const { dialogRef, onDialogCancel, onDialogClose } = useModalDialog(onClose);
  const { armed, cycle } = useArmedRing(ARM_ORDER, null);

  useHotkeys(
    "release-history",
    [
      {
        description: "Previous action",
        hidden: true,
        keys: "shift+tab",
        run: () => cycle(-1),
      },
      {
        description: "Next action",
        hidden: true,
        keys: "tab",
        run: () => cycle(1),
      },
      {
        description: "Activate",
        hidden: true,
        keys: "enter",
        run: () => {
          if (armed === "close") {
            onClose();
          }
        },
      },
      { description: "Close", hidden: true, keys: "esc", run: () => onClose() },
    ],
    { enabled: true }
  );

  useEffect(() => {
    dialogRef.current?.focus();
  }, [dialogRef]);

  const { data: releases } = useQuery(releasesQuery);
  const { data: version } = useQuery({
    queryFn: () => api.getAppVersion(),
    queryKey: ["app-version"],
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  return (
    <dialog
      aria-label="Release history"
      className="q-dialog q-dialog-top qrh-panel"
      onCancel={onDialogCancel}
      onClose={onDialogClose}
      ref={dialogRef}
    >
      <header className="qrh-head">
        <h2 className="qrh-title">
          <History aria-hidden size={14} />
          Release history
        </h2>
        <button
          aria-label="Close"
          className="qh-close"
          data-armed={armed === "close"}
          onClick={onClose}
          tabIndex={-1}
          type="button"
        >
          <X aria-hidden size={16} />
        </button>
      </header>

      <div className="qrh-list">
        {releases === undefined && (
          <div className="qrh-note">
            <Spinner label="Loading releases…" />
          </div>
        )}
        {releases === null && (
          <p className="qrh-note">
            Couldn't load releases — check your connection and reopen this view.
          </p>
        )}
        {releases?.length === 0 && (
          <p className="qrh-note">Nothing has shipped yet.</p>
        )}
        {releases?.map((r) => {
          const current =
            version !== undefined && compareVersions(r.tag, version) === 0;
          return (
            <article
              className={cn("qrh-item", current && "qrh-item-on")}
              key={r.tag}
            >
              <span aria-hidden className="qrh-dot" />
              <div className="qrh-item-head">
                <h3 className="q-mono qrh-tag">{r.tag}</h3>
                {current && <span className="qrh-now">current</span>}
                {r.publishedAt ? (
                  <time className="qrh-date" dateTime={r.publishedAt}>
                    {formatDate(r.publishedAt)}
                  </time>
                ) : null}
              </div>
              {r.notes ? (
                <Markdown className="qrh-notes">{r.notes}</Markdown>
              ) : (
                <p className="qrh-notes-none">No notes for this release.</p>
              )}
            </article>
          );
        })}
      </div>
    </dialog>
  );
}
