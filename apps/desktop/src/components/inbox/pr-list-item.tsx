// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { MessageSquare } from "lucide-react";
import { useCallback } from "react";
import { cn } from "../../lib/cn.ts";
import { formatAbsolute, formatRelativeTime } from "../../lib/time.ts";
import type { PullRequest } from "../../types.ts";
import { Avatar } from "../ui/avatar.tsx";
import { Badge } from "../ui/badge.tsx";

interface PRListItemProps {
  onHover?: () => void;
  onOpen: () => void;
  pr: PullRequest;
  selected: boolean;
  unread: boolean;
}

export function PRListItem({
  pr,
  selected,
  unread,
  onOpen,
  onHover,
}: PRListItemProps) {
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen();
      }
    },
    [onOpen]
  );

  return (
    <div
      aria-selected={selected}
      className={cn(
        "relative flex cursor-pointer items-center gap-3 border-l-2 py-2.5 pr-4 pl-3 transition-colors",
        selected
          ? "border-accent bg-accent/15"
          : "border-transparent hover:bg-surface-2"
      )}
      onClick={onOpen}
      onKeyDown={onKeyDown}
      onMouseEnter={onHover}
      role="option"
      tabIndex={-1}
    >
      <span
        aria-hidden
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          unread
            ? "bg-accent shadow-[0_0_8px_-1px_var(--color-accent)]"
            : "bg-transparent"
        )}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-sm",
              unread ? "font-semibold text-fg" : "font-medium text-muted"
            )}
          >
            {pr.title}
          </span>
          {pr.draft ? <Badge tone="warning">Draft</Badge> : null}
          {pr.merged ? <Badge tone="accent">Merged</Badge> : null}
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-muted text-xs">
          <span className="font-mono text-faint">#{pr.number}</span>
          <span className="text-faint">·</span>
          <span className="truncate">{pr.repo}</span>
          <span className="text-faint">·</span>
          <Avatar name={pr.author} size={14} url={pr.authorAvatarUrl} />
          <span className="truncate">{pr.author}</span>
          {pr.commentsCount > 0 ? (
            <>
              <span className="text-faint">·</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono">
                <MessageSquare aria-hidden size={11} />
                {pr.commentsCount}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <span
        className="shrink-0 whitespace-nowrap font-mono text-[11px] text-faint"
        title={formatAbsolute(pr.updatedAt)}
      >
        {formatRelativeTime(pr.updatedAt)}
      </span>
    </div>
  );
}
