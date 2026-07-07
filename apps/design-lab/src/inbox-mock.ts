/**
 * Inbox mock — a spread of PRs across the four tabs so the list, its density,
 * unread dots, and the zero-state can all be designed against realistic data.
 * Reuses the same people as the Review mock; times are relative to the same
 * fixed NOW (see mock.ts).
 *
 * InboxPR: `unread` drives the iris dot (not opened since last change);
 * `myReview` is your verdict when relevant to the tab; `checks` is CI signal,
 * surfaced only when failing. PRDetail is side-pane content for the selected PR.
 * RECENT_PRS seeds the empty `/` search pane.
 */

import { PEOPLE, type MockUser, type ReviewerStatus } from "./mock";

const { mira, theo, dann, you } = PEOPLE;

export type InboxTab = "requests" | "assigned" | "created" | "involved";

export interface InboxPR {
  number: number;
  title: string;
  repo: string;
  author: MockUser;
  draft: boolean;
  state: "open" | "merged" | "closed";
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: number;
  updatedAt: string;
  unread: boolean;
  myReview?: ReviewerStatus;
  checks?: "passing" | "failing" | "pending";
  tabs: InboxTab[];
}

export interface PRDetail {
  branch: string;
  summary: string;
  reviewers: { user: MockUser; status: ReviewerStatus }[];
}

export const PR_DETAIL: Record<number, PRDetail> = {
  128: {
    branch: "feat/keyboard-layer",
    summary:
      "Replaces the ad-hoc keydown listeners with a scope-aware keyboard layer. Bindings register per scope; only the active scope's single-key bindings fire, while ⌘K and ? stay global.",
    reviewers: [
      { user: you, status: "pending" },
      { user: theo, status: "commented" },
      { user: dann, status: "approved" },
    ],
  },
  131: {
    branch: "fix/cursor-in-view",
    summary:
      "Keeps the diff line cursor visible when a hunk collapses — scrolls the nearest visible row into view instead of leaving the cursor stranded off-screen.",
    reviewers: [
      { user: you, status: "pending" },
      { user: mira, status: "pending" },
    ],
  },
  124: {
    branch: "perf/cache-first-paint",
    summary:
      "Paints cached PRs from the local store immediately, then reconciles against the network in the background. Opening a seen PR no longer waits on a request.",
    reviewers: [
      { user: you, status: "commented" },
      { user: theo, status: "approved" },
    ],
  },
  133: {
    branch: "chore/tauri-2.4",
    summary:
      "Bumps Tauri to 2.4 and drops the hand-rolled updater shim now that the built-in updater covers the loopback flow.",
    reviewers: [{ user: you, status: "pending" }],
  },
  130: {
    branch: "feat/inbox-search",
    summary:
      "Adds a transient search: pressing / opens a full search pane over the inbox with recent PRs and live results across every tab.",
    reviewers: [
      { user: mira, status: "approved" },
      { user: dann, status: "pending" },
    ],
  },
  127: {
    branch: "refactor/ui-package",
    summary:
      "Promotes the hand-rolled review primitives into @pr-flow/ui so the desktop app and the design lab share one component layer. Still a draft — the modal shell isn't moved yet.",
    reviewers: [{ user: theo, status: "pending" }],
  },
  119: {
    branch: "docs/backlog",
    summary:
      "Documents the scope-aware keyboard model and the full view inventory that this design rework builds against.",
    reviewers: [{ user: mira, status: "approved" }],
  },
  122: {
    branch: "fix/oauth-port",
    summary:
      "Falls back to a token prompt when the OAuth loopback port is already taken, instead of failing sign-in outright.",
    reviewers: [
      { user: you, status: "commented" },
      { user: dann, status: "changes" },
    ],
  },
};

export const TAB_LABELS: Record<InboxTab, string> = {
  requests: "Review requests",
  assigned: "Assigned",
  created: "Created",
  involved: "Involved",
};

export const TAB_ORDER: InboxTab[] = ["requests", "assigned", "created", "involved"];

