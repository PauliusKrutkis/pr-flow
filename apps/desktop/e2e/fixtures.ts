// Deterministic backend fixtures for the mocked Tauri bridge.

export const makePr = (
  n: number,
  title: string,
  author: string,
  updatedAt: string,
) => ({
  id: n,
  number: n,
  title,
  repo: `acme/rocket`,
  owner: "acme",
  name: "rocket",
  author,
  authorAvatarUrl: "",
  url: `https://github.com/acme/rocket/pull/${n}`,
  state: "open",
  draft: false,
  merged: false,
  updatedAt,
  createdAt: "2026-06-30T09:00:00Z",
  commentsCount: n === 1 ? 2 : 0,
  headSha: "headsha",
  baseSha: "basesha",
  headRef: "feat/thing",
  baseRef: "main",
  additions: 12,
  deletions: 3,
  changedFiles: 2,
  body: "A **fixture** pull request.",
  // PRs with comments also carry a reading-pane teaser, like the live list.
  lastComment:
    n === 1
      ? {
          author: "bob",
          authorAvatarUrl: "",
          body: "Looks good — one nit on the debounce timing.",
          createdAt: "2026-07-02T09:30:00Z",
        }
      : undefined,
});

export type PrFixture = ReturnType<typeof makePr>;
export type BucketFixture = { count: number; prs: PrFixture[] };
export type InboxFixture = Record<
  "reviewRequested" | "assigned" | "created" | "involved",
  BucketFixture
>;

export const INBOX: InboxFixture = {
  reviewRequested: {
    count: 3,
    prs: [
      makePr(1, "Add fuzzy matching to search", "alice", "2026-07-02T10:00:00Z"),
      makePr(2, "Fix cursor drift in diff viewer", "bob", "2026-07-02T09:00:00Z"),
      makePr(3, "Rework the token gate", "carol", "2026-07-01T18:00:00Z"),
    ],
  },
  assigned: { count: 0, prs: [] },
  created: { count: 1, prs: [makePr(4, "My own PR", "me", "2026-07-01T12:00:00Z")] },
  involved: { count: 0, prs: [] },
};

/* The watched-repos ("Watching") bucket: one PR that ALSO lives in the inbox
   (dedup coverage) and one that exists ONLY here, in a different repo. */
export const SUBSCRIBED: BucketFixture = {
  count: 2,
  prs: [
    makePr(1, "Add fuzzy matching to search", "alice", "2026-07-02T10:00:00Z"),
    {
      ...makePr(77, "Watched-only satellite uplink", "dave", "2026-07-01T15:00:00Z"),
      id: 9077,
      repo: "acme/comet",
      owner: "acme",
      name: "comet",
      url: "https://github.com/acme/comet/pull/77",
    },
  ],
};

const PATCH = `@@ -1,5 +1,6 @@
 export function alpha() {
-  return 1;
+  // tuned
+  return 2;
 }
 export const beta = true;`;

export const DETAIL = {
  pr: {
    ...makePr(1, "Add fuzzy matching to search", "alice", "2026-07-02T10:00:00Z"),
  },
  files: [
    {
      filename: "src/lib/fuzzy.ts",
      status: "modified",
      additions: 2,
      deletions: 1,
      changes: 3,
      patch: PATCH,
      sha: "f1",
    },
    {
      filename: "src/lib/search.ts",
      status: "added",
      additions: 5,
      deletions: 0,
      changes: 5,
      // The last line deliberately ends in a WORD character (no semicolon):
      // clicking the blank space right of it exercises the caret-snap guard
      // in the occurrence-highlight click handler.
      patch: `@@ -0,0 +1,5 @@
+export function search(q: string) {
+  const gamma = q.trim();
+  return gamma.length > 0;
+}
+export default search`,
      sha: "f2",
    },
    {
      filename: "src/lib/retry.ts",
      status: "modified",
      additions: 36,
      deletions: 1,
      changes: 37,
      // Hunk 1 is a clean one-token rename: the −/+ pair passes the intraline
      // noise guard, so exactly "Count"/"Limit" carry word-diff emphasis.
      // (fuzzy.ts above pairs "return 1;" with a comment — that pair must
      // FAIL the guard and render without emphasis.) Hunk 2 is a long pure-add
      // run (no del run → no intraline pairs) that exercises the sticky hunk
      // header, and its `@@` line carries the enclosing function the way git
      // emits it. Keep this file free of the tokens other tests count across
      // files: return/gamma/beta/alpha/search.
      patch: `@@ -1,4 +1,4 @@
 export function withRetry(fn: () => Promise<void>) {
-  const retryCount = 3;
+  const retryLimit = 3;
   let delay = 100;
 }
@@ -10,4 +10,39 @@ export function retryLoop(base: number) {
   let delay = base;
   let attempt = 0;
+  const history: number[] = [];
+  const jitter = () => Math.random() * 10;
+  while (attempt < 8) {
+    attempt += 1;
+    delay = delay * 2 + jitter();
+    history.push(delay);
+    if (delay > 5_000) {
+      delay = 5_000;
+    }
+    if (attempt === 3) {
+      log("still trying", {
+        attempt,
+        delay,
+      });
+    }
+    if (attempt === 5) {
+      log("backing off", {
+        attempt,
+        delay,
+      });
+    }
+  }
+  const total = history.reduce((sum, d) => sum + d, 0);
+  const longest = history.reduce((max, d) => (d > max ? d : max), 0);
+  const shortest = history.reduce((min, d) => (d < min ? d : min), total);
+  log("settled", {
+    attempts: attempt,
+    total,
+    longest,
+    shortest,
+  });
+  if (total > 20_000) {
+    warnSlow(total);
+  }
+  history.length = 0;
   done(delay);
 }`,
      sha: "f3",
    },
  ],
  comments: [
    {
      id: 100,
      path: "src/lib/fuzzy.ts",
      line: 2,
      originalLine: null,
      side: "RIGHT",
      diffHunk: "",
      body: "Is this constant right?",
      user: "bob",
      userAvatarUrl: "",
      createdAt: "2026-07-02T09:30:00Z",
      inReplyToId: null,
    },
  ],
  issueComments: [
    {
      id: 200,
      body: "Nice direction overall.",
      user: "carol",
      userAvatarUrl: "",
      createdAt: "2026-07-02T08:00:00Z",
    },
  ],
  reviews: [
    {
      id: 300,
      user: "dave",
      userAvatarUrl: "",
      state: "APPROVED",
      body: "LGTM, ship it.",
      submittedAt: "2026-07-02T09:00:00Z",
    },
  ],
  fetchedAt: 1_750_000_000_000,
};

