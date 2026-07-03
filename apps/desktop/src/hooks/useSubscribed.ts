import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient, queryKeys } from "../lib/queryClient";
import type { InboxBucket } from "../types";

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
            (cur) => cur ?? data,
          );
        }
      })
      .catch(() => {});
  }, []);

  return useQuery({
    queryKey: queryKeys.subscribed,
    queryFn: () => api.listSubscribed(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** The watched-repo list itself (for the manage dialog). */
export function useWatchedRepos() {
  return useQuery({
    queryKey: queryKeys.watchedRepos,
    queryFn: () => api.getWatchedRepos(),
    staleTime: Infinity,
  });
}
