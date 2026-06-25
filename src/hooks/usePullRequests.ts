import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient, queryKeys } from "../lib/queryClient";
import type { PullRequest } from "../types";

/**
 * Review-requested PRs. Seeds from the on-disk cache for an instant first
 * paint, then refetches in the background every 60s and on window focus.
 */
export function usePullRequests() {
  useEffect(() => {
    api
      .getCachedPrs()
      .then((prs) => {
        if (prs && prs.length) {
          queryClient.setQueryData<PullRequest[]>(
            queryKeys.prs,
            (cur) => cur ?? prs,
          );
        }
      })
      .catch(() => {});
  }, []);

  return useQuery({
    queryKey: queryKeys.prs,
    queryFn: () => api.listReviewRequested(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
