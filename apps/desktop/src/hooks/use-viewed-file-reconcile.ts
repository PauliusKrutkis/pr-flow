import { type Dispatch, type SetStateAction, useEffect } from "react";
import type { ChangedFile, PullRequest } from "../types.ts";

/** Marks files unviewed when the provider sends a newer head SHA than we recorded. */
export function useViewedFileReconcile(
  routeKey: string,
  pr: PullRequest | undefined,
  files: ChangedFile[],
  _viewedFiles: Record<string, string> | undefined,
  reconcileViewed: (
    key: string,
    nextFiles: ChangedFile[],
    headSha: string
  ) => string[],
  setChangedSinceViewed: Dispatch<SetStateAction<Set<string>>>,
  setToast: (toast: { title: string; message: string }) => void
): void {
  useEffect(() => {
    if (!pr || files.length === 0) {
      return;
    }
    const unviewed = reconcileViewed(routeKey, files, pr.headSha);
    if (unviewed.length > 0) {
      setChangedSinceViewed((prev) => {
        const next = new Set(prev);
        for (const f of unviewed) {
          next.add(f);
        }
        return next;
      });
      setToast({
        message:
          unviewed.length === 1
            ? `${unviewed[0]} changed since you viewed it — marked unviewed.`
            : `${unviewed.length} files changed since you viewed them — marked unviewed.`,
        title: "Pull request updated",
      });
    }
  }, [pr, files, routeKey, reconcileViewed, setToast, setChangedSinceViewed]);
}
