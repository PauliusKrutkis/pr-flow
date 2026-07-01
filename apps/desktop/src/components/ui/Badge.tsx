import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type Tone = "default" | "accent" | "success" | "danger" | "warning" | "muted";

/** Map tones onto the shared Quiet pill variants. */
const toneClasses: Record<Tone, string> = {
  default: "q-pill-muted",
  accent: "q-pill-commented",
  success: "q-pill-open",
  danger: "q-pill-changes",
  warning: "q-pill-draft",
  muted: "q-pill-muted",
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
    <span className={cn("q-pill", toneClasses[tone], className)}>{children}</span>
  );
}
