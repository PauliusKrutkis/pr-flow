import { useEffect, useRef } from "react";
import { reconcileViewedEntry } from "../lib/viewed-fingerprint.ts";
import { useAppStore } from "../store/app-store.ts";
import type { ChangedFile, PullRequest } from "../types.ts";

function unviewedToastMessage(unviewed: readonly string[]): {
  message: string;
  title: string;
} {
  return {
    message:
      unviewed.length === 1
        ? `${unviewed[0]} changed since you viewed it — marked unviewed.`
        : `${unviewed.length} files changed since you viewed them — marked unviewed.`,
    title: "Pull request updated",
  };
}

/** Marks files unviewed when the provider sends a newer head SHA than we recorded. */
export function useViewedFileReconcile(
  routeKey: string,
  pr: PullRequest | undefined,
  files: ChangedFile[],
  reconcileViewed: (
    key: string,
    nextFiles: ChangedFile[],
    headSha: string
  ) => string[],
  setToast: (toast: { title: string; message: string }) => void
): void {
  const viewedFiles = useAppStore((s) => s.viewed[routeKey]);
  const appliedRef = useRef<string | null>(null);

  const preview =
    pr && files.length > 0
      ? reconcileViewedEntry(viewedFiles, files, pr.headSha)
      : null;
  const reconcileKey =
    pr && preview?.changed && preview.unviewed.length > 0
      ? `${routeKey}\0${pr.headSha}\0${preview.unviewed.join("\0")}`
      : null;

  useEffect(() => {
    if (!(reconcileKey && pr)) {
      return;
    }
    if (reconcileKey === appliedRef.current) {
      return;
    }
    appliedRef.current = reconcileKey;
    const unviewed = reconcileViewed(routeKey, files, pr.headSha);
    if (unviewed.length > 0) {
      setToast(unviewedToastMessage(unviewed));
    }
  }, [reconcileKey, routeKey, files, pr, reconcileViewed, setToast]);
}
