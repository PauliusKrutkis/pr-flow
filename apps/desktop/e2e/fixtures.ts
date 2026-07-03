// Deterministic backend fixtures for the mocked Tauri bridge.

const pr = (n: number, title: string, author: string, updatedAt: string) => ({
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
});

export const INBOX = {
  reviewRequested: {
    count: 3,
    prs: [
      pr(1, "Add fuzzy matching to search", "alice", "2026-07-02T10:00:00Z"),
      pr(2, "Fix cursor drift in diff viewer", "bob", "2026-07-02T09:00:00Z"),
      pr(3, "Rework the token gate", "carol", "2026-07-01T18:00:00Z"),
    ],
  },
  assigned: { count: 0, prs: [] },
  created: { count: 1, prs: [pr(4, "My own PR", "me", "2026-07-01T12:00:00Z")] },
  involved: { count: 0, prs: [] },
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
    ...pr(1, "Add fuzzy matching to search", "alice", "2026-07-02T10:00:00Z"),
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
      additions: 4,
      deletions: 0,
      changes: 4,
      patch: `@@ -0,0 +1,4 @@
+export function search(q: string) {
+  const gamma = q.trim();
+  return gamma.length > 0;
+}`,
      sha: "f2",
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
  fetchedAt: 1_750_000_000_000,
};

export const ACCOUNT = {
  id: "github-com-me",
  provider: "github",
  host: "https://github.com",
  login: "me",
  avatarUrl: "",
};
