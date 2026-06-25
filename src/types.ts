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
  additions: number;
  deletions: number;
  changedFiles: number;
  body: string;
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

export interface PullRequestDetail {
  pr: PullRequest;
  files: ChangedFile[];
  comments: ReviewComment[];
  /** unix epoch millis */
  fetchedAt: number;
}

/** prKey -> list of filenames marked viewed */
export type ViewedMap = Record<string, string[]>;

export interface PRRef {
  owner: string;
  name: string;
  number: number;
}

/** Stable identity for a PR, used as the key for viewed/last-seen state. */
export function prKey(pr: PRRef): string {
  return `${pr.owner}/${pr.name}#${pr.number}`;
}
