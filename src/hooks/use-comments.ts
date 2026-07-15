import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { api } from "../lib/api.ts";
import { queryClient, queryKeys } from "../lib/query-client.ts";
import { useAppStore } from "../store/app-store.ts";
import type {
  PullRequestDetail,
  ReviewComment,
  ReviewEvent,
} from "../types.ts";

/**
 * Comment mutations for a PR — OPTIMISTIC by design principle ("no loading
 * states"): the comment appears in the cached detail the moment you act, the
 * network reconciles in the background, and a failure rolls back + surfaces a
 * flash message instead of ever blocking the UI.
 */

let tempId = -1;

function nextTempId(): number {
  const id = tempId;
  tempId -= 1;
  return id;
}

type DetailSnapshot = PullRequestDetail | undefined;

function optimisticComment(c: {
  path: string;
  line: number | null;
  side: string;
  body: string;
  inReplyToId: number | null;
  threadId?: string | null;
  resolved?: boolean;
}): ReviewComment {
  const s = useAppStore.getState();
  const account = s.accounts.find((a) => a.id === s.activeAccountId);
  const id = nextTempId();
  return {
    body: c.body,
    createdAt: new Date().toISOString(),
    diffHunk: "",
    id,
    inReplyToId: c.inReplyToId,
    line: c.line,
    originalLine: null,
    path: c.path,
    resolved: c.resolved ?? false,
    side: c.side,
    threadId: c.threadId ?? null,
    user: account?.login ?? "you",
    userAvatarUrl: account?.avatarUrl ?? "",
  };
}

