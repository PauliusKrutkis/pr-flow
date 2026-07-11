import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api.ts";
import { queryClient, queryKeys } from "../lib/query-client.ts";
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
      .catch(() => undefined);
  }, []);

  return useQuery({
    queryFn: () => api.listInbox(),
    queryKey: queryKeys.inbox,
    // Conditional (ETag) requests in the Rust backend answer most polls with a
    // rate-limit-free 304, so we can poll far more often than the old 60s.
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
