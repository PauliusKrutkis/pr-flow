import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api.ts";
import { queryClient, queryKeys } from "../lib/query-client.ts";
import type { InboxBucket } from "../types.ts";

/**
 * Open PRs across the watched repositories (the "Watching" tab). Seeds from
 * the on-disk cache for an instant first paint, then refetches in the
 * background — same cadence as the inbox.
 */
export function useSubscribed() {
  useEffect(() => {
    api
      .getCachedSubscribed()
      .then((data) => {
        if (data) {
          queryClient.setQueryData<InboxBucket>(
            queryKeys.subscribed,
            (cur) => cur ?? data
          );
        }
      })
      .catch(() => undefined);
  }, []);

  return useQuery({
    queryFn: () => api.listSubscribed(),
    queryKey: queryKeys.subscribed,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** The watched-repo list itself (for the manage dialog). */
export function useWatchedRepos() {
  return useQuery({
    queryFn: () => api.getWatchedRepos(),
    queryKey: queryKeys.watchedRepos,
    staleTime: Number.POSITIVE_INFINITY,
  });
}
