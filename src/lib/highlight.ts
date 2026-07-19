import hljs from "highlight.js";
import { createElement, type ReactNode } from "react";
import { type DiffHunk, type DiffRow, parsePatch } from "./diff.ts";
import { findMatchRangesInLine } from "./find-in-diff.ts";
import { occurrenceRangesInLine } from "./occurrences.ts";

/**
 * Best-effort, per-line syntax highlighting for the diff viewer. Highlighting
 * is done line-by-line (so diff backgrounds can layer behind tokens), memoized,
 * and degrades gracefully to escaped plain text when the language is unknown.
 */

const LANG_BY_EXT: Record<string, string> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cfg: "ini",
  cjs: "javascript",
  clj: "clojure",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  dart: "dart",
  dockerfile: "dockerfile",
  ex: "elixir",
  exs: "elixir",
  fish: "bash",
  go: "go",
  h: "c",
  hpp: "cpp",
  hs: "haskell",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  lua: "lua",
  makefile: "makefile",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  pl: "perl",
  proto: "protobuf",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  scala: "scala",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svelte: "xml",
  svg: "xml",
  swift: "swift",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  vue: "xml",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

function langForFilename(filename: string): string | null {
  const base = (filename.split("/").pop() ?? filename).toLowerCase();
  if (base === "dockerfile") {
    return "dockerfile";
  }
  if (base === "makefile") {
    return "makefile";
  }
  const parts = base.split(".");
  const ext = parts.length > 1 ? (parts.at(-1) ?? "") : "";
  const lang = LANG_BY_EXT[ext];
  if (!lang) {
    return null;
  }
  return hljs.getLanguage(lang) ? lang : null;
}

