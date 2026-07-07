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
  login: string;
  avatarUrl: string;
  name: string;
}

export interface PullRequest {
  id: number;
  number: number;
  title: string;
  repo: string;
  owner: string;
  name: string;
  author: string;
  authorAvatarUrl: string;
  url: string;
  state: string;
  draft: boolean;
  merged: boolean;
  updatedAt: string;
  createdAt: string;
  commentsCount: number;
  headSha: string;
  baseSha: string;
  headRef: string;
  baseRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  body: string;
  lastComment?: LastComment;
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
  filename: string;
  previousFilename?: string | null;
  status: FileStatus;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string | null;
  sha: string;
}

export interface ReviewComment {
  id: number;
  path: string;
  line: number | null;
  originalLine: number | null;
  side: string;
  diffHunk: string;
  body: string;
  user: string;
  userAvatarUrl: string;
  createdAt: string;
  inReplyToId: number | null;
  threadId: string | null;
  resolved: boolean;
}

export interface IssueComment {
  id: number;
  body: string;
  user: string;
  userAvatarUrl: string;
  createdAt: string;
}

export interface ReviewSummary {
  id: number;
  user: string;
  userAvatarUrl: string;
  state: string;
  body: string;
  submittedAt: string;
}

export interface PullRequestDetail {
  pr: PullRequest;
  files: ChangedFile[];
  comments: ReviewComment[];
  issueComments: IssueComment[];
  reviews: ReviewSummary[];
  fetchedAt: number;
}

export interface InboxBucket {
  count: number;
  prs: PullRequest[];
}

export interface InboxData {
  reviewRequested: InboxBucket;
  assigned: InboxBucket;
  created: InboxBucket;
  involved: InboxBucket;
}

export type InboxTabKey = keyof InboxData | "subscribed";

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface PendingComment {
  id: string;
  path: string;
  line: number;
  side: string;
  body: string;
  startLine?: number;
}

export type ViewedFileMap = Record<string, string>;

export type ViewedMap = Record<string, ViewedFileMap>;

export interface RepoHit {
  fullName: string;
  description: string;
}

export interface FileBlob {
  base64: string;
  size: number;
}

export interface AccountInfo {
  id: string;
  provider: string;
  host: string;
  login: string;
  avatarUrl: string;
}

export interface AccountsInfo {
  accounts: AccountInfo[];
  activeId: string | null;
}

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
