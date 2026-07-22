export const makePr = (
  n: number,
  title: string,
  author: string,
  updatedAt: string
) => ({
  additions: 12,
  author,
  authorAvatarUrl: "",
  baseRef: "main",
  baseSha: "basesha",
  body: "A **fixture** pull request.",
  changedFiles: 2,
  commentsCount: n === 1 ? 2 : 0,
  createdAt: "2026-06-30T09:00:00Z",
  deletions: 3,
  draft: false,
  headRef: "feat/thing",
  headSha: "headsha",
  id: n,
  lastComment:
    n === 1
      ? {
          author: "bob",
          authorAvatarUrl: "",
          body: "Looks good — one nit on the debounce timing.",
          createdAt: "2026-07-02T09:30:00Z",
        }
      : undefined,
  merged: false,
  name: "rocket",
  number: n,
  owner: "acme",
  repo: "acme/rocket",
  state: "open",
  title,
  updatedAt,
  url: `https://github.com/acme/rocket/pull/${n}`,
});

type PrFixture = ReturnType<typeof makePr>;
export interface BucketFixture {
  count: number;
  prs: PrFixture[];
}
export type InboxFixture = Record<
  "reviewRequested" | "assigned" | "created" | "involved",
  BucketFixture
>;

export const INBOX: InboxFixture = {
  assigned: { count: 0, prs: [] },
  created: {
    count: 1,
    prs: [makePr(4, "My own PR", "me", "2026-07-01T12:00:00Z")],
  },
  involved: { count: 0, prs: [] },
  reviewRequested: {
    count: 3,
    prs: [
      makePr(
        1,
        "Add fuzzy matching to search",
        "alice",
        "2026-07-02T10:00:00Z"
      ),
      makePr(
        2,
        "Fix cursor drift in diff viewer",
        "bob",
        "2026-07-02T09:00:00Z"
      ),
      makePr(3, "Rework the token gate", "carol", "2026-07-01T18:00:00Z"),
    ],
  },
};

/* The watched-repos ("Watching") bucket: one PR that ALSO lives in the inbox
   (dedup coverage) and one that exists ONLY here, in a different repo. */
