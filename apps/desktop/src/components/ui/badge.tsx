import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type Tone = "default" | "accent" | "success" | "danger" | "warning" | "muted";

/** Map tones onto the shared Quiet pill variants. */
const toneClasses: Record<Tone, string> = {
  accent: "q-pill-commented",
  danger: "q-pill-changes",
  default: "q-pill-muted",
  muted: "q-pill-muted",
  success: "q-pill-open",
  warning: "q-pill-draft",
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
    <span className={cn("q-pill", toneClasses[tone], className)}>
      {children}
    </span>
  );
}