export function useCommentMutations(
  owner: string,
  repo: string,
  number: number
) {
  const detailKey = queryKeys.prDetail(owner, repo, number);

  const insertOptimistic = async (comment: ReviewComment) => {
    await queryClient.cancelQueries({ queryKey: detailKey });
    const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
    queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
      cur ? { ...cur, comments: [...cur.comments, comment] } : cur
    );
    return before;
  };

  const rollback = (
    before: PullRequestDetail | undefined,
    what: string,
    e: unknown
  ) => {
    if (before) {
      queryClient.setQueryData(detailKey, before);
    }
    useAppStore
      .getState()
      .setFlash(
        `${what} didn't post on ${owner}/${repo}#${number} — ${String(e)}`
      );
  };

  const addReviewComment = useMutation<
    ReviewComment,
    Error,
    {
      body: string;
      commitId: string;
      path: string;
      line: number;
      side: string;
      startLine?: number;
    },
    DetailSnapshot
  >({
    mutationFn: (args: {
      body: string;
      commitId: string;
      path: string;
      line: number;
      side: string;
      startLine?: number;
    }) => api.createReviewComment({ number, owner, repo, ...args }),
    onError: (e, _args, before) => rollback(before, "Comment", e),
    onMutate: (args) =>
      insertOptimistic(
        optimisticComment({
          body: args.body,
          inReplyToId: null,
          line: args.line,
          path: args.path,
          side: args.side,
        })
      ),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const reply = useMutation<
    ReviewComment,
    Error,
    { body: string; inReplyTo: number },
    DetailSnapshot
  >({
    mutationFn: (args: { body: string; inReplyTo: number }) =>
      api.replyToReviewComment({ number, owner, repo, ...args }),
    onError: (e, _args, before) => rollback(before, "Reply", e),
    onMutate: (args) => {
      const detail = queryClient.getQueryData<PullRequestDetail>(detailKey);
      const root = detail?.comments.find((c) => c.id === args.inReplyTo);
      return insertOptimistic(
        optimisticComment({
          body: args.body,
          inReplyToId: args.inReplyTo,
          line: null,
          path: root?.path ?? "",
          resolved: root?.resolved,
          side: root?.side ?? "RIGHT",
          threadId: root?.threadId,
        })
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const addIssueComment = useMutation<
    void,
    Error,
    { body: string },
    DetailSnapshot
  >({
    mutationFn: (args: { body: string }) =>
      api.createIssueComment({ number, owner, repo, ...args }),
    onError: (e, _args, before) => rollback(before, "Comment", e),
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
                  body: args.body,
                  createdAt: new Date().toISOString(),
                  id: nextTempId(),
                  user: account?.login ?? "you",
                  userAvatarUrl: account?.avatarUrl ?? "",
                },
              ],
            }
          : cur
      );
      return before;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const deleteReviewComment = useMutation<
    void,
    Error,
    { commentId: number },
    DetailSnapshot
  >({
    mutationFn: (args: { commentId: number }) =>
      api.deleteReviewComment({ number, owner, repo, ...args }),
    onError: (e, _args, before) => rollback(before, "Delete", e),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
      queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
        cur
          ? {
              ...cur,
              comments: cur.comments.filter((c) => c.id !== args.commentId),
            }
          : cur
      );
      return before;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const updateReviewComment = useMutation<
    void,
    Error,
    { commentId: number; body: string },
    DetailSnapshot
  >({
    mutationFn: (args: { commentId: number; body: string }) =>
      api.updateReviewComment({ number, owner, repo, ...args }),
    onError: (e, _args, before) => rollback(before, "Edit", e),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
      queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
        cur
          ? {
              ...cur,
              comments: cur.comments.map((c) =>
                c.id === args.commentId ? { ...c, body: args.body } : c
              ),
            }
          : cur
      );
      return before;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const updateIssueComment = useMutation<
    void,
    Error,
    { commentId: number; body: string },
    DetailSnapshot
  >({
    mutationFn: (args: { commentId: number; body: string }) =>
      api.updateIssueComment({ number, owner, repo, ...args }),
    onError: (e, _args, before) => rollback(before, "Edit", e),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
      queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
        cur
          ? {
              ...cur,
              issueComments: (cur.issueComments ?? []).map((c) =>
                c.id === args.commentId ? { ...c, body: args.body } : c
              ),
            }
          : cur
      );
      return before;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const deleteIssueComment = useMutation<
    void,
    Error,
    { commentId: number },
    DetailSnapshot
  >({
    mutationFn: (args: { commentId: number }) =>
      api.deleteIssueComment({ number, owner, repo, ...args }),
    onError: (e, _args, before) => rollback(before, "Delete", e),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
      queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
        cur
          ? {
              ...cur,
              issueComments: (cur.issueComments ?? []).filter(
                (c) => c.id !== args.commentId
              ),
            }
          : cur
      );
      return before;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const resolveIntentRef = useRef(new Map<string, boolean>());
  const resolveInflightRef = useRef<string | null>(null);

  const patchThreadResolved = (threadId: string, resolved: boolean) => {
    queryClient.setQueryData<PullRequestDetail>(detailKey, (cur) =>
      cur
        ? {
            ...cur,
            comments: cur.comments.map((c) =>
              c.threadId === threadId ? { ...c, resolved } : c
            ),
          }
        : cur
    );
  };

  const flushResolveIntents = () => {
    if (resolveInflightRef.current !== null) {
      return;
    }
    const detail = queryClient.getQueryData<PullRequestDetail>(detailKey);
    if (!detail) {
      return;
    }
    for (const [threadId, intent] of resolveIntentRef.current) {
      const current = detail.comments.find(
        (c) => c.threadId === threadId
      )?.resolved;
      if (current !== undefined && current !== intent) {
        resolveInflightRef.current = threadId;
        resolveThread.mutate({ resolved: intent, threadId });
        return;
      }
    }
  };

  const requestResolveThread = (args: {
    threadId: string;
    resolved: boolean;
  }) => {
    resolveIntentRef.current.set(args.threadId, args.resolved);
    patchThreadResolved(args.threadId, args.resolved);
    if (resolveInflightRef.current !== null) {
      return;
    }
    resolveInflightRef.current = args.threadId;
    resolveThread.mutate(args);
  };

  const resolveThread = useMutation<
    void,
    Error,
    { threadId: string; resolved: boolean },
    DetailSnapshot
  >({
    mutationFn: (args: { threadId: string; resolved: boolean }) =>
      api.resolveThread({ number, owner, repo, ...args }),
    onError: (e, args, before) =>
      rollback(before, args.resolved ? "Resolve" : "Unresolve", e),
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: detailKey });
      const before = queryClient.getQueryData<PullRequestDetail>(detailKey);
      patchThreadResolved(args.threadId, args.resolved);
      return before;
    },
    onSettled: () => {
      resolveInflightRef.current = null;
      queryClient.invalidateQueries({ queryKey: detailKey });
      flushResolveIntents();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  const submitReview = useMutation({
    mutationFn: (args: {
      event: ReviewEvent;
      body: string;
      commitId: string;
      comments: { path: string; line: number; side: string; body: string }[];
    }) => api.submitReview({ number, owner, repo, ...args }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: detailKey });
    },
  });

  return {
    addIssueComment,
    addReviewComment,
    deleteIssueComment,
    deleteReviewComment,
    reply,
    requestResolveThread,
    resolveThread,
    submitReview,
    updateIssueComment,
    updateReviewComment,
  };
}
