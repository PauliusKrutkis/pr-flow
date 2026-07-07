import { useCallback, useMemo } from "react";
import { useInbox } from "../hooks/use-inbox.ts";
import { useSubscribed } from "../hooks/use-subscribed.ts";
import { useAppStore } from "../store/app-store.ts";
import { type PullRequest, prKey } from "../types.ts";
import { SearchPane } from "./inbox/search-pane.tsx";

/**
 * The global "/" PR search — jump to any pull request from any screen. Reads the
 * cached inbox plus the watched-repos bucket (deduped across tabs) and opens the
 * chosen PR. Mounted once at the app root so it works on the inbox and inside a
 * review alike.
 */
export function GlobalSearch() {
  const { data } = useInbox();
  const { data: subscribed } = useSubscribed();
  const searchOpen = useAppStore((s) => s.searchOpen);
  const setSearchOpen = useAppStore((s) => s.setSearchOpen);
  const openReview = useAppStore((s) => s.openReview);
  const markSeen = useAppStore((s) => s.markSeen);
  const setSelectedKey = useAppStore((s) => s.setInboxSelectedKey);

  const allPrs = useMemo(() => {
    const seen = new Set<string>();
    const out: PullRequest[] = [];
    const add = (pr: PullRequest) => {
      const key = prKey(pr);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(pr);
      }
    };
    if (data) {
      for (const key of [
        "reviewRequested",
        "assigned",
        "created",
        "involved",
      ] as const) {
        for (const pr of data[key].prs) {
          add(pr);
        }
      }
    }
    for (const pr of subscribed?.prs ?? []) {
      add(pr);
    }
    return out;
  }, [data, subscribed]);

  const openPR = useCallback(
    (pr: PullRequest) => {
      const key = prKey({ name: pr.name, number: pr.number, owner: pr.owner });
      setSelectedKey(key);
      markSeen(key, pr.updatedAt);
      openReview(pr.owner, pr.name, pr.number);
    },
    [setSelectedKey, markSeen, openReview]
  );

  return (
    <SearchPane
      onOpen={openPR}
      onOpenChange={setSearchOpen}
      open={searchOpen}
      prs={allPrs}
    />
  );
}
