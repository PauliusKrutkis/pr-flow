// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback } from "react";

/**
 * Titles with issue-tracker links: ticket IDs (SCR-2891, ABC-42, …) become
 * links to the configured tracker — mirroring what GitLab's Jira integration
 * renders in its own UI (the API only hands us plain text, so the base URL is
 * configured once per account: ⌘K → "Issue tracker…").
 */

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
const TRAILING_SLASH_RE = /\/$/;

/** `<base><id>`, or the {id} placeholder replaced when the template has one. */
export function ticketUrl(base: string, id: string): string {
  return base.includes("{id}")
    ? base.replace("{id}", id)
    : `${base.replace(TRAILING_SLASH_RE, "")}/${id}`;
}

function TicketLink({ id, trackerBase }: { id: string; trackerBase: string }) {
  const href = ticketUrl(trackerBase, id);
  const onClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      openUrl(href).catch(() => undefined);
    },
    [href]
  );
  return (
    <button className="q-ticket" onClick={onClick} title={href} type="button">
      {id}
    </button>
  );
}

export function TicketTitle({
  title,
  trackerBase,
}: {
  title: string;
  trackerBase?: string;
}) {
  if (!trackerBase) {
    return <>{title}</>;
  }
  const parts = title.split(TICKET_RE);
  if (parts.length === 1) {
    return <>{title}</>;
  }
  let expectTicket = false;
  let offset = 0;
  return (
    <>
      {parts.map((part) => {
        const key = offset;
        offset += part.length;
        if (expectTicket) {
          expectTicket = false;
          return <TicketLink id={part} key={key} trackerBase={trackerBase} />;
        }
        expectTicket = true;
        return <span key={key}>{part}</span>;
      })}
    </>
  );
}
