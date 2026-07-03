import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient, queryKeys } from "../lib/queryClient";
import { useAppStore } from "../store/appStore";
import type { PullRequestDetail, ReviewComment, ReviewEvent } from "../types";

// Comment mutations for a PR — OPTIMISTIC by design principle ("no loading
// states"): the comment appears in the cached detail the moment you act, the
// network reconciles in the background, and a failure rolls back + surfaces a
// flash message instead of ever blocking the UI.

let tempId = -1;

/** A best-effort local comment standing in until the server echoes the real one. */
function optimisticComment(c: {
  path: string;
  line: number | null;
  side: string;
  body: string;
  inReplyToId: number | null;
  /** Replies inherit their thread's handle/state so grouping stays intact. */
  threadId?: string | null;
  resolved?: boolean;
}): ReviewComment {
  const s = useAppStore.getState();
  const account = s.accounts.find((a) => a.id === s.activeAccountId);
  return {
    id: tempId--,
    path: c.path,
    line: c.line,
    originalLine: null,
    side: c.side,
    diffHunk: "",
    body: c.body,
    user: account?.login ?? "you",
    userAvatarUrl: account?.avatarUrl ?? "",
    createdAt: new Date().toISOString(),
    inReplyToId: c.inReplyToId,
    threadId: c.threadId ?? null,
    resolved: c.resolved ?? false,
  };
}

export function useCommentMutations(
  owner: string,
  repo: string,
  number: number,
) {
  const detailKey = queryKeys.prDetail(owner, repo, number);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: detailKey });

  const insertOptimistic = async (comment: ReviewComment) => {
    await queryClient.cancelQueries({ queryKey: detailKey });
    const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
    queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
      cur ? { ...cur, comments: [...cur.comments, comment] } : cur,
    );
    return before;
  };

  const rollback = (before: PullRequestDetail | undefined, what: string, e: unknown) => {
    if (before) queryClient.setQueryData(detailKey, before);
    useAppStore
      .getState()
      .setFlash(`${what} didn't post on ${owner}/${repo}#${number} — ${String(e)}`);
  };

  const addReviewComment = useMutation({
    mutationFn: (args: {
      body: string;
      commitId: string;
      path: string;
      line: number;
      side: string;
    }) => api.createReviewComment({ owner, repo, number, ...args }),
    onMutate: (args) =>
      insertOptimistic(
        optimisticComment({
          path: args.path,
          line: args.line,
          side: args.side,
          body: args.body,
          inReplyToId: null,
        }),
      ),
    onError: (e, _args, before) => rollback(before, "Comment", e),
    onSettled: invalidate,
  });

  const reply = useMutation({
    mutationFn: (args: { body: string; inReplyTo: number }) =>
      api.replyToReviewComment({ owner, repo, number, ...args }),
    onMutate: (args) => {
      // Anchor the optimistic reply under its thread root.
      const detail = queryClient.getQueryData<PullRequestDetail>(detailKey);
      const root = detail?.comments.find((c) => c.id === args.inReplyTo);
      return insertOptimistic(
        optimisticComment({
          path: root?.path ?? "",
          line: null,
          side: root?.side ?? "RIGHT",
          body: args.body,
          inReplyToId: args.inReplyTo,
          threadId: root?.threadId,
          resolved: root?.resolved,
        }),
      );
    },
    onError: (e, _args, before) => rollback(before, "Reply", e),
    onSettled: invalidate,
  });

  const addIssueComment = useMutation({
    mutationFn: (args: { body: string }) =>
      api.createIssueComment({ owner, repo, number, ...args }),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
      const s = useAppStore.getState();
      const account = s.accounts.find((a) => a.id === s.activeAccountId);
      queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
        cur
          ? {
              ...cur,
              issueComments: [
                ...(cur.issueComments ?? []),
                {
                  id: tempId--,
                  body: args.body,
                  user: account?.login ?? "you",
                  userAvatarUrl: account?.avatarUrl ?? "",
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : cur,
      );
      return before;
    },
    onError: (e, _args, before) => rollback(before, "Comment", e),
    onSettled: invalidate,
  });

  // Optimistic thread resolution: every comment carrying the thread's handle
  // flips at once (the state is mirrored across the thread), so the collapsed
  // card appears instantly; failure rolls the flip back with a flash.
  const resolveThread = useMutation({
    mutationFn: (args: { threadId: string; resolved: boolean }) =>
      api.resolveThread({ owner, repo, number, ...args }),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
      queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
        cur
          ? {
              ...cur,
              comments: cur.comments.map((c) =>
                c.threadId === args.threadId
                  ? { ...c, resolved: args.resolved }
                  : c,
              ),
            }
          : cur,
      );
      return before;
    },
    onError: (e, args, before) =>
      rollback(before, args.resolved ? "Resolve" : "Unresolve", e),
    onSettled: invalidate,
  });

  const submitReview = useMutation({
    mutationFn: (args: {
      event: ReviewEvent;
      body: string;
      commitId: string;
      comments: { path: string; line: number; side: string; body: string }[];
    }) => api.submitReview({ owner, repo, number, ...args }),
    onSettled: invalidate,
  });

  return { addReviewComment, reply, addIssueComment, resolveThread, submitReview };
}
