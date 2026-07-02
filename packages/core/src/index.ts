// @pr-flow/core — the PR engine: GitHub API access, caching, and the shared
// data model (PRs, comments, reviews, users) that both the desktop app and the
// design lab build on.
//
// Dependency rule: core depends on NOTHING in this repo. The desktop app and the
// design lab depend on core; core never depends on them. Keep it that way.
//
// Nothing has moved here yet — the desktop app still owns its `src/lib` and
// `src/types.ts`. They migrate in follow-up PRs. This file just establishes the
// package boundary.

export {};
