import { useMemo } from "react";
import { useInbox } from "../hooks/useInbox";
import { useAppStore } from "../store/appStore";
import { prKey, type PullRequest } from "../types";
import { SearchPane } from "./inbox/SearchPane";

/**
 * The global "/" PR search — jump to any pull request from any screen. Reads the
 * cached inbox (deduped across tabs) and opens the chosen PR. Mounted once at the
 * app root so it works on the inbox and inside a review alike.
 */
export function GlobalSearch() {
  const { data } = useInbox();
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const openReview = useAppStore((s) => s.openReview);
  const markSeen = useAppStore((s) => s.markSeen);
  const setSelectedKey = useAppStore((s) => s.setInboxSelectedKey);

  const allPrs = useMemo(() => {
    const seen = new Set<number>();
    const out: PullRequest[] = [];
    if (data) {
      for (const key of [
        "reviewRequested",
        "assigned",
        "created",
        "involved",
      ] as const) {
        for (const pr of data[key].prs) {
          if (!seen.has(pr.id)) {
            seen.add(pr.id);
            out.push(pr);
          }
        }
      }
    }
    return out;
  }, [data]);

  const openPR = (pr: PullRequest) => {
    const key = prKey({ owner: pr.owner, name: pr.name, number: pr.number });
    setSelectedKey(key);
    markSeen(key, pr.updatedAt);
    openReview(pr.owner, pr.name, pr.number);
  };

  return (
    <SearchPane
      open={searchOpen}
      onOpenChange={setSearchOpen}
      prs={allPrs}
      onOpen={openPR}
    />
  );
}
