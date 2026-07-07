import { Fragment } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Titles with issue-tracker links: ticket IDs (SCR-2891, ABC-42, …) become
 * links to the configured tracker — mirroring what GitLab's Jira integration
 * renders in its own UI (the API only hands us plain text, so the base URL is
 * configured once per account: ⌘K → "Issue tracker…").
 */

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

/** `<base><id>`, or the {id} placeholder replaced when the template has one. */
export function ticketUrl(base: string, id: string): string {
  return base.includes("{id}")
    ? base.replace("{id}", id)
    : base.replace(/\/$/, "") + "/" + id;
}

export function TicketTitle({
  title,
  trackerBase,
}: {
  title: string;
  trackerBase?: string;
}) {
  if (!trackerBase) return <>{title}</>;
  const parts = title.split(TICKET_RE);
  if (parts.length === 1) return <>{title}</>;
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <a
            key={i}
            href="#"
            className="q-ticket"
            title={ticketUrl(trackerBase, part)}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void openUrl(ticketUrl(trackerBase, part));
            }}
          >
            {part}
          </a>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}
