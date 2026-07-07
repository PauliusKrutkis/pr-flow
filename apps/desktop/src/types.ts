/**
 * Shared data model. These mirror exactly the camelCase structs returned by
 * the Rust backend (see src-tauri/src/github.rs).
 *
 * PullRequest list items omit heavy fields (headSha, files); detail fetches
 * fill baseSha/headRef/baseRef and lastComment (inbox pane teaser only).
 * ReviewComment.threadId/resolved come from the provider's resolvable-thread
 * handle — null hides the resolve affordance. PendingComment.line is the
 * range end for multi-line drafts; startLine is the start when present.
 * ViewedFileMap maps filename → content fingerprint ("?" = legacy mark).
 */

export interface GitHubUser {
  avatarUrl: string;
  login: string;
  name: string;
}

export interface PullRequest {
  additions: number;
  author: string;
  authorAvatarUrl: string;
  baseRef: string;
  baseSha: string;
  body: string;
  changedFiles: number;
  commentsCount: number;
  createdAt: string;
  deletions: number;
  draft: boolean;
  headRef: string;
  headSha: string;
  id: number;
  lastComment?: LastComment;
  merged: boolean;
  name: string;
  number: number;
  owner: string;
  repo: string;
  state: string;
  title: string;
  updatedAt: string;
  url: string;
}

export interface LastComment {
  author: string;
  authorAvatarUrl: string;
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
  additions: number;
  changes: number;
  deletions: number;
  filename: string;
  patch?: string | null;
  previousFilename?: string | null;
  sha: string;
  status: FileStatus;
}

export interface ReviewComment {
  body: string;
  createdAt: string;
  diffHunk: string;
  id: number;
  inReplyToId: number | null;
  line: number | null;
  originalLine: number | null;
  path: string;
  resolved: boolean;
  side: string;
  threadId: string | null;
  user: string;
  userAvatarUrl: string;
}

export interface IssueComment {
  body: string;
  createdAt: string;
  id: number;
  user: string;
  userAvatarUrl: string;
}

export interface ReviewSummary {
  body: string;
  id: number;
  state: string;
  submittedAt: string;
  user: string;
  userAvatarUrl: string;
}

export interface PullRequestDetail {
  comments: ReviewComment[];
  fetchedAt: number;
  files: ChangedFile[];
  issueComments: IssueComment[];
  pr: PullRequest;
  reviews: ReviewSummary[];
}

export interface InboxBucket {
  count: number;
  prs: PullRequest[];
}

export interface InboxData {
  assigned: InboxBucket;
  created: InboxBucket;
  involved: InboxBucket;
  reviewRequested: InboxBucket;
}

export type InboxTabKey = keyof InboxData | "subscribed";

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface PendingComment {
  body: string;
  id: string;
  line: number;
  path: string;
  side: string;
  startLine?: number;
}

export type ViewedFileMap = Record<string, string>;

export type ViewedMap = Record<string, ViewedFileMap>;

export interface RepoHit {
  description: string;
  fullName: string;
}

export interface FileBlob {
  base64: string;
  size: number;
}

export interface AccountInfo {
  avatarUrl: string;
  host: string;
  id: string;
  login: string;
  provider: string;
}

export interface AccountsInfo {
  accounts: AccountInfo[];
  activeId: string | null;
}

export interface UpdateInfo {
  currentVersion: string;
  notes: string | null;
  version: string;
}

export interface PRRef {
  name: string;
  number: number;
  owner: string;
}

/** Stable identity for a PR, used as the key for viewed/last-seen state. */
export function prKey(pr: PRRef): string {
  return `${pr.owner}/${pr.name}#${pr.number}`;
}
