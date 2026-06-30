// Shared mock data + helpers for the design directions.
//
// Every direction renders the SAME review model so they're directly
// comparable. The shapes mirror the desktop app's data model (see
// apps/desktop/src/types.ts) but are trimmed to what a Review screen needs.
//
// No network, no external images: users carry initials + a colour so avatars
// render offline. Relative times are computed against a fixed NOW so the mock
// reads the same regardless of the wall clock.

export type FileStatus = "added" | "modified" | "removed" | "renamed";
export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
export type ReviewerStatus =
  | "pending"
  | "approved"
  | "changes"
  | "commented";

export interface MockUser {
  login: string;
  name: string;
  /** 2-letter avatar fallback (no network in the lab). */
  initials: string;
  /** Avatar background colour. */
  color: string;
}

export interface MockComment {
  id: number;
  author: MockUser;
  body: string;
  createdAt: string;
  /** 1-based line on the diff side this thread anchors to. */
  line: number;
  side: "LEFT" | "RIGHT";
  /** null for a thread root, else the id of the comment it replies to. */
  inReplyToId: number | null;
}

export interface PendingComment {
  id: string;
  line: number;
  side: "LEFT" | "RIGHT";
  body: string;
  author: MockUser;
}

export interface MockFile {
  filename: string;
  previousFilename?: string;
  status: FileStatus;
  language: string;
  additions: number;
  deletions: number;
  viewed: boolean;
  /** Unified diff. Empty for binary / no-textual-diff files. */
  patch: string;
  comments: MockComment[];
  pending: PendingComment[];
}

export interface MockPR {
  number: number;
  title: string;
  repo: string;
  owner: string;
  name: string;
  author: MockUser;
  state: "open" | "closed" | "merged";
  draft: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  baseRef: string;
  headRef: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  body: string;
  reviewers: { user: MockUser; status: ReviewerStatus }[];
}

export interface ReviewModel {
  pr: MockPR;
  files: MockFile[];
  /** Seed the selected file to the one carrying the live thread. */
  initialFileIndex: number;
  /** Total pending (batched) comments across all files. */
  pendingCount: number;
}

// ---------------------------------------------------------------------------
// Time — fixed NOW so relative labels are stable in a design mock.
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-06-30T16:12:00Z");

