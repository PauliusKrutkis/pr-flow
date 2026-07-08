import { useEffect, useRef, useState } from "react";
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
  setChangedSinceViewed: React.Dispatch<React.SetStateAction<Set<string>>>,
  setToast: (toast: { title: string; message: string }) => void
): void {
  const viewedFiles = useAppStore((s) => s.viewed[routeKey]);
  const [lastReconcileKey, setLastReconcileKey] = useState<string | null>(null);
  const unviewedRef = useRef<string[]>([]);

  const preview =
    pr && files.length > 0
      ? reconcileViewedEntry(viewedFiles, files, pr.headSha)
      : null;
  const unviewed = preview ? preview.unviewed : [];
  const reconcileKey =
    pr && preview?.changed && unviewed.length > 0
      ? `${routeKey}\0${pr.headSha}\0${unviewed.join("\0")}`
      : null;

  useEffect(() => {
    if (!reconcileKey || reconcileKey === lastReconcileKey) {
      return;
    }
    unviewedRef.current = unviewed;
    setLastReconcileKey(reconcileKey);
    setChangedSinceViewed((prev) => {
      const next = new Set(prev);
      for (const f of unviewedRef.current) {
        next.add(f);
      }
      return next;
    });
    setToast(unviewedToastMessage(unviewedRef.current));
  }, [
    reconcileKey,
    lastReconcileKey,
    unviewed,
    setChangedSinceViewed,
    setToast,
  ]);

  useEffect(() => {
    if (!(reconcileKey && pr)) {
      return;
    }
    reconcileViewed(routeKey, files, pr.headSha);
  }, [reconcileKey, routeKey, files, pr, reconcileViewed]);
}
