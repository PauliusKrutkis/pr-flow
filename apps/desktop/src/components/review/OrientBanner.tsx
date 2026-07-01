import { GitPullRequestArrow, X } from "lucide-react";
import { cn } from "../../lib/cn";

// A slim, inset banner at the top of the diff area. Two uses:
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
        "qb-banner mx-6 my-2 shrink-0",
        tone === "update" ? "qb-banner-update" : "qb-banner-info",
      )}
      role="status"
    >
      <span className="qb-banner-icon">
        <GitPullRequestArrow size={15} aria-hidden />
      </span>
      <span className="qb-banner-text">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="qb-x q-focus"
          aria-label="Dismiss"
        >
          <X size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}
