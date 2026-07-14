import type { ReleaseInfo } from "../types.ts";
import { api } from "./api.ts";

const CACHE_KEY = "pr-flow:releases:v1";

function readCache(): ReleaseInfo[] | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ReleaseInfo[]) : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(releases: ReleaseInfo[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(releases));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

/**
 * One releases fetch serves both the what's-new card and the release-history
 * view: sharing the query options means React Query dedupes the network call.
 * The last good response is mirrored to localStorage and replayed as
 * `initialData`, so a cold launch renders the timeline instantly (no spinner)
 * while a silent background refetch pulls anything new. `null` data = the fetch
 * failed with no cache to fall back on (first run, offline); callers stay quiet.
 */
export const releasesQuery = {
  initialData: readCache,
  initialDataUpdatedAt: 0,
  queryFn: async (): Promise<ReleaseInfo[] | null> => {
    const fresh = await api.listReleases();
    if (fresh) {
      writeCache(fresh);
      return fresh;
    }
    return readCache() ?? null;
  },
  queryKey: ["releases"],
  refetchOnWindowFocus: false,
  staleTime: 30 * 60 * 1000,
};

const LEADING_V = /^v/;

/**
 * Numeric version compare, tolerant of a leading `v` and unequal lengths:
 * "v1.10.0" > "1.9.3". Returns <0, 0 or >0 like a sort comparator.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .replace(LEADING_V, "")
      .split(".")
      .map((p) => Number.parseInt(p, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

/**
 * The releases a user skipped past: everything after the version they last
 * ran, up to and including the one running now. Newest first, so the card
 * reads like a changelog. An update from 1.2 straight to 1.5 shows 1.3 and
 * 1.4 too — notes shouldn't vanish just because an update was skipped.
 */
export function releasesSince(
  releases: ReleaseInfo[],
  lastRun: string,
  current: string
): ReleaseInfo[] {
  return releases
    .filter(
      (r) =>
        compareVersions(r.tag, lastRun) > 0 &&
        compareVersions(r.tag, current) <= 0
    )
    .sort((a, b) => compareVersions(b.tag, a.tag));
}
