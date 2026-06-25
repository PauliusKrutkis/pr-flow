import { cn } from "../../lib/cn";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Badge } from "../ui/Badge";
import type { PullRequest } from "../../types";

interface PRListItemProps {
  pr: PullRequest;
  selected: boolean;
  unread: boolean;
  onOpen: () => void;
}

export function PRListItem({ pr, selected, unread, onOpen }: PRListItemProps) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onOpen}
      className={cn(
        "flex cursor-pointer items-center gap-3 border-l-2 px-4 py-3",
        selected
          ? "border-accent bg-surface-2"
          : "border-transparent hover:bg-surface-2/60",
      )}
    >
      {/* Unread dot */}
      <span
        aria-hidden
        className={cn(
          "h-2 w-2 shrink-0 rounded-full",
          unread ? "bg-accent" : "bg-transparent",
        )}
      />

      {/* Main */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-fg">{pr.title}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted">
          <span className="truncate">{pr.repo}</span>
          <span className="text-faint">·</span>
          <img
            src={pr.authorAvatarUrl}
            alt=""
            width={16}
            height={16}
            className="h-4 w-4 shrink-0 rounded-full"
          />
          <span className="truncate">{pr.author}</span>
          <span className="text-faint">·</span>
          <span
            className="shrink-0 whitespace-nowrap"
            title={formatAbsolute(pr.updatedAt)}
          >
            {formatRelativeTime(pr.updatedAt)}
          </span>
        </div>
      </div>

      {/* Right: badges */}
      <div className="flex shrink-0 items-center gap-2">
        {pr.commentsCount > 0 && (
          <span className="whitespace-nowrap text-xs text-muted">
            💬 {pr.commentsCount}
          </span>
        )}
        {pr.draft && <Badge tone="warning">Draft</Badge>}
        <Badge tone="muted">#{pr.number}</Badge>
      </div>
    </div>
  );
}
