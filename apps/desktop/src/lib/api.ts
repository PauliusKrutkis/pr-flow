import { invoke } from "@tauri-apps/api/core";
import type {
  AccountInfo,
  AccountsInfo,
  FileBlob,
  GitHubUser,
  InboxData,
  PullRequestDetail,
  ReviewComment,
  ReviewEvent,
  UpdateInfo,
  ViewedMap,
} from "../types";

// Thin, typed wrappers over the Rust Tauri commands. Argument keys are
// camelCase; Tauri converts them to the snake_case Rust parameters.

export const api = {
  // ---- auth ----
  hasToken: () => invoke<boolean>("has_token"),
  isOAuthConfigured: () => invoke<boolean>("is_oauth_configured"),
  loginWithGithub: () => invoke<GitHubUser>("login_with_github"),
  isGitlabOAuthConfigured: () => invoke<boolean>("is_gitlab_oauth_configured"),
  loginWithGitlab: (args?: { host?: string | null; clientId?: string | null }) =>
    invoke<GitHubUser>("login_with_gitlab", {
      host: args?.host ?? null,
      clientId: args?.clientId ?? null,
    }),
  /** Confirms a GitLab API answers at the host; returns the normalized host. */
  probeGitlab: (host: string) => invoke<string>("probe_gitlab", { host }),
  setToken: (token: string) => invoke<GitHubUser>("set_token", { token }),
  clearToken: () => invoke<void>("clear_token"),
  getCurrentUser: () => invoke<GitHubUser>("get_current_user"),

  // ---- accounts ----
  listAccounts: () => invoke<AccountsInfo>("list_accounts"),
  addAccount: (args: { provider: string; host?: string | null; token: string }) =>
    invoke<AccountInfo>("add_account", args),
  setActiveAccount: (id: string) => invoke<void>("set_active_account", { id }),
  removeAccount: (id: string) => invoke<AccountsInfo>("remove_account", { id }),

  // ---- inbox (all tabs in one GraphQL request) ----
  listInbox: () => invoke<InboxData>("list_inbox"),
  getCachedInbox: () => invoke<InboxData | null>("get_cached_inbox"),

  // ---- pull request detail ----
  getPullRequestDetail: (owner: string, repo: string, number: number) =>
    invoke<PullRequestDetail>("get_pull_request_detail", { owner, repo, number }),
  getCachedPullRequestDetail: (owner: string, repo: string, number: number) =>
    invoke<PullRequestDetail | null>("get_cached_pull_request_detail", {
      owner,
      repo,
      number,
    }),

  // ---- comments ----
  createReviewComment: (args: {
    owner: string;
    repo: string;
    number: number;
    body: string;
    commitId: string;
    path: string;
    line: number;
    side: string;
  }) => invoke<ReviewComment>("create_review_comment", args),
  replyToReviewComment: (args: {
    owner: string;
    repo: string;
    number: number;
    body: string;
    inReplyTo: number;
  }) => invoke<ReviewComment>("reply_to_review_comment", args),
  createIssueComment: (args: {
    owner: string;
    repo: string;
    number: number;
    body: string;
  }) => invoke<void>("create_issue_comment", args),
  submitReview: (args: {
    owner: string;
    repo: string;
    number: number;
    event: ReviewEvent;
    body: string;
    commitId: string;
    comments: { path: string; line: number; side: string; body: string }[];
  }) => invoke<void>("submit_review", args),

  // ---- file blobs (image diffs) ----
  getFileBlob: (owner: string, repo: string, path: string, ref: string) =>
    invoke<FileBlob>("get_file_blob", { owner, repo, path, ref }),

  // ---- viewed-file state (local only) ----
  getViewedMap: () => invoke<ViewedMap>("get_viewed_map"),
  setViewedMap: (map: ViewedMap) => invoke<void>("set_viewed_map", { map }),

  // ---- auto-update ----
  checkForUpdate: () => invoke<UpdateInfo | null>("check_for_update"),
  installUpdate: () => invoke<void>("install_update"),
};

export type Api = typeof api;
