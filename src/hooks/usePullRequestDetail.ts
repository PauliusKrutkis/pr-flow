import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient, queryKeys } from "../lib/queryClient";
import type { PullRequestDetail } from "../types";

/**
 * Full PR detail (metadata + files + review comments). Seeds from the on-disk
 * cache so opening a PR is instant, then refetches in the background.
 */
export function usePullRequestDetail(
  owner: string,
  repo: string,
  number: number,
) {
  useEffect(() => {
    let cancelled = false;
    api
      .getCachedPullRequestDetail(owner, repo, number)
      .then((detail) => {
        if (!cancelled && detail) {
          queryClient.setQueryData<PullRequestDetail>(
            queryKeys.prDetail(owner, repo, number),
            (cur) => cur ?? detail,
          );
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [owner, repo, number]);

  return useQuery({
    queryKey: queryKeys.prDetail(owner, repo, number),
    queryFn: () => api.getPullRequestDetail(owner, repo, number),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
}