export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const sec = Math.round((NOW - then) / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Diff parsing — mirrors apps/desktop/src/lib/diff.ts
// ---------------------------------------------------------------------------

export type DiffRowType = "hunk" | "context" | "add" | "del";

export interface DiffRow {
  type: DiffRowType;
  content: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  rows: DiffRow[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

export function parsePatch(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];
  const lines = patch.split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = HUNK_RE.exec(line);
      oldLine = m ? parseInt(m[1], 10) : 0;
      newLine = m ? parseInt(m[2], 10) : 0;
      current = {
        header: line,
        rows: [{ type: "hunk", content: line, oldLine: null, newLine: null }],
      };
      hunks.push(current);
      continue;
    }
    if (!current) {
      current = { header: "", rows: [] };
      hunks.push(current);
    }
    if (line.startsWith("\\")) continue;

    const marker = line[0];
    const text = line.slice(1);
    if (marker === "+") {
      current.rows.push({ type: "add", content: text, oldLine: null, newLine });
      newLine += 1;
    } else if (marker === "-") {
      current.rows.push({ type: "del", content: text, oldLine, newLine: null });
      oldLine += 1;
    } else {
      current.rows.push({ type: "context", content: text, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return hunks;
}

// ---------------------------------------------------------------------------
// Lightweight syntax tokenizer (dependency-free). Directions theme the token
// types via CSS; see <Tokens> in highlight.tsx.
// ---------------------------------------------------------------------------

export type TokenType =
  | "kw"
  | "str"
  | "num"
  | "com"
  | "fn"
  | "type"
  | "punct"
  | "plain";

export interface Token {
  value: string;
  type: TokenType;
}

const KEYWORDS = new Set([
  "import", "from", "export", "default", "const", "let", "var", "function",
  "return", "if", "else", "for", "while", "switch", "case", "break",
  "continue", "new", "class", "extends", "interface", "type", "enum",
  "public", "private", "protected", "readonly", "async", "await", "yield",
  "try", "catch", "finally", "throw", "typeof", "instanceof", "in", "of",
  "void", "null", "undefined", "true", "false", "this", "super", "static",
  "get", "set", "as", "is", "keyof", "namespace", "declare", "abstract",
  "implements",
]);

export function tokenize(line: string, language: string): Token[] {
  if (language === "markdown" || language === "text") {
    return [{ value: line, type: "plain" }];
  }
  const out: Token[] = [];
  const n = line.length;
  let i = 0;
  const push = (value: string, type: TokenType) => {
    if (value) out.push({ value, type });
  };

  while (i < n) {
    const ch = line[i];

    // line comment
    if (ch === "/" && line[i + 1] === "/") {
      push(line.slice(i), "com");
      break;
    }
    // string / template literal (single line)
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < n && line[j] !== ch) {
        if (line[j] === "\\") j += 1;
        j += 1;
      }
      push(line.slice(i, Math.min(j + 1, n)), "str");
      i = j + 1;
      continue;
    }
    // number
    if (ch >= "0" && ch <= "9") {
      let j = i + 1;
      while (j < n && /[0-9._a-fxA-F]/.test(line[j])) j += 1;
      push(line.slice(i, j), "num");
      i = j;
      continue;
    }
    // identifier
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(line[j])) j += 1;
      const word = line.slice(i, j);
      let type: TokenType = "plain";
      if (KEYWORDS.has(word)) type = "kw";
      else if (/^[A-Z]/.test(word)) type = "type";
      else if (line[j] === "(") type = "fn";
      push(word, type);
      i = j;
      continue;
    }
    // whitespace
    if (/\s/.test(ch)) {
      let j = i + 1;
      while (j < n && /\s/.test(line[j])) j += 1;
      push(line.slice(i, j), "plain");
      i = j;
      continue;
    }
    // punctuation / operators (stop before a line comment)
    let j = i + 1;
    while (
      j < n &&
      /[^A-Za-z0-9_$\s"'`]/.test(line[j]) &&
      !(line[j] === "/" && line[j + 1] === "/")
    ) {
      j += 1;
    }
    push(line.slice(i, j), "punct");
    i = j;
  }
  return out;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

const mira: MockUser = {
  login: "mira-okafor",
  name: "Mira Okafor",
  initials: "MO",
  color: "#7c6cff",
};
const theo: MockUser = {
  login: "theo-sandberg",
  name: "Theo Sandberg",
  initials: "TS",
  color: "#2f9bd4",
};
const dann: MockUser = {
  login: "dann-keller",
  name: "Dann Keller",
  initials: "DK",
  color: "#e0683b",
};
const you: MockUser = {
  login: "you",
  name: "You",
  initials: "YO",
  color: "#3f9d57",
};

export const PEOPLE = { mira, theo, dann, you };

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

const files: MockFile[] = [
  {
    filename: "src/keyboard/useHotkeys.ts",
    status: "modified",
    language: "ts",
    additions: 11,
    deletions: 7,
    viewed: false,
    patch: [
      "@@ -1,9 +1,12 @@",
      '-import { useEffect } from "react";',
      '-import { useKeyboardContext } from "./context";',
      '+import { useEffect, useRef } from "react";',
      '+import { useKeyboardContext } from "./KeyboardProvider";',
      '+import type { Binding, Scope } from "./types";',
      " ",
      "-export function useHotkeys(scope, bindings) {",
      "-  const ctx = useKeyboardContext();",
      "+export function useHotkeys(scope: Scope, bindings: Binding[], opts: Options = {}) {",
      "+  const ctx = useKeyboardContext();",
      "+  const ref = useRef(bindings);",
      "+  ref.current = bindings;",
      " ",
      "   useEffect(() => {",
      "-    ctx.register(scope, bindings);",
      "-    return () => ctx.unregister(scope, bindings);",
      "-  }, [scope]);",
      "+    const unregister = ctx.register(scope, ref.current, opts);",
      "+    if (opts.activate !== false) ctx.activate(scope);",
      "+    return unregister;",
      "+  }, [scope, ctx, opts.activate, opts.enabled]);",
      " }",
    ].join("\n"),
    comments: [
      {
        id: 1,
        author: theo,
        body: "Holding `bindings` in a ref means the effect closes over a stale array after the first render. If a binding's `run` changes (it does for the palette), we dispatch the old handler. Can we depend on a stable key set instead?",
        createdAt: "2026-06-30T13:40:00Z",
        line: 11,
        side: "RIGHT",
        inReplyToId: null,
      },
      {
        id: 2,
        author: mira,
        body: "Good catch — `run` is recreated each render. I'll hash the binding keys and depend on that, so the effect re-runs when the *set* changes, not on every render.",
        createdAt: "2026-06-30T15:10:00Z",
        line: 11,
        side: "RIGHT",
        inReplyToId: 1,
      },
    ],
    pending: [
      {
        id: "p1",
        line: 7,
        side: "RIGHT",
        body: "nit: name this `bindingsRef` for symmetry with the rest of the file.",
        author: you,
      },
    ],
  },
  {
    filename: "src/keyboard/KeyboardProvider.tsx",
    status: "added",
    language: "tsx",
    additions: 28,
    deletions: 0,
    viewed: false,
    patch: [
      "@@ -0,0 +1,28 @@",
      '+import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";',
      '+import type { ReactNode } from "react";',
      '+import type { Binding, Scope } from "./types";',
      '+import { matchSequence } from "../lib/sequence";',
      "+",
      "+interface KeyboardState {",
      "+  register: (scope: Scope, bindings: Binding[], opts: RegisterOpts) => () => void;",
      "+  activate: (scope: Scope) => void;",
      "+  active: Scope;",
      "+}",
      "+",
      "+const Ctx = createContext<KeyboardState | null>(null);",
      "+",
      "+export function KeyboardProvider({ children }: { children: ReactNode }) {",
      '+  const [active, setActive] = useState<Scope>("inbox");',
      "+  const registry = useRef(new Map<Scope, Binding[]>());",
      "+",
      "+  const register = useCallback((scope, bindings) => {",
      "+    const list = registry.current.get(scope) ?? [];",
      "+    registry.current.set(scope, [...list, ...bindings]);",
      "+    return () => registry.current.set(scope, list);",
      "+  }, []);",
      "+",
      "+  const value = useMemo(() => ({ register, activate: setActive, active }), [register, active]);",
      "+  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;",
      "+}",
      "+",
      "+export const useKeyboardContext = () => useContext(Ctx)!;",
    ].join("\n"),
    comments: [],
    pending: [],
  },
  {
    filename: "src/keyboard/types.ts",
    status: "modified",
    language: "ts",
    additions: 5,
    deletions: 1,
    viewed: true,
    patch: [
      "@@ -1,6 +1,11 @@",
      "-export type Scope = string;",
      '+export type Scope = "global" | "inbox" | "review" | "palette" | "help";',
      " ",
      " export interface Binding {",
      "   keys: string | string[];",
      "+  /** Shown in the `?` overlay and the status-bar legend. */",
      "   description: string;",
      "+  group: string;",
      "   run: (e: KeyboardEvent) => void;",
      "+  /** Register without stealing the active scope. */",
      "+  global?: boolean;",
      " }",
    ].join("\n"),
    comments: [],
    pending: [],
  },
  {
    filename: "src/lib/sequence.ts",
    status: "added",
    language: "ts",
    additions: 13,
    deletions: 0,
    viewed: false,
    patch: [
      "@@ -0,0 +1,13 @@",
      "+/** Match vim-style key sequences (]c, [c) without swallowing the next key. */",
      "+export function matchSequence(buffer: string[], keys: string): boolean {",
      "+  if (keys.length !== buffer.length) return false;",
      "+  for (let i = 0; i < keys.length; i++) {",
      "+    if (keys[i] !== buffer[i]) return false;",
      "+  }",
      "+  return true;",
      "+}",
      "+",
      "+export function isSequencePrefix(buffer: string[], all: string[]): boolean {",
      '+  const joined = buffer.join("");',
      "+  return all.some((k) => k.startsWith(joined) && k.length > joined.length);",
      "+}",
    ].join("\n"),
    comments: [],
    pending: [],
  },
  {
    filename: "src/components/StatusBar.tsx",
    status: "modified",
    language: "tsx",
    additions: 3,
    deletions: 1,
    viewed: false,
    patch: [
      "@@ -10,9 +10,12 @@ const HINTS: Record<string, Hint[]> = {",
      "   review: [",
      '     { keys: ["n", "p"], label: "Files" },',
      '     { keys: ["space"], label: "Page" },',
      '-    { keys: ["c"], label: "Comment" },',
      '+    { keys: ["e"], label: "Viewed + next" },',
      '+    { keys: ["v"], label: "Viewed" },',
      '     { keys: ["s"], label: "Submit" },',
      '+    { keys: ["]c", "[c"], label: "Threads" },',
      '     { keys: ["esc"], label: "Back" },',
      "   ],",
      " };",
    ].join("\n"),
    comments: [
      {
        id: 3,
        author: theo,
        body: "Can the legend wrap on narrow windows instead of truncating? Folks on 13\" laptops lose the last two hints.",
        createdAt: "2026-06-29T18:00:00Z",
        line: 16,
        side: "RIGHT",
        inReplyToId: null,
      },
    ],
    pending: [],
  },
  {
    filename: "src/keyboard/index.ts",
    previousFilename: "src/hooks/useKeys.ts",
    status: "renamed",
    language: "ts",
    additions: 2,
    deletions: 1,
    viewed: true,
    patch: [
      "@@ -1,4 +1,4 @@",
      '-export { useKeys } from "./useKeys";',
      '+export { useHotkeys } from "./useHotkeys";',
      '+export { KeyboardProvider, useKeyboardContext } from "./KeyboardProvider";',
      ' export type { Binding, Scope } from "./types";',
    ].join("\n"),
    comments: [],
    pending: [],
  },
  {
    filename: "package.json",
    status: "modified",
    language: "json",
    additions: 1,
    deletions: 0,
    viewed: true,
    patch: [
      "@@ -14,6 +14,7 @@",
      '     "react": "^19.1.0",',
      '     "react-dom": "^19.1.0",',
      '     "zustand": "^5.0.0",',
      '+    "tinykeys": "^3.0.0"',
      "   },",
    ].join("\n"),
    comments: [],
    pending: [],
  },
  {
    filename: "README.md",
    status: "modified",
    language: "markdown",
    additions: 3,
    deletions: 1,
    viewed: false,
    patch: [
      "@@ -22,7 +22,9 @@ Keyboard-first PR review.",
      " ## Shortcuts",
      " ",
      "-Press `?` to see all shortcuts.",
      "+Press `?` anywhere to see every shortcut, generated from the live bindings.",
      "+Single-key shortcuts are scope-aware: only the screen you're on responds,",
      "+while `⌘K` and `?` work everywhere.",
    ].join("\n"),
    comments: [],
    pending: [],
  },
];

// ---------------------------------------------------------------------------
// The pull request
// ---------------------------------------------------------------------------

const prBody = [
  "Replaces the ad-hoc `keydown` listeners with a **scope-aware keyboard layer**.",
  "Bindings register per scope (`inbox`, `review`, `palette`, …); only the active",
  "scope's single-key bindings fire, while `⌘K` and `?` stay global.",
  "",
  "### Why",
  "",
  "- One source of truth for shortcuts — the `?` overlay and the status-bar legend",
  "  generate from the live bindings, so they can never drift.",
  "- Vim-style sequences (`]c`, `[c`) without swallowing the next keystroke.",
  "",
  "### Notes",
  "",
  "- `useHotkeys(scope, bindings, { activate })` — pass `activate: false` to register",
  "  without stealing focus from the active scope.",
  "- Closes #112.",
].join("\n");

export const REVIEW: ReviewModel = {
  pr: {
    number: 128,
    title: "feat(keyboard): scope-aware hotkey layer with sequence support",
    repo: "pr-flow/pr-flow",
    owner: "pr-flow",
    name: "pr-flow",
    author: mira,
    state: "open",
    draft: false,
    additions: 66,
    deletions: 11,
    changedFiles: files.length,
    commits: 5,
    baseRef: "main",
    headRef: "feat/keyboard-layer",
    createdAt: "2026-06-27T09:20:00Z",
    updatedAt: "2026-06-30T14:05:00Z",
    url: "https://github.com/pr-flow/pr-flow/pull/128",
    body: prBody,
    reviewers: [
      { user: you, status: "pending" },
      { user: theo, status: "commented" },
      { user: dann, status: "approved" },
    ],
  },
  files,
  initialFileIndex: 0,
  pendingCount: 1,
};

/** Total comment count across all files (threads + replies). */
export function totalComments(model: ReviewModel): number {
  return model.files.reduce((n, f) => n + f.comments.length, 0);
}

/** Viewed file count. */
export function viewedCount(model: ReviewModel): number {
  return model.files.filter((f) => f.viewed).length;
}
