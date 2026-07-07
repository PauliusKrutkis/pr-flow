import { useEffect, useRef } from "react";
import { queryClient, queryKeys } from "../lib/query-client.ts";
import type { InboxBucket, PullRequest } from "../types.ts";
import { parsePrKey, prKey } from "../types.ts";
import { useInbox } from "./use-inbox.ts";

/**
 * When the inbox heartbeat shows this PR moved ahead of the cached detail,
 * invalidate the detail query so ReviewScreen picks up the newer revision.
 */
export function useInboxDetailNudge(
  keyValue: string,
  pr: PullRequest | undefined
): void {
  const { data: inboxHeartbeat } = useInbox();
  const nudgedForRef = useRef("");

  useEffect(() => {
    if (!pr) {
      return;
    }
    const buckets = inboxHeartbeat
      ? [
          inboxHeartbeat.reviewRequested,
          inboxHeartbeat.assigned,
          inboxHeartbeat.created,
          inboxHeartbeat.involved,
        ]
      : [];
    const subscribed = queryClient.getQueryData<InboxBucket>(
      queryKeys.subscribed
    );
    if (subscribed) {
      buckets.push(subscribed);
    }
    const hit = buckets
      .flatMap((b) => b.prs)
      .find((p) => prKey(p) === keyValue);
    if (
      hit &&
      hit.updatedAt > pr.updatedAt &&
      nudgedForRef.current !== hit.updatedAt
    ) {
      nudgedForRef.current = hit.updatedAt;
      const ref = parsePrKey(keyValue);
      queryClient.invalidateQueries({
        queryKey: queryKeys.prDetail(ref.owner, ref.name, ref.number),
      });
    }
  }, [inboxHeartbeat, pr, keyValue]);
}
