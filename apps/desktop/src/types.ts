// Shared data model. These mirror exactly the camelCase structs returned by
// the Rust backend (see src-tauri/src/github.rs).

export interface GitHubUser {
  login: string;
  avatarUrl: string;
  name: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  /** "owner/name" */
  repo: string;
  owner: string;
  name: string;
  author: string;
  authorAvatarUrl: string;
  /** html_url on github.com */
  url: string;
  state: string;
  draft: boolean;
  merged: boolean;
  updatedAt: string;
  createdAt: string;
  commentsCount: number;
  /** head commit sha — needed to post inline review comments (empty in list view) */
  headSha: string;
  /** base branch tip sha (populated on detail fetch; used for image diffs) */
  baseSha: string;
  /** Branch names (populated on detail fetch; empty in the list view). */
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body: string;
  /** Newest comment, for the inbox reading pane (list fetch only; absent on
   *  detail fetches and providers that can't supply it cheaply). */
  lastComment?: LastComment;
}

export interface LastComment {
  author: string;
  authorAvatarUrl: string;
  /** Plain text — a teaser, not Markdown. */
  body: string;
  createdAt: string;
}

export type FileStatus =
  | "added"
  | "modified"
  | "removed"
  | "renamed"
  | "copied"
  | "changed"
  | string;

export interface ChangedFile {
  filename: string;
  previousFilename?: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  changes: number;
  /** Unified diff for this file. Absent for binary / very large files. */
  patch?: string | null;
  sha: string;
}

export interface ReviewComment {
  id: number;
  path: string;
  line: number | null;
  originalLine: number | null;
  /** "LEFT" | "RIGHT" */
  side: string;
  diffHunk: string;
  body: string;
  user: string;
  userAvatarUrl: string;
  createdAt: string;
  inReplyToId: number | null;
}

/** A PR-level conversation comment (not anchored to a diff line). */
export interface IssueComment {
  id: number;
  body: string;
  user: string;
  userAvatarUrl: string;
  createdAt: string;
}

/** A submitted review: an approval / change request / review summary body. */
export interface ReviewSummary {
  id: number;
  user: string;
  userAvatarUrl: string;
  /** "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" */
  state: string;
  body: string;
  submittedAt: string;
}

export interface PullRequestDetail {
  pr: PullRequest;
  files: ChangedFile[];
  comments: ReviewComment[];
  /** PR-level conversation, oldest first. */
  issueComments: IssueComment[];
  /** Submitted review verdicts/summaries, oldest first. */
  reviews: ReviewSummary[];
  /** unix epoch millis */
  fetchedAt: number;
}

export interface InboxBucket {
  count: number;
  prs: PullRequest[];
}

/** All inbox tabs, fetched in a single GraphQL request. */
export interface InboxData {
  reviewRequested: InboxBucket;
  assigned: InboxBucket;
  created: InboxBucket;
  involved: InboxBucket;
}

/** Inbox tabs: the four involvement buckets plus the watched-repos tab. */
export type InboxTabKey = keyof InboxData | "subscribed";

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

/** A draft inline comment, batched locally until the review is submitted. */
export interface PendingComment {
  id: string;
  path: string;
  line: number;
  side: string;
  body: string;
}

/**
 * filename -> content fingerprint captured when the file was marked viewed
 * (see lib/viewedFingerprint.ts; "?" = migrated legacy mark, fingerprint
 * unknown until the PR's detail is next loaded).
 */
export type ViewedFileMap = Record<string, string>;

/** prKey -> the files marked viewed, with their content fingerprints. */
export type ViewedMap = Record<string, ViewedFileMap>;

/** A repository search hit (the watch-repos picker). */
export interface RepoHit {
  fullName: string;
  description: string;
}

/** Raw file bytes at a ref, base64-encoded (image diffs). */
export interface FileBlob {
  base64: string;
  size: number;
}

/** A connected code-host account (token stays in the backend). */
export interface AccountInfo {
  id: string;
  /** "github" | "gitlab" */
  provider: string;
  host: string;
  login: string;
  avatarUrl: string;
}

export interface AccountsInfo {
  accounts: AccountInfo[];
  activeId: string | null;
}

/** A newer release reported by the updater (null when up to date). */
export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}

export interface PRRef {
  owner: string;
  name: string;
  number: number;
}

/** Stable identity for a PR, used as the key for viewed/last-seen state. */
export function prKey(pr: PRRef): string {
  return `${pr.owner}/${pr.name}#${pr.number}`;
}