/**
 * The same PR after a push that reworks fuzzy.ts: new head sha, changed patch
 * for the first file, second file untouched. Serve it on a later load (see
 * bridge detailByLoad) to exercise the auto-unview-on-content-change flow.
 */
export const DETAIL_CHANGED = {
  ...DETAIL,
  pr: { ...DETAIL.pr, headSha: "headsha2", updatedAt: "2026-07-02T11:00:00Z" },
  files: [
    {
      ...DETAIL.files[0],
      additions: 3,
      changes: 4,
      patch: `@@ -1,5 +1,7 @@
 export function alpha() {
-  return 1;
+  // tuned again
+  const two = 2;
+  return two;
 }
 export const beta = true;`,
      sha: "f1b",
    },
    // The push only reworks fuzzy.ts — search.ts and retry.ts are untouched,
    // so their viewed marks must survive the reconcile.
    DETAIL.files[1],
    DETAIL.files[2],
  ],
  fetchedAt: 1_750_000_100_000,
};

/**
 * INBOX after the push behind DETAIL_CHANGED: only PR #1's updatedAt moves
 * (matching DETAIL_CHANGED.pr.updatedAt). Serve it on a later list_inbox call
 * (bridge inboxByCall) to exercise the heartbeat-driven detail refresh.
 */
export const INBOX_UPDATED = {
  ...INBOX,
  reviewRequested: {
    ...INBOX.reviewRequested,
    prs: [
      { ...INBOX.reviewRequested.prs[0], updatedAt: "2026-07-02T11:00:00Z" },
      ...INBOX.reviewRequested.prs.slice(1),
    ],
  },
};

/**
 * A synthetic large PR for the performance specs: `fileCount` files of one
 * `lines`-row hunk each, row text supplied by `lineAt` so each spec controls
 * where its needle tokens land. Kept in fixtures so every perf test measures
 * the same shape of PR.
 */
export function makeBigDetail(
  fileCount: number,
  lines: number,
  lineAt: (f: number, i: number) => string,
) {
  return {
    ...DETAIL,
    pr: {
      ...makePr(1, "Big refactor", "alice", "2026-07-02T10:00:00Z"),
      changedFiles: fileCount,
    },
    files: Array.from({ length: fileCount }, (_, f) => ({
      filename: `src/mod${String(f).padStart(2, "0")}.ts`,
      status: "modified",
      additions: 0,
      deletions: 0,
      changes: lines,
      patch: [
        `@@ -1,${lines} +1,${lines} @@`,
        ...Array.from({ length: lines }, (_, i) => " " + lineAt(f, i + 1)),
      ].join("\n"),
      sha: `bf${f}`,
    })),
    comments: [],
  };
}

/**
 * Wall-clock budget scaled for the running engine: the webkit-perf project
 * exists to catch WebKitGTK-shaped regressions Chromium hides, but its
 * JavaScriptCore dev-mode numbers run slower across the board — ×3 until CI
 * trend logs justify tightening. Structural assertions (repaint counts) are
 * engine-independent and never scale.
 */
export function perfBudget(ms: number, projectName: string): number {
  return projectName.startsWith("webkit") ? ms * 3 : ms;
}

export const ACCOUNT = {
  id: "github-com-me",
  provider: "github",
  host: "https://github.com",
  login: "me",
  avatarUrl: "",
};
