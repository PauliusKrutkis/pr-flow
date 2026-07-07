import { QueryClient } from "@tanstack/react-query";

/**
 * Single app-wide query client. Defaults lean cache-first: data is considered
 * fresh briefly, refetched in the background on an interval and on window
 * focus (see the data hooks), so the UI paints instantly from cache and
 * reconciles quietly.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

export const queryKeys = {
  currentUser: ["currentUser"] as const,
  inbox: ["inbox"] as const,
  prDetail: (owner: string, repo: string, number: number) =>
    ["pr", owner, repo, number] as const,
  subscribed: ["subscribed"] as const,
  watchedRepos: ["watchedRepos"] as const,
};
