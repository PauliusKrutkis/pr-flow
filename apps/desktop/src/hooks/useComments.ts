import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { queryClient, queryKeys } from "../lib/queryClient";
import type { ReviewEvent } from "../types";

/**
 * Comment mutations for a PR. Each refetches the PR detail on success so new
 * comments appear without a manual refresh.
 */
export function useCommentMutations(
  owner: string,
  repo: string,
  number: number,
) {
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.prDetail(owner, repo, number),
    });

  const addReviewComment = useMutation({
    mutationFn: (args: {
      body: string;
      commitId: string;
      path: string;
      line: number;
      side: string;
    }) => api.createReviewComment({ owner, repo, number, ...args }),
    onSuccess: invalidate,
  });

  const reply = useMutation({
    mutationFn: (args: { body: string; inReplyTo: number }) =>
      api.replyToReviewComment({ owner, repo, number, ...args }),
    onSuccess: invalidate,
  });

  const addIssueComment = useMutation({
    mutationFn: (args: { body: string }) =>
      api.createIssueComment({ owner, repo, number, ...args }),
    onSuccess: invalidate,
  });

  const submitReview = useMutation({
    mutationFn: (args: {
      event: ReviewEvent;
      body: string;
      commitId: string;
      comments: { path: string; line: number; side: string; body: string }[];
    }) => api.submitReview({ owner, repo, number, ...args }),
    onSuccess: invalidate,
  });

  return { addReviewComment, reply, addIssueComment, submitReview };
}