export function isHighlightable(filename: string): boolean {
  return langForFilename(filename) !== null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const cache = new Map<string, string>();

/**
 * Languages whose block comments continue as ` * …` lines. Highlighting is
 * per-line, so a continuation line has no `/*` opener and would otherwise be
 * tokenized as code (identifiers, operators) instead of reading as a comment.
 */

const C_BLOCK_COMMENT_LANGS = new Set([
  "typescript",
  "javascript",
  "java",
  "kotlin",
  "c",
  "cpp",
  "csharp",
  "swift",
  "scala",
  "go",
  "rust",
  "php",
  "dart",
  "css",
  "scss",
  "less",
  "protobuf",
]);

/** `* text`, a bare `*`, or a closing star-slash — a block-comment continuation. */

const COMMENT_CONTINUATION = /^\s*\*(?:$|[\s/])/;

/**
 * Handles a row that `markBlockCommentRows` says starts inside an
 * unterminated block comment but doesn't match COMMENT_CONTINUATION (no
 * leading `*`) — the case that regex alone misses (see BACKLOG.md "Inbox
 * (2026-07-18)"). If the comment's closing marker appears on this line, only
 * the text up to and including it is treated as a comment; the rest is
 * highlighted normally (a comment reopening later on the same line is not
 * handled — rare enough to leave for a future pass).
 */
function highlightOpenComment(code: string, filename: string): string {
  const closeAt = code.indexOf("*/");
  if (closeAt === -1) {
    return `<span class="hljs-comment">${escapeHtml(code)}</span>`;
  }
  const commentHtml = escapeHtml(code.slice(0, closeAt + 2));
  const rest = code.slice(closeAt + 2);
  const restHtml = rest.length > 0 ? highlightLine(rest, filename) : "";
  return `<span class="hljs-comment">${commentHtml}</span>${restHtml}`;
}

/**
 * Returns an HTML string (hljs token spans) for a single line of code.
 * `startsInComment` (from `markBlockCommentRows`) marks a line that continues
 * an unterminated block comment from a previous row — otherwise per-line
 * highlighting has no way to know it's still inside a comment.
 * Safe to dangerouslySetInnerHTML — input is highlighted or HTML-escaped.
 */
export function highlightLine(
  code: string,
  filename: string,
  startsInComment = false
): string {
  if (code.length === 0) {
    return "";
  }
  const lang = langForFilename(filename);
  if (!lang) {
    return escapeHtml(code);
  }

  if (C_BLOCK_COMMENT_LANGS.has(lang)) {
    if (COMMENT_CONTINUATION.test(code)) {
      return `<span class="hljs-comment">${escapeHtml(code)}</span>`;
    }
    if (startsInComment) {
      return highlightOpenComment(code, filename);
    }
  }

  const key = `${lang}\0${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    return hit;
  }

  let html: string;
  try {
    html = hljs.highlight(code, { ignoreIllegals: true, language: lang }).value;
  } catch {
    html = escapeHtml(code);
  }

  if (cache.size > 30_000) {
    cache.clear();
  }
  cache.set(key, html);
  return html;
}

/**
 * For C-style languages, walks a file's hunks in row order and records which
 * rows START inside an unterminated block comment — the input `markKind`
 * check in `highlightLine`'s COMMENT_CONTINUATION only catches continuation
 * lines with a leading `*`; this covers flowing block comments that don't.
 * State resets at each hunk boundary (content between visible hunks isn't
 * available to scan) and del/add rows from either side of the diff are
 * walked in patch order, same as every other per-row computation in this
 * codebase. Best-effort: ignores string/char literals, so a literal `/*` or
 * comment-closer inside a string can throw off tracking until the next real
 * boundary — acceptable for a "best-effort" highlighter (see file doc above).
 */
export function markBlockCommentRows(
  hunks: readonly DiffHunk[],
  filename: string
): ReadonlyMap<DiffRow, boolean> {
  const out = new Map<DiffRow, boolean>();
  const lang = langForFilename(filename);
  if (!(lang && C_BLOCK_COMMENT_LANGS.has(lang))) {
    return out;
  }
  for (const hunk of hunks) {
    let inComment = false;
    for (const row of hunk.rows) {
      if (row.type === "hunk") {
        continue;
      }
      out.set(row, inComment);
      inComment = advanceBlockComment(row.content, inComment);
    }
  }
  return out;
}

/** Scans one line for `/*`/comment-closer pairs, returning whether it ends still open. */
function advanceBlockComment(line: string, inComment: boolean): boolean {
  let open = inComment;
  let i = 0;
  while (i < line.length) {
    if (open) {
      const end = line.indexOf("*/", i);
      if (end === -1) {
        return true;
      }
      open = false;
      i = end + 2;
    } else {
      const start = line.indexOf("/*", i);
      if (start === -1) {
        return false;
      }
      open = true;
      i = start + 2;
    }
  }
  return open;
}

/**
 * Pre-highlights every line of every patch during IDLE time, so scrolling a
 * section into view (which mounts and highlights its rows synchronously)
 * finds the per-line cache already hot. Without this, each section mounting
 * mid-scroll stalls the frame for the length of an hljs pass over the whole
 * file — the single biggest source of scroll jank on large PRs.
 *
 * Returns a cancel function; work runs in idle slices and never blocks input.
 */
export function warmHighlightCache(
  files: ReadonlyArray<{ filename: string; patch?: string | null }>
): () => void {
  const queue: [code: string, filename: string, startsInComment: boolean][] =
    [];
  for (const f of files) {
    if (!(f.patch && isHighlightable(f.filename))) {
      continue;
    }
    const hunks = parsePatch(f.patch);
    const commentByRow = markBlockCommentRows(hunks, f.filename);
    for (const hunk of hunks) {
      for (const row of hunk.rows) {
        if (row.type === "hunk") {
          continue;
        }
        queue.push([row.content, f.filename, commentByRow.get(row) ?? false]);
      }
    }
  }

  let i = 0;
  let cancelled = false;
  const idle: typeof requestIdleCallback | undefined =
    typeof requestIdleCallback === "function" ? requestIdleCallback : undefined;

  function pump(deadline?: IdleDeadline) {
    if (cancelled) {
      return;
    }

    const budgetEnd = performance.now() + 6;
    while (i < queue.length) {
      const out =
        deadline === undefined
          ? performance.now() > budgetEnd
          : deadline.timeRemaining() < 2;
      if (out) {
        break;
      }
      highlightLine(queue[i][0], queue[i][1], queue[i][2]);
      i += 1;
    }
    if (i < queue.length) {
      schedule();
    }
  }

  function schedule() {
    if (idle) {
      idle(pump, { timeout: 1000 });
    } else {
      setTimeout(pump, 32);
    }
  }

  schedule();
  return () => {
    cancelled = true;
  };
}

interface MarkRange {
  className: string;
  end: number;
  start: number;
}

/** Intraline word-diff ranges (lib/intraline), as [start, end) code columns. */
export type IntraRanges = readonly [number, number][] | null;

/**
 * Layers intraline emphasis under the search/occurrence marks. The layering
 * order is intraline → find/occurrence: wrapMarkRanges walks
 * text nodes, so each later pass marks text inside the earlier passes' marks
 * just fine (nesting), while the reverse order would let an intraline span
 * swallow a find mark's boundary.
 */
function withIntra(html: string, intra: IntraRanges): string {
  if (!intra || intra.length === 0) {
    return html;
  }
  return wrapMarkRanges(
    html,
    intra.map(([start, end]) => ({
      className: "qf-intra-mark",
      end,
      start,
    }))
  );
}

/**
 * Wraps character ranges of the ORIGINAL code in `<mark>` elements by walking
 * the rendered text nodes (hljs spans don't add or drop characters, so text
 * offsets line up 1:1 with code offsets). Marks are applied per text node, so
 * a match spanning token boundaries stays seamless. Ranges must be sorted and
 * non-overlapping — both producers below guarantee that.
 */
function wrapMarkRanges(html: string, ranges: MarkRange[]): string {
  if (ranges.length === 0) {
    return html;
  }
  const root = document.createElement("span");
  root.innerHTML = html;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) {
    texts.push(walker.currentNode as Text);
  }

  let offset = 0;
  for (const node of texts) {
    const len = node.data.length;
    const start = offset;
    offset += len;

    const local: MarkRange[] = [];
    for (const r of ranges) {
      const s = Math.max(r.start - start, 0);
      const e = Math.min(r.end - start, len);
      if (s < e) {
        local.push({ className: r.className, end: e, start: s });
      }
    }
    if (local.length === 0) {
      continue;
    }
    const frag = document.createDocumentFragment();
    let pos = 0;
    for (const { start: s, end: e, className } of local) {
      if (s > pos) {
        frag.appendChild(document.createTextNode(node.data.slice(pos, s)));
      }
      const mark = document.createElement("mark");
      mark.className = className;
      mark.textContent = node.data.slice(s, e);
      frag.appendChild(mark);
      pos = e;
    }
    if (pos < len) {
      frag.appendChild(document.createTextNode(node.data.slice(pos)));
    }
    node.parentNode?.replaceChild(frag, node);
  }
  return root.innerHTML;
}

function domNodeToReactNode(node: ChildNode, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  const el = node as Element;
  const children = Array.from(el.childNodes).map((child, i) =>
    domNodeToReactNode(child, `${key}-${i}`)
  );
  return createElement(
    el.tagName.toLowerCase(),
    { className: el.className || undefined, key },
    ...children
  );
}

/**
 * Converts one of the highlighted-line HTML strings above into a React node
 * tree, so the diff view can render it without `dangerouslySetInnerHTML`.
 * Parses into a detached `<template>` (never attached to the document, so
 * this is inert regardless of the string's contents) and walks the result —
 * safe even though the *shape* of the highlighter output isn't hand-audited,
 * since nothing here ever reaches the live DOM as markup.
 */
export function highlightHtmlToNodes(html: string): ReactNode[] {
  if (html.length === 0) {
    return [];
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  return Array.from(template.content.childNodes).map((node, i) =>
    domNodeToReactNode(node, String(i))
  );
}

/**
 * Syntax-highlighted line with intraline word-diff emphasis (`qf-intra-mark`)
 * layered over it — the plain-diff path when no find/occurrence marks are
 * active. Safe to dangerouslySetInnerHTML (same guarantees as highlightLine).
 */
export function highlightLineWithIntra(
  code: string,
  filename: string,
  intra: IntraRanges,
  startsInComment = false
): string {
  return withIntra(highlightLine(code, filename, startsInComment), intra);
}

/**
 * Syntax-highlighted line with every case-insensitive occurrence of `query`
 * wrapped in `<mark class="q-hl">` (the search surfaces' highlight).
 * Safe to dangerouslySetInnerHTML (same guarantees as highlightLine).
 */
export function highlightLineWithMatch(
  code: string,
  filename: string,
  query: string
): string {
  const html = highlightLine(code, filename);
  const q = query.trim();
  if (!q || code.length === 0) {
    return html;
  }
  return wrapMarkRanges(
    html,
    findMatchRangesInLine(code, q).map(([start, end]) => ({
      className: "q-hl",
      end,
      start,
    }))
  );
}

/**
 * Syntax-highlighted line for the find-in-diff bar: every occurrence of
 * `query` gets `<mark class="qf-find-mark">`, and the occurrence at
 * `currentOrdinal` (0-based, left to right) additionally gets
 * `qf-find-current`. Occurrences are computed with the same matcher that
 * builds the navigable match list, so screen and counter always agree.
 * Safe to dangerouslySetInnerHTML (same guarantees as highlightLine).
 */
export function highlightLineWithFind(
  code: string,
  filename: string,
  query: string,
  caseSensitive: boolean,
  currentOrdinal: number | null,
  intra: IntraRanges = null,
  startsInComment = false
): string {
  const html = withIntra(highlightLine(code, filename, startsInComment), intra);
  if (!query || code.length === 0) {
    return html;
  }
  return wrapMarkRanges(
    html,
    findMatchRangesInLine(code, query, caseSensitive).map(
      ([start, end], i) => ({
        className:
          i === currentOrdinal
            ? "qf-find-mark qf-find-current"
            : "qf-find-mark",
        end,
        start,
      })
    )
  );
}

/**
 * Syntax-highlighted line for selection-occurrence highlighting: every
 * occurrence of the selected text gets `<mark class="qf-occ-mark">` (a quieter
 * treatment than the find marks — see quiet.css). The selected occurrence gets
 * no special class; the native selection paint already singles it out.
 * Safe to dangerouslySetInnerHTML (same guarantees as highlightLine).
 */
export function highlightLineWithOccurrences(
  code: string,
  filename: string,
  query: string,
  wholeWord: boolean,
  intra: IntraRanges = null,
  startsInComment = false
): string {
  const html = withIntra(highlightLine(code, filename, startsInComment), intra);
  if (!query || code.length === 0) {
    return html;
  }
  return wrapMarkRanges(
    html,
    occurrenceRangesInLine(code, { query, wholeWord }).map(([start, end]) => ({
      className: "qf-occ-mark",
      end,
      start,
    }))
  );
}

/**
 * The kind of mark to paint on a code row: the find bar's (mod+f) matches or
 * the selection-occurrence highlights. Null means no marks — plain syntax
 * highlighting (with any intra-line diff ranges) only.
 */
export type MarkKind = "find" | "occurrence" | null;

/**
 * Syntax-highlighted HTML for one code line, with find/occurrence marks layered
 * on top of the base highlight. The single implementation of "how a code line
 * is painted" — highlighting, intra-line diff ranges, find `<mark>`s,
 * occurrence `<mark>`s — so every surface that renders code (diff rows today,
 * the planned full-file context expansion) can never drift. Rows without
 * intra-line diff ranges pass null for `intra`.
 */
export function highlightRowHtml(
  content: string,
  filename: string,
  intra: IntraRanges,
  markKind: MarkKind,
  markQuery: string | null,
  markFlag: boolean,
  findOrdinal: number | null,
  startsInComment = false
): string {
  if (markQuery === null) {
    return highlightLineWithIntra(content, filename, intra, startsInComment);
  }
  if (markKind === "find") {
    return highlightLineWithFind(
      content,
      filename,
      markQuery,
      markFlag,
      findOrdinal,
      intra,
      startsInComment
    );
  }
  return highlightLineWithOccurrences(
    content,
    filename,
    markQuery,
    markFlag,
    intra,
    startsInComment
  );
}
