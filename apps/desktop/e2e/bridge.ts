import type { Page } from "@playwright/test";
import { ACCOUNT, DETAIL, INBOX } from "./fixtures";
import type { BucketFixture, InboxFixture } from "./fixtures";

// The mocked Tauri bridge. @tauri-apps/api routes every call through
// `window.__TAURI_INTERNALS__.invoke`, so defining it before the app loads
// makes the real frontend run against fixtures — no Rust, no network.

export interface AppOptions {
  /** false boots into the sign-in gate. */
  hasToken?: boolean;
  /**
   * PR-detail payload per document load: index 0 serves the first load, 1 the
   * first reload, … (the last entry repeats). Lets a test change a PR "server
   * side" across a reload — e.g. the auto-unview-on-content-change flow.
   */
  detailByLoad?: unknown[];
  /**
   * PR-detail payload per pr_detail CALL within one page load (the last entry
   * repeats) — lets the "server" move mid-session without a reload, e.g. the
   * inbox-heartbeat refresh flow. Takes precedence over detailByLoad.
   */
  detailByCall?: unknown[];
  /** Inbox payload per list_inbox call (the last entry repeats). */
  inboxByCall?: unknown[];
  /** Override the four inbox buckets. */
  inbox?: InboxFixture;
  /** Override the watched-repos ("Watching") bucket. */
  subscribed?: BucketFixture;
  /** Repositories pre-listed in the watch dialog. */
  watchedRepos?: string[];
}

export async function setupApp(page: Page, opts: AppOptions = {}) {
  const config = {
    hasToken: opts.hasToken ?? true,
    inbox: opts.inbox ?? INBOX,
    subscribed: opts.subscribed ?? { count: 0, prs: [] },
    detail: DETAIL,
    detailByLoad: opts.detailByLoad ?? null,
    detailByCall: opts.detailByCall ?? null,
    inboxByCall: opts.inboxByCall ?? null,
    watchedRepos: opts.watchedRepos ?? [],
    account: ACCOUNT,
  };

  await page.addInitScript((cfg) => {
    // Which document load is this? The init script runs once per navigation,
    // so a localStorage counter (fresh per test context) tells reloads apart.
    const load = Number(localStorage.getItem("e2e:load") ?? "0");
    localStorage.setItem("e2e:load", String(load + 1));
    const byLoad = cfg.detailByLoad;
    const detail = byLoad
      ? byLoad[Math.min(load, byLoad.length - 1)]
      : cfg.detail;
    // Per-call sequences (clamped to their last entry).
    let detailCalls = 0;
    let inboxCalls = 0;
    const seq = (arr: unknown[] | null, n: number, fallback: unknown) =>
      arr ? arr[Math.min(n, arr.length - 1)] : fallback;

    const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
      has_token: () => cfg.hasToken,
      is_oauth_configured: () => false,
      is_gitlab_oauth_configured: () => false,
      list_accounts: () =>
        cfg.hasToken
          ? { accounts: [cfg.account], activeId: cfg.account.id }
          : { accounts: [], activeId: null },
      get_cached_inbox: () => null,
      list_inbox: () => seq(cfg.inboxByCall, inboxCalls++, cfg.inbox),
      get_cached_subscribed: () => null,
      list_subscribed: () => cfg.subscribed,
      get_watched_repos: () => cfg.watchedRepos,
      set_watched_repos: () => null,
      // Viewed marks persist in localStorage so they survive a reload, like
      // the real Rust JSON file survives an app restart.
      get_viewed_map: () =>
        JSON.parse(localStorage.getItem("e2e:viewed") ?? "{}"),
      set_viewed_map: (args) => {
        localStorage.setItem("e2e:viewed", JSON.stringify(args.map));
        return null;
      },
      get_cached_pull_request_detail: () => null,
      get_pull_request_detail: () => seq(cfg.detailByCall, detailCalls++, detail),
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