export const INBOX: InboxPR[] = [
  {
    number: 128,
    title: "feat(keyboard): scope-aware hotkey layer with sequence support",
    repo: "pr-flow/pr-flow",
    author: mira,
    draft: false,
    state: "open",
    additions: 66,
    deletions: 11,
    changedFiles: 8,
    comments: 3,
    updatedAt: "2026-06-30T14:05:00Z",
    unread: true,
    myReview: "pending",
    checks: "passing",
    tabs: ["requests", "involved"],
  },
  {
    number: 131,
    title: "fix(diff): keep the line cursor in view when a hunk collapses",
    repo: "pr-flow/pr-flow",
    author: theo,
    draft: false,
    state: "open",
    additions: 24,
    deletions: 18,
    changedFiles: 3,
    comments: 1,
    updatedAt: "2026-06-30T11:20:00Z",
    unread: true,
    myReview: "pending",
    checks: "failing",
    tabs: ["requests", "involved"],
  },
  {
    number: 124,
    title: "perf(cache): paint cached PRs before the network reconciles",
    repo: "pr-flow/pr-flow",
    author: dann,
    draft: false,
    state: "open",
    additions: 143,
    deletions: 52,
    changedFiles: 11,
    comments: 6,
    updatedAt: "2026-06-29T16:40:00Z",
    unread: false,
    myReview: "commented",
    checks: "passing",
    tabs: ["requests", "involved"],
  },
  {
    number: 133,
    title: "chore(deps): bump tauri to 2.4 and drop the updater shim",
    repo: "pr-flow/pr-flow",
    author: dann,
    draft: false,
    state: "open",
    additions: 9,
    deletions: 41,
    changedFiles: 4,
    comments: 0,
    updatedAt: "2026-06-30T09:05:00Z",
    unread: false,
    myReview: "pending",
    checks: "pending",
    tabs: ["assigned", "involved"],
  },
  {
    number: 130,
    title: "feat(inbox): transient `/` search over the current tab",
    repo: "pr-flow/pr-flow",
    author: you,
    draft: false,
    state: "open",
    additions: 88,
    deletions: 7,
    changedFiles: 5,
    comments: 4,
    updatedAt: "2026-06-30T15:32:00Z",
    unread: false,
    checks: "passing",
    tabs: ["created", "involved"],
  },
  {
    number: 127,
    title: "refactor(review): promote ui primitives into @pr-flow/ui",
    repo: "pr-flow/pr-flow",
    author: you,
    draft: true,
    state: "open",
    additions: 210,
    deletions: 96,
    changedFiles: 19,
    comments: 2,
    updatedAt: "2026-06-28T20:10:00Z",
    unread: false,
    checks: "pending",
    tabs: ["created", "involved"],
  },
  {
    number: 119,
    title: "docs: keyboard model + full view inventory",
    repo: "pr-flow/pr-flow",
    author: you,
    draft: false,
    state: "merged",
    additions: 312,
    deletions: 4,
    changedFiles: 2,
    comments: 8,
    updatedAt: "2026-06-27T13:00:00Z",
    unread: false,
    checks: "passing",
    tabs: ["created", "involved"],
  },
  {
    number: 122,
    title: "fix(auth): fall back to PAT when the OAuth loopback port is taken",
    repo: "pr-flow/pr-flow",
    author: theo,
    draft: false,
    state: "open",
    additions: 37,
    deletions: 14,
    changedFiles: 2,
    comments: 5,
    updatedAt: "2026-06-29T10:15:00Z",
    unread: false,
    checks: "passing",
    tabs: ["involved"],
  },
];

export function forTab(tab: InboxTab): InboxPR[] {
  return INBOX.filter((pr) => pr.tabs.includes(tab));
}

export function tabCount(tab: InboxTab): number {
  return forTab(tab).filter((pr) => pr.unread).length;
}

export function byNumber(n: number): InboxPR | undefined {
  return INBOX.find((pr) => pr.number === n);
}

export const RECENT_PRS: InboxPR[] = [124, 119, 130, 122]
  .map(byNumber)
  .filter((pr): pr is InboxPR => Boolean(pr));

export function searchPRs(query: string): InboxPR[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return INBOX.filter(
    (pr) =>
      pr.title.toLowerCase().includes(q) ||
      pr.author.name.toLowerCase().includes(q) ||
      pr.repo.toLowerCase().includes(q) ||
      String(pr.number).includes(q),
  );
}
