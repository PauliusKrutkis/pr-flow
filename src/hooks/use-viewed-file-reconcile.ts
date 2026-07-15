import { useEffect, useRef } from "react";
import { reconcileViewedEntry } from "../lib/viewed-fingerprint.ts";
import { useAppStore } from "../store/app-store.ts";
import type { ChangedFile, PullRequest } from "../types.ts";

/** Marks files unviewed when the provider sends a newer head SHA than we recorded. */
export function useViewedFileReconcile(
  routeKey: string,
  pr: PullRequest | undefined,
  files: ChangedFile[],
  reconcileViewed: (
    key: string,
    nextFiles: ChangedFile[],
    headSha: string
  ) => string[]
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
    reconcileViewed(routeKey, files, pr.headSha);
  }, [reconcileKey, routeKey, files, pr, reconcileViewed]);
}
