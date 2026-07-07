import { invoke } from "@tauri-apps/api/core";
import type {
  AccountInfo,
  AccountsInfo,
  FileBlob,
  InboxBucket,
  GitHubUser,
  InboxData,
  PullRequestDetail,
  RepoHit,
  ReviewComment,
  ReviewEvent,
  UpdateInfo,
  ViewedMap,
} from "../types";

/**
 * Thin, typed wrappers over the Rust Tauri commands. Argument keys are
 * camelCase; Tauri converts them to the snake_case Rust parameters.
 */

export const api = {
  hasToken: () => invoke<boolean>("has_token"),
  isOAuthConfigured: () => invoke<boolean>("is_oauth_configured"),
  loginWithGithub: () => invoke<GitHubUser>("login_with_github"),
  isGitlabOAuthConfigured: () => invoke<boolean>("is_gitlab_oauth_configured"),
  loginWithGitlab: (args?: { host?: string | null; clientId?: string | null }) =>
    invoke<GitHubUser>("login_with_gitlab", {
      host: args?.host ?? null,
      clientId: args?.clientId ?? null,
    }),
  probeGitlab: (host: string) => invoke<string>("probe_gitlab", { host }),
  setToken: (token: string) => invoke<GitHubUser>("set_token", { token }),
  clearToken: () => invoke<void>("clear_token"),
  getCurrentUser: () => invoke<GitHubUser>("get_current_user"),

  listAccounts: () => invoke<AccountsInfo>("list_accounts"),
  addAccount: (args: { provider: string; host?: string | null; token: string }) =>
    invoke<AccountInfo>("add_account", args),
  setActiveAccount: (id: string) => invoke<void>("set_active_account", { id }),
  removeAccount: (id: string) => invoke<AccountsInfo>("remove_account", { id }),

  listInbox: () => invoke<InboxData>("list_inbox"),
  getCachedInbox: () => invoke<InboxData | null>("get_cached_inbox"),

  searchRepos: (query: string) => invoke<RepoHit[]>("search_repos", { query }),
  getWatchedRepos: () => invoke<string[]>("get_watched_repos"),
  setWatchedRepos: (repos: string[]) => invoke<void>("set_watched_repos", { repos }),
  listSubscribed: () => invoke<InboxBucket>("list_subscribed"),
  getCachedSubscribed: () => invoke<InboxBucket | null>("get_cached_subscribed"),

  getPullRequestDetail: (owner: string, repo: string, number: number) =>
    invoke<PullRequestDetail>("get_pull_request_detail", { owner, repo, number }),
  getCachedPullRequestDetail: (owner: string, repo: string, number: number) =>
    invoke<PullRequestDetail | null>("get_cached_pull_request_detail", {
      owner,
      repo,
      number,
    }),

  createReviewComment: (args: {
    owner: string;
    repo: string;
    number: number;
    body: string;
    commitId: string;
    path: string;
    line: number;
    side: string;
    startLine?: number;
  }) => invoke<ReviewComment>("create_review_comment", args),
  replyToReviewComment: (args: {
    owner: string;
    repo: string;
    number: number;
    body: string;
    inReplyTo: number;
  }) => invoke<ReviewComment>("reply_to_review_comment", args),
  resolveThread: (args: {
    owner: string;
    repo: string;
    number: number;
    threadId: string;
    resolved: boolean;
  }) => invoke<void>("resolve_thread", args),
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
    comments: {
      path: string;
      line: number;
      side: string;
      body: string;
      startLine?: number;
    }[];
  }) => invoke<void>("submit_review", args),

  getFileBlob: (owner: string, repo: string, path: string, ref: string) =>
    invoke<FileBlob>("get_file_blob", { owner, repo, path, ref }),

  getViewedMap: () => invoke<unknown>("get_viewed_map"),
  setViewedMap: (map: ViewedMap) => invoke<void>("set_viewed_map", { map }),

  checkForUpdate: () => invoke<UpdateInfo | null>("check_for_update"),
  installUpdate: () => invoke<void>("install_update"),
};

export type Api = typeof api;
