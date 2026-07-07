/**
 * @pr-flow/core — the PR engine: GitHub API access, caching, and the shared
 * data model (PRs, comments, reviews, users) that the desktop app builds on.
 *
 * Dependency rule: core depends on NOTHING in this repo. The desktop app
 * depends on core; core never depends on it. Keep it that way.
 *
 * Nothing has moved here yet — the desktop app still owns its `src/lib` and
 * `src/types.ts`. They migrate in follow-up PRs. This file just establishes the
 * package boundary.
 */

export {};
