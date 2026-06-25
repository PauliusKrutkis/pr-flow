import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "default" | "accent" | "success" | "danger" | "warning" | "muted";

const toneClasses: Record<Tone, string> = {
  default: "bg-elevated text-fg border border-line",
  accent: "bg-accent/15 text-accent border border-accent/30",
  success: "bg-success/15 text-success border border-success/30",
  danger: "bg-danger/15 text-danger border border-danger/30",
  warning: "bg-warning/15 text-warning border border-warning/30",
  muted: "bg-surface-2 text-muted border border-line",
};

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-none",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
