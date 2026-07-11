import type { ReviewSummary } from "../types.ts";

export interface Reviewer {
  user: string;
  userAvatarUrl: string;
}

export interface ReviewVerdicts {
  approved: Reviewer[];
  changesRequested: Reviewer[];
}

const VERDICT_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]);

/**
 * Collapse a PR's review timeline into the two verdicts GitHub shows: who
 * currently approves and who currently requests changes. Matches host
 * semantics — each reviewer counts once by their latest *verdict* review;
 * a later `COMMENTED` (or `PENDING`) does not clear an earlier `APPROVED`,
 * and a `DISMISSED` review drops that reviewer from the tally entirely.
 * Reviewers keep the submit order of their latest verdict.
 */
export function aggregateReviewVerdicts(
  reviews: ReviewSummary[]
): ReviewVerdicts {
  const latest = new Map<string, ReviewSummary>();
  for (const review of reviews) {
    if (!VERDICT_STATES.has(review.state)) {
      continue;
    }
    const prev = latest.get(review.user);
    if (!prev || prev.submittedAt.localeCompare(review.submittedAt) <= 0) {
      latest.set(review.user, review);
    }
  }

  const verdicts = [...latest.values()].sort((a, b) =>
    a.submittedAt.localeCompare(b.submittedAt)
  );
  const approved: Reviewer[] = [];
  const changesRequested: Reviewer[] = [];
  for (const review of verdicts) {
    const reviewer = { user: review.user, userAvatarUrl: review.userAvatarUrl };
    if (review.state === "APPROVED") {
      approved.push(reviewer);
    } else if (review.state === "CHANGES_REQUESTED") {
      changesRequested.push(reviewer);
    }
  }
  return { approved, changesRequested };
}
