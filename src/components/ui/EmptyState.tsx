import type { ReactNode } from "react";

export function EmptyState({
  title,
  hint,
  icon,
}: {
  title: string;
  hint?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-muted">
      {icon ? <div className="text-3xl text-faint">{icon}</div> : null}
      <div className="text-sm font-medium text-fg">{title}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
}
