// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Titles with issue-tracker links: ticket IDs (SCR-2891, ABC-42, …) become
 * links to the configured tracker — mirroring what GitLab's Jira integration
 * renders in its own UI (the API only hands us plain text, so the base URL is
 * configured once per account: ⌘K → "Issue tracker…").
 */

const TICKET_RE = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;
const TRAILING_SLASH_RE = /\/$/;

/** `<base><id>`, or the {id} placeholder replaced when the template has one. */
function ticketUrl(base: string, id: string): string {
  return base.includes("{id}")
    ? base.replace("{id}", id)
    : `${base.replace(TRAILING_SLASH_RE, "")}/${id}`;
}

interface TitleSegment {
  kind: "text" | "ticket";
  value: string;
}

function parseTitleSegments(title: string): TitleSegment[] {
  const parts = title.split(TICKET_RE);
  if (parts.length === 1) {
    return [{ kind: "text", value: title }];
  }
  const segments: TitleSegment[] = [];
  let expectTicket = false;
  for (const part of parts) {
    if (expectTicket) {
      segments.push({ kind: "ticket", value: part });
    } else if (part) {
      segments.push({ kind: "text", value: part });
    }
    expectTicket = !expectTicket;
  }
  return segments;
}

function TicketLink({ id, trackerBase }: { id: string; trackerBase: string }) {
  const href = ticketUrl(trackerBase, id);
  const onClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    openUrl(href).catch(() => undefined);
  };
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
  const segments = parseTitleSegments(title);
  if (segments.length === 1 && segments[0]?.kind === "text") {
    return <>{title}</>;
  }
  return (
    <>
      {segments.map((segment) =>
        segment.kind === "ticket" ? (
          <TicketLink
            id={segment.value}
            key={`ticket-${segment.value}`}
            trackerBase={trackerBase}
          />
        ) : (
          <span key={`text-${segment.value}`}>{segment.value}</span>
        )
      )}
    </>
  );
}