export const SUBSCRIBED: BucketFixture = {
  count: 2,
  prs: [
    makePr(1, "Add fuzzy matching to search", "alice", "2026-07-02T10:00:00Z"),
    {
      ...makePr(
        77,
        "Watched-only satellite uplink",
        "dave",
        "2026-07-01T15:00:00Z"
      ),
      id: 9077,
      name: "comet",
      owner: "acme",
      repo: "acme/comet",
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

/* Head-blob fixtures for full-file expansion (get_file_blob). fuzzy.ts must
   agree with PATCH line-for-line on the new side — expandFileRows validates —
   and carries extra tail lines that only exist when expanded. */
export const FULL_FILES: Record<string, string> = {
  "src/lib/fuzzy.ts": [
    "export function alpha() {",
    "  // tuned",
    "  return 2;",
    "}",
    "export const beta = true;",
    "",
    "export function omega() {",
    "  return beta;",
    "}",
    "",
  ].join("\n"),
  "src/lib/retry.ts": [
    "export function withRetry(fn: () => Promise<void>) {",
    "  const retryLimit = 3;",
    "  let delay = 100;",
    "}",
    "",
    "function log(event: string, data: unknown) {",
    "  console.info(event, data);",
    "}",
    "export function retryLoop(base: number) {",
    "  let delay = base;",
    "  let attempt = 0;",
    "  const history: number[] = [];",
    "  const jitter = () => Math.random() * 10;",
    "  while (attempt < 8) {",
    "    attempt += 1;",
    "    delay = delay * 2 + jitter();",
    "    history.push(delay);",
    "    if (delay > 5_000) {",
    "      delay = 5_000;",
    "    }",
    "    if (attempt === 3) {",
    '      log("still trying", {',
    "        attempt,",
    "        delay,",
    "      });",
    "    }",
    "    if (attempt === 5) {",
    '      log("backing off", {',
    "        attempt,",
    "        delay,",
    "      });",
    "    }",
    "  }",
    "  const total = history.reduce((sum, d) => sum + d, 0);",
    "  const longest = history.reduce((max, d) => (d > max ? d : max), 0);",
    "  const shortest = history.reduce((min, d) => (d < min ? d : min), total);",
    '  log("settled", {',
    "    attempts: attempt,",
    "    total,",
    "    longest,",
    "    shortest,",
    "  });",
    "  if (total > 20_000) {",
    "    warnSlow(total);",
    "  }",
    "  history.length = 0;",
    "  done(delay);",
    "}",
    "",
    "export const RETRY_VERSION = 2;",
    "",
  ].join("\n"),
};

export const DETAIL = {
  ciStatus: {
    failed: 1,
    state: "failure",
    total: 4,
    url: "https://github.com/o/r/pull/1/checks",
  },
  comments: [
    {
      body: "Is this constant right?",
      createdAt: "2026-07-02T09:30:00Z",
      diffHunk: "",
      id: 100,
      inReplyToId: null,
      line: 2,
      originalLine: null,
      path: "src/lib/fuzzy.ts",
      resolved: false,
      side: "RIGHT",
      threadId: "T100",
      user: "bob",
      userAvatarUrl: "",
    },
    {
      body: "How about:\n```suggestion\n  return 3;\n```",
      createdAt: "2026-07-02T09:45:00Z",
      diffHunk: "",
      id: 101,
      inReplyToId: 100,
      line: null,
      originalLine: null,
      path: "src/lib/fuzzy.ts",
      resolved: false,
      side: "RIGHT",
      threadId: "T100",
      user: "carol",
      userAvatarUrl: "",
    },
  ],
  fetchedAt: 1_750_000_000_000,
  files: [
    {
      additions: 2,
      changes: 3,
      deletions: 1,
      filename: "src/lib/fuzzy.ts",
      patch: PATCH,
      sha: "f1",
      status: "modified",
    },
    {
      additions: 5,
      changes: 5,
      deletions: 0,
      filename: "src/lib/search.ts",
      patch: `@@ -0,0 +1,5 @@
+export function search(q: string) {
+  const gamma = q.trim();
+  return gamma.length > 0;
+}
+export default search`,
      sha: "f2",
      status: "added",
    },
    {
      additions: 36,
      changes: 37,
      deletions: 1,
      filename: "src/lib/retry.ts",
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
      status: "modified",
    },
  ],
  issueComments: [
    {
      body: "Nice direction overall.",
      createdAt: "2026-07-02T08:00:00Z",
      id: 200,
      user: "carol",
      userAvatarUrl: "",
    },
  ],
  pr: {
    ...makePr(
      1,
      "Add fuzzy matching to search",
      "alice",
      "2026-07-02T10:00:00Z"
    ),
  },
  reviews: [
    {
      body: "LGTM, ship it.",
      id: 300,
      state: "APPROVED",
      submittedAt: "2026-07-02T09:00:00Z",
      user: "dave",
      userAvatarUrl: "",
    },
  ],
};

/**
 * DETAIL plus a thread and a PR-level comment authored by the signed-in
 * fixture user ("me") — the edit/delete affordances only appear on your own
 * comments. Bodies carry markdown so specs can prove the raw wire format
 * round-trips into the composer instead of re-serialized HTML.
 */
export const DETAIL_WITH_OWN_COMMENT = {
  ...DETAIL,
  comments: [
    ...DETAIL.comments,
    {
      body: "I will tighten this **loop** tomorrow.",
      createdAt: "2026-07-02T09:50:00Z",
      diffHunk: "",
      id: 150,
      inReplyToId: null,
      line: 3,
      originalLine: null,
      path: "src/lib/fuzzy.ts",
      resolved: false,
      side: "RIGHT",
      threadId: "T150",
      user: "me",
      userAvatarUrl: "",
    },
  ],
  issueComments: [
    ...DETAIL.issueComments,
    {
      body: "Deploying to **staging** first.",
      createdAt: "2026-07-02T10:15:00Z",
      id: 210,
      user: "me",
      userAvatarUrl: "",
    },
  ],
};

/**
 * A repo with no CI configured: the pill must render nothing so quiet repos
 * stay quiet. Serve via `detailByCall: [DETAIL_NO_CI]`.
 */
export const DETAIL_NO_CI = {
  ...DETAIL,
  ciStatus: { failed: 0, state: "none", total: 0, url: "" },
};

/**
 * The same PR after a push that reworks fuzzy.ts: new head sha, changed patch
 * for the first file, second file untouched. Serve it on a later load (see
 * bridge detailByLoad) to exercise the auto-unview-on-content-change flow.
 */
export const DETAIL_CHANGED = {
  ...DETAIL,
  fetchedAt: 1_750_000_100_000,
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
    DETAIL.files[1],
    DETAIL.files[2],
  ],
  pr: { ...DETAIL.pr, headSha: "headsha2", updatedAt: "2026-07-02T11:00:00Z" },
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
  lineAt: (f: number, i: number) => string
) {
  return {
    ...DETAIL,
    comments: [],
    files: Array.from({ length: fileCount }, (_, f) => ({
      additions: 0,
      changes: lines,
      deletions: 0,
      filename: `src/mod${String(f).padStart(2, "0")}.ts`,
      patch: [
        `@@ -1,${lines} +1,${lines} @@`,
        ...Array.from(
          { length: lines },
          (_line, lineIndex) => ` ${lineAt(f, lineIndex + 1)}`
        ),
      ].join("\n"),
      sha: `bf${f}`,
      status: "modified",
    })),
    pr: {
      ...makePr(1, "Big refactor", "alice", "2026-07-02T10:00:00Z"),
      changedFiles: fileCount,
    },
  };
}

/**
 * Wall-clock budget scaled for the running engine and build mode:
 * - webkit-perf exists to catch WebKitGTK-shaped regressions Chromium hides,
 *   but its JavaScriptCore dev-mode numbers run slower across the board —
 *   ×3 until CI trend logs justify tightening.
 * - *-prod projects run against `vite build` + `vite preview` instead of the
 *   dev server, where React's dev runtime + GC noise inflate numbers ~2x —
 *   so the same budget is halved to reflect what users actually feel.
 * Structural assertions (repaint counts) are engine/build-independent and
 * never scale.
 */
export function perfBudget(ms: number, projectName: string): number {
  const base = projectName.startsWith("webkit") ? ms * 3 : ms;
  return projectName.endsWith("-prod") ? base / 2 : base;
}

export const ACCOUNT = {
  avatarUrl: "",
  host: "https://github.com",
  id: "github-com-me",
  login: "me",
  provider: "github",
};
