// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api.ts";
import { queryClient, queryKeys } from "../lib/query-client.ts";
import type { PullRequestDetail } from "../types.ts";

/**
 * Detail freshness window. The consuming query and the prefetch must share this
 * so a warmed PR opens without an on-mount refetch; it also sets the background
 * refetch cadence.
 */
const PR_DETAIL_STALE_MS = 60_000;

/**
 * Full PR detail (metadata + files + review comments). Seeds from the on-disk
 * cache so opening a PR is instant, then refetches in the background.
 */
export function usePullRequestDetail(
  owner: string,
  repo: string,
  number: number
) {
  useEffect(() => {
    let cancelled = false;
    api
      .getCachedPullRequestDetail(owner, repo, number)
      .then((detail) => {
        if (!cancelled && detail) {
          queryClient.setQueryData<PullRequestDetail>(
            queryKeys.prDetail(owner, repo, number),
            (cur) => cur ?? detail
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [owner, repo, number]);

  return useQuery({
    queryFn: () => api.getPullRequestDetail(owner, repo, number),
    queryKey: queryKeys.prDetail(owner, repo, number),
    refetchInterval: PR_DETAIL_STALE_MS,
    refetchOnWindowFocus: true,
    staleTime: PR_DETAIL_STALE_MS,
  });
}

/**
 * Warm a PR's detail into the cache ahead of opening it. `prefetchQuery` skips
 * the network if the data was fetched within `staleTime`, and TanStack Query
 * dedupes concurrent identical requests — so this stays cheap and rate-limit
 * friendly even when called on every selection change / hover.
 */
export function prefetchPullRequest(
  owner: string,
  repo: string,
  number: number
): void {
  const key = queryKeys.prDetail(owner, repo, number);
  if (!queryClient.getQueryData(key)) {
    api
      .getCachedPullRequestDetail(owner, repo, number)
      .then((detail) => {
        if (detail) {
          queryClient.setQueryData<PullRequestDetail>(
            key,
            (cur) => cur ?? detail
          );
        }
      })
      .catch(() => undefined);
  }
  queryClient.prefetchQuery({
    queryFn: () => api.getPullRequestDetail(owner, repo, number),
    queryKey: key,
    staleTime: PR_DETAIL_STALE_MS,
  });
}
