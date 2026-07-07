import { useEffect, useRef } from "react";
import { usePerfStore } from "../lib/perf.ts";
import { updateReviewMemory } from "../lib/review-memory.ts";
import type { PullRequest } from "../types.ts";

/** Tracks head SHA changes for perf + memory and nudges when the PR updates. */
export function useReviewHeadShaSync(
  routeKey: string,
  pr: PullRequest | undefined,
  setToast: (toast: { title: string; message: string }) => void
): void {
  const mountShaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pr) {
      return;
    }
    const seen = mountShaRef.current;
    if (!seen) {
      usePerfStore.getState().completeOpen();
      mountShaRef.current = pr.headSha;
      updateReviewMemory(routeKey, { headSha: pr.headSha });
      return;
    }
    if (pr.headSha && pr.headSha !== seen) {
      mountShaRef.current = pr.headSha;
      updateReviewMemory(routeKey, { headSha: pr.headSha });
      setToast({
        message: "Showing the latest changes.",
        title: "Pull request updated",
      });
    }
  }, [pr, routeKey, setToast]);
}
