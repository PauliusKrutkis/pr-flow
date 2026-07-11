import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Loader, X } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import type { CiStatus } from "../../types.ts";

/**
 * Header CI/pipeline pill: one glanceable icon + count, colour-matched to the
 * approvals verdict language (green pass, red fail, muted running). Renders
 * nothing when `state: "none"` so repos without CI stay quiet. Clicking opens
 * the checks page (or the first failing run) on the host.
 */
export function CiPill({ ci }: { ci: CiStatus | undefined }) {
  if (!ci || ci.state === "none") {
    return null;
  }
  const meta = PILL[ci.state];
  const count = ci.state === "failure" ? `${ci.failed}/${ci.total}` : ci.total;
  const open = () => {
    if (ci.url) {
      openUrl(ci.url);
    }
  };
  return (
    <button
      className={cn("qf-ci", meta.className)}
      onClick={open}
      title={`${meta.label} · ${ci.total} check${ci.total === 1 ? "" : "s"}`}
      type="button"
    >
      {meta.icon}
      <span className="qf-ci-count">{count}</span>
    </button>
  );
}

const PILL: Record<
  Exclude<CiStatus["state"], "none">,
  { className: string; icon: React.ReactNode; label: string }
> = {
  failure: {
    className: "qf-ci-failure",
    icon: <X aria-hidden size={12} strokeWidth={2.75} />,
    label: "Checks failing",
  },
  pending: {
    className: "qf-ci-pending",
    icon: <Loader aria-hidden size={12} strokeWidth={2.5} />,
    label: "Checks running",
  },
  success: {
    className: "qf-ci-success",
    icon: <Check aria-hidden size={12} strokeWidth={2.75} />,
    label: "Checks passing",
  },
};
