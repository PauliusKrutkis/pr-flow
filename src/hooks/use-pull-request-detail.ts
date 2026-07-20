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

const SNAPSHOT_TRIGGER_DELAY_MS = 800;

/**
 * Full PR detail (metadata + files + review comments). Seeds from the on-disk
 * cache so opening a PR is instant, then refetches in the background.
 *
 * Opening a PR also kicks off a repo snapshot at its head SHA (BACKLOG §9).
 * The result is never awaited or rendered, and failures are ignored by design —
 * a missing snapshot just means blobs come from the host, exactly as before.
 * Rust owns readiness and dedupes concurrent requests for a SHA, so re-firing
 * on remount or after a background refetch costs one IPC call.
 *
 * The trigger is delayed rather than fired on data arrival. "Fire-and-forget"
 * is not free: issued during the commit that opens the PR, even one IPC call
 * competes with the first paint of a large diff and measurably slowed warm
 * opens (197ms → 276ms against a 300ms budget). Waiting costs nothing real —
 * the download takes seconds, so starting it a beat later does not move when
 * the snapshot becomes ready. Same reasoning as the blob prefetch delay in
 * use-file-expansion.ts.
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

  const query = useQuery({
    queryFn: () => api.getPullRequestDetail(owner, repo, number),
    queryKey: queryKeys.prDetail(owner, repo, number),
    refetchInterval: PR_DETAIL_STALE_MS,
    refetchOnWindowFocus: true,
    staleTime: PR_DETAIL_STALE_MS,
  });

  const headSha = query.data?.pr.headSha ?? "";
  useEffect(() => {
    if (headSha === "") {
      return;
    }
    const timer = setTimeout(() => {
      api.ensureRepoSnapshot(owner, repo, headSha).catch(() => undefined);
    }, SNAPSHOT_TRIGGER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [owner, repo, headSha]);

  return query;
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
