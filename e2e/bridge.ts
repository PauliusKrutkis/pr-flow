import type { BucketFixture, InboxFixture } from "./fixtures.ts";
import { ACCOUNT, DETAIL, FULL_FILES, INBOX } from "./fixtures.ts";
import type { Page } from "./types.ts";

/**
 * The mocked Tauri bridge. @tauri-apps/api routes every call through
 * `window.__TAURI_INTERNALS__.invoke`, so defining it before the app loads
 * makes the real frontend run against fixtures — no Rust, no network.
 */

export interface AppOptions {
  detail?: unknown;
  appVersion?: string;
  detailByCall?: unknown[];
  detailByLoad?: unknown[];
  fileBlobs?: Record<string, string>;
  hangIssueComment?: boolean;
  hasToken?: boolean;
  releases?:
    | { tag: string; publishedAt: string | null; notes: string | null }[]
    | null;
  inbox?: InboxFixture;
  inboxByCall?: unknown[];
  repoHits?: { fullName: string; description: string }[];
  subscribed?: BucketFixture;
  watchedRepos?: string[];
}

export async function setupApp(page: Page, opts: AppOptions = {}) {
  const config = {
    account: ACCOUNT,
    appVersion: opts.appVersion ?? "1.0.0",
    detail: (opts.detail ?? DETAIL) as typeof DETAIL,
    detailByCall: opts.detailByCall ?? null,
    detailByLoad: opts.detailByLoad ?? null,
    fileBlobs: opts.fileBlobs ?? FULL_FILES,
    hangIssueComment: opts.hangIssueComment ?? false,
    hasToken: opts.hasToken ?? true,
    releases: opts.releases ?? [],
    inbox: opts.inbox ?? INBOX,
    inboxByCall: opts.inboxByCall ?? null,
    repoHits: opts.repoHits ?? [],
    subscribed: opts.subscribed ?? { count: 0, prs: [] },
    watchedRepos: opts.watchedRepos ?? [],
  };

  await page.addInitScript((cfg) => {
    const load = Number(localStorage.getItem("e2e:load") ?? "0");
    localStorage.setItem("e2e:load", String(load + 1));
    const byLoad = cfg.detailByLoad;
    const detail = byLoad
      ? byLoad[Math.min(load, byLoad.length - 1)]
      : cfg.detail;

    let detailCalls = 0;
    let inboxCalls = 0;
    const seq = (arr: unknown[] | null, n: number, fallback: unknown) =>
      arr ? arr[Math.min(n, arr.length - 1)] : fallback;

    const handlers: Record<string, (args: Record<string, unknown>) => unknown> =
      {
        check_for_update: () => null,
        create_issue_comment: () =>
          cfg.hangIssueComment
            ? new Promise(() => {
                /* intentionally pending */
              })
            : null,
        create_review_comment: (args) => ({
          body: args.body,
          createdAt: new Date().toISOString(),
          diffHunk: "",
          id: 900,
          inReplyToId: null,
          line: args.line,
          originalLine: null,
          path: args.path,
          resolved: false,
          side: args.side,
          threadId: null,
          user: "me",
          userAvatarUrl: "",
        }),
        delete_issue_comment: (args) => {
          cfg.detail.issueComments = (
            cfg.detail.issueComments as Array<{ id: number }>
          ).filter(
            (c) => c.id !== args.commentId
          ) as typeof cfg.detail.issueComments;
          localStorage.setItem("e2e:lastConvoDelete", JSON.stringify(args));
          return null;
        },
        delete_review_comment: (args) => {
          cfg.detail.comments = (
            cfg.detail.comments as Array<{ id: number }>
          ).filter(
            (c) => c.id !== args.commentId
          ) as typeof cfg.detail.comments;
          localStorage.setItem("e2e:lastCommentDelete", JSON.stringify(args));
          return null;
        },
        get_app_version: () => cfg.appVersion,
        get_cached_inbox: () => null,
        get_cached_pull_request_detail: () => null,
        get_cached_subscribed: () => null,
        get_file_blob: (args) => {
          const text = cfg.fileBlobs[args.path as string];
          if (text === undefined) {
            throw new Error(`no blob fixture for ${String(args.path)}`);
          }
          return { base64: btoa(text), size: text.length };
        },
        get_pull_request_detail: () => {
          const result = seq(cfg.detailByCall, detailCalls, detail);
          detailCalls += 1;
          return result;
        },
        get_viewed_map: () =>
          JSON.parse(localStorage.getItem("e2e:viewed") ?? "{}"),
        get_watched_repos: () => cfg.watchedRepos,
        has_token: () => cfg.hasToken,
        is_gitlab_oauth_configured: () => false,
        is_oauth_configured: () => false,
        list_accounts: () =>
          cfg.hasToken
            ? { accounts: [cfg.account], activeId: cfg.account.id }
            : { accounts: [], activeId: null },
        list_inbox: () => {
          const result = seq(cfg.inboxByCall, inboxCalls, cfg.inbox);
          inboxCalls += 1;
          return result;
        },
        list_releases: () => cfg.releases,
        list_subscribed: () => cfg.subscribed,
        "plugin:opener|open": () => null,
        "plugin:opener|open_url": () => null,
        resolve_thread: (args) => {
          for (const c of cfg.detail.comments as Array<{
            threadId: string | null;
            resolved: boolean;
          }>) {
            if (c.threadId === args.threadId) {
              c.resolved = args.resolved as boolean;
            }
          }
          return null;
        },
        search_repos: () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(cfg.repoHits), 200)
          ),
        set_viewed_map: (args) => {
          localStorage.setItem("e2e:viewed", JSON.stringify(args.map));
          return null;
        },
        set_watched_repos: () => null,
        submit_review: (args) => {
          localStorage.setItem("e2e:lastReview", JSON.stringify(args));
          return null;
        },
        update_issue_comment: (args) => {
          for (const c of cfg.detail.issueComments as Array<{
            id: number;
            body: string;
          }>) {
            if (c.id === args.commentId) {
              c.body = args.body as string;
            }
          }
          localStorage.setItem("e2e:lastConvoEdit", JSON.stringify(args));
          return null;
        },
        update_review_comment: (args) => {
          for (const c of cfg.detail.comments as Array<{
            id: number;
            body: string;
          }>) {
            if (c.id === args.commentId) {
              c.body = args.body as string;
            }
          }
          localStorage.setItem("e2e:lastCommentEdit", JSON.stringify(args));
          return null;
        },
      };

    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          const handler = handlers[cmd];
          if (!handler) {
            console.warn(`[e2e bridge] unhandled command: ${cmd}`);
            return Promise.resolve(null);
          }
          return Promise.resolve(handler(args ?? {}));
        },
        metadata: {
          currentWebview: { label: "main" },
          currentWindow: { label: "main" },
        },
        transformCallback: (() => {
          let id = 0;
          return () => {
            id += 1;
            return id;
          };
        })(),
      },
    });
  }, config);

  await page.goto("/");
}
