import { cn } from "../../lib/cn";

// A slim, one-line banner at the top of the diff area. Two uses:
//  • orient ("3 files changed · +120 −8") shown briefly when a PR opens
//  • update ("This PR changed while you were reviewing") when the head moves
// Skipped entirely when there's nothing worth saying (ReviewScreen decides).

export function OrientBanner({
  message,
  tone = "info",
  onDismiss,
}: {
  message: string;
  tone?: "info" | "update";
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-b px-3 py-1.5 text-xs",
        tone === "update"
          ? "border-accent/30 bg-accent/10 text-accent"
          : "border-line bg-elevated/60 text-muted",
      )}
    >
      <span className="min-w-0 truncate">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded px-1.5 py-0.5 text-faint hover:bg-elevated hover:text-fg"
          aria-label="Dismiss"
        >
          ✕
        </button>
      )}
    </div>
  );
}
