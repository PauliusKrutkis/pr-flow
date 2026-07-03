import type { Page } from "@playwright/test";
import { ACCOUNT, DETAIL, INBOX } from "./fixtures";

// The mocked Tauri bridge. @tauri-apps/api routes every call through
// `window.__TAURI_INTERNALS__.invoke`, so defining it before the app loads
// makes the real frontend run against fixtures — no Rust, no network.

export interface AppOptions {
  /** false boots into the sign-in gate. */
  hasToken?: boolean;
}

export async function setupApp(page: Page, opts: AppOptions = {}) {
  const config = {
    hasToken: opts.hasToken ?? true,
    inbox: INBOX,
    detail: DETAIL,
    account: ACCOUNT,
  };

  await page.addInitScript((cfg) => {
    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
      has_token: () => cfg.hasToken,
      is_oauth_configured: () => false,
      is_gitlab_oauth_configured: () => false,
      list_accounts: () =>
        cfg.hasToken
          ? { accounts: [cfg.account], activeId: cfg.account.id }
          : { accounts: [], activeId: null },
      get_cached_inbox: () => null,
      list_inbox: () => cfg.inbox,
      get_cached_subscribed: () => null,
      list_subscribed: () => ({ count: 0, prs: [] }),
      get_watched_repos: () => [],
      set_watched_repos: () => null,
      get_viewed_map: () => ({}),
      set_viewed_map: () => null,
      get_cached_pull_request_detail: () => null,
      get_pull_request_detail: () => cfg.detail,
      create_review_comment: (args) => ({
        id: 900,
        path: args.path,
        line: args.line,
        originalLine: null,
        side: args.side,
        diffHunk: "",
        body: args.body,
        user: "me",
        userAvatarUrl: "",
        createdAt: new Date().toISOString(),
        inReplyToId: null,
      }),
      create_issue_comment: () => null,
      submit_review: () => null,
      check_for_update: () => null,
      "plugin:opener|open_url": () => null,
      "plugin:opener|open": () => null,
    };

    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: (cmd: string, args?: Record<string, unknown>) => {
          const handler = handlers[cmd];
          if (!handler) {
            console.warn(`[e2e bridge] unhandled command: ${cmd}`);
            return Promise.resolve(null);
          }
          return Promise.resolve(handler(args ?? {}));
        },
        transformCallback: (() => {
          let id = 0;
          return () => ++id;
        })(),
        metadata: {
          currentWebview: { label: "main" },
          currentWindow: { label: "main" },
        },
      },
    });
  }, config);

  await page.goto("/");
}
