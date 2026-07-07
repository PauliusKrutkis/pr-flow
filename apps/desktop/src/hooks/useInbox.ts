import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient, queryKeys } from "../lib/queryClient";
import type { InboxData } from "../types";

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
          queryClient.setQueryData<InboxData>(queryKeys.inbox, (cur) => cur ?? data);
        }
      })
      .catch(() => {});
  }, []);

  return useQuery({
    queryKey: queryKeys.inbox,
    queryFn: () => api.listInbox(),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
}
