import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api.ts";
import { queryClient, queryKeys } from "../lib/queryClient.ts";
import type { InboxData } from "../types.ts";

/**
 * The whole inbox (all four tabs + counts) in a single GraphQL request. Seeds
 * from the on-disk cache for an instant first paint, then refetches in the
 * background every 60s and on window focus.
 */
export function useInbox() {
  useEffect(() => {
    api
      .getCachedInbox()
      .then((data) => {
        if (data) {
          queryClient.setQueryData<InboxData>(
            queryKeys.inbox,
            (cur) => cur ?? data
          );
        }
      })
      .catch(() => {});
  }, []);

  return useQuery({
    queryFn: () => api.listInbox(),
    queryKey: queryKeys.inbox,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
