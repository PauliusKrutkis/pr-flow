import { MessageSquare } from "lucide-react";
import { cn } from "../../lib/cn";
import { formatRelativeTime, formatAbsolute } from "../../lib/time";
import { Badge } from "../ui/Badge";
import { Avatar } from "../ui/Avatar";
import type { PullRequest } from "../../types";

interface PRListItemProps {
  pr: PullRequest;
  selected: boolean;
  unread: boolean;
  onOpen: () => void;
  /** Called on hover — used to prefetch the PR so opening is instant. */
  onHover?: () => void;
}

export function PRListItem({
  pr,
  selected,
  unread,
  onOpen,
  onHover,
}: PRListItemProps) {
  return (
    <div
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onOpen}
      onMouseEnter={onHover}
      className={cn(
        "relative flex cursor-pointer items-center gap-3 border-l-2 py-2.5 pl-3 pr-4 transition-colors",
        selected
          ? "border-accent bg-accent/15"
          : "border-transparent hover:bg-surface-2",
      )}
    >
      {/* Unread dot */}
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          unread ? "bg-accent shadow-[0_0_8px_-1px_var(--color-accent)]" : "bg-transparent",
        )}
      />

      {/* Main */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm",
              // Weight/colour encode unread only — selection & hover are shown
              // by background alone, so hovering never reflows the type.
              unread ? "font-semibold text-fg" : "font-medium text-muted",
            )}
          >
            {pr.title}
          </span>
          {pr.draft && <Badge tone="warning">Draft</Badge>}
          {pr.merged && <Badge tone="accent">Merged</Badge>}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-muted">
          <span className="font-mono text-faint">#{pr.number}</span>
          <span className="text-faint">·</span>
          <span className="truncate">{pr.repo}</span>
          <span className="text-faint">·</span>
          <Avatar url={pr.authorAvatarUrl} name={pr.author} size={14} />
          <span className="truncate">{pr.author}</span>
          {pr.commentsCount > 0 && (
            <>
              <span className="text-faint">·</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono">
                <MessageSquare size={11} aria-hidden />
                {pr.commentsCount}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Right: relative time */}
      <span
        className="shrink-0 whitespace-nowrap font-mono text-[11px] text-faint"
        title={formatAbsolute(pr.updatedAt)}
      >
        {formatRelativeTime(pr.updatedAt)}
      </span>
    </div>
  );
}
