import { cn } from "../../lib/cn";

export function Spinner({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-2 text-muted", className)}>
      <span
        className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line border-t-accent"
        aria-hidden="true"
      />
      {label ? <span className="text-sm">{label}</span> : null}
    </div>
  );
}
