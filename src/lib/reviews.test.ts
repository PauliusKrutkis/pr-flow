import { describe, expect, it } from "vitest";
import type { ReviewSummary } from "../types.ts";
import { aggregateReviewVerdicts } from "./reviews.ts";

function review(
  over: Partial<ReviewSummary> & { user: string }
): ReviewSummary {
  return {
    body: "",
    id: Math.random(),
    state: "COMMENTED",
    submittedAt: "2026-07-01T00:00:00Z",
    userAvatarUrl: "",
    ...over,
  };
}

describe("aggregateReviewVerdicts", () => {
  it("returns empty buckets for no reviews", () => {
    expect(aggregateReviewVerdicts([])).toEqual({
      approved: [],
      changesRequested: [],
    });
  });

  it("ignores COMMENTED and PENDING reviews", () => {
    const verdicts = aggregateReviewVerdicts([
      review({ user: "alice", state: "COMMENTED" }),
      review({ user: "bob", state: "PENDING" }),
    ]);
    expect(verdicts).toEqual({ approved: [], changesRequested: [] });
  });

  it("splits approvals from change requests", () => {
    const verdicts = aggregateReviewVerdicts([
      review({
        user: "alice",
        state: "APPROVED",
        submittedAt: "2026-07-01T01:00:00Z",
      }),
      review({
        user: "bob",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-07-01T02:00:00Z",
      }),
    ]);
    expect(verdicts.approved.map((r) => r.user)).toEqual(["alice"]);
    expect(verdicts.changesRequested.map((r) => r.user)).toEqual(["bob"]);
  });

  it("counts each reviewer once, by their latest verdict", () => {
    const verdicts = aggregateReviewVerdicts([
      review({
        user: "alice",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-07-01T01:00:00Z",
      }),
      review({
        user: "alice",
        state: "APPROVED",
        submittedAt: "2026-07-01T03:00:00Z",
      }),
    ]);
    expect(verdicts.approved.map((r) => r.user)).toEqual(["alice"]);
    expect(verdicts.changesRequested).toEqual([]);
  });

  it("does not let a later COMMENTED clear an earlier APPROVED", () => {
    const verdicts = aggregateReviewVerdicts([
      review({
        user: "alice",
        state: "APPROVED",
        submittedAt: "2026-07-01T01:00:00Z",
      }),
      review({
        user: "alice",
        state: "COMMENTED",
        submittedAt: "2026-07-01T05:00:00Z",
      }),
    ]);
    expect(verdicts.approved.map((r) => r.user)).toEqual(["alice"]);
  });

  it("drops a reviewer whose latest verdict is DISMISSED", () => {
    const verdicts = aggregateReviewVerdicts([
      review({
        user: "alice",
        state: "APPROVED",
        submittedAt: "2026-07-01T01:00:00Z",
      }),
      review({
        user: "alice",
        state: "DISMISSED",
        submittedAt: "2026-07-01T04:00:00Z",
      }),
    ]);
    expect(verdicts).toEqual({ approved: [], changesRequested: [] });
  });

  it("orders reviewers by the time of their latest verdict", () => {
    const verdicts = aggregateReviewVerdicts([
      review({
        user: "carol",
        state: "APPROVED",
        submittedAt: "2026-07-01T03:00:00Z",
      }),
      review({
        user: "alice",
        state: "APPROVED",
        submittedAt: "2026-07-01T01:00:00Z",
      }),
      review({
        user: "bob",
        state: "APPROVED",
        submittedAt: "2026-07-01T02:00:00Z",
      }),
    ]);
    expect(verdicts.approved.map((r) => r.user)).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
  });
});
