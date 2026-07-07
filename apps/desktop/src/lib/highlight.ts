import hljs from "highlight.js";
import { parsePatch } from "./diff.ts";
import { findMatchRangesInLine } from "./findInDiff.ts";
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
  const ext = base.includes(".") ? base.split(".").pop()! : "";
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
 * Returns an HTML string (hljs token spans) for a single line of code.
 * Safe to dangerouslySetInnerHTML — input is highlighted or HTML-escaped.
 */
export function highlightLine(code: string, filename: string): string {
  if (code.length === 0) {
    return "";
  }
  const lang = langForFilename(filename);
  if (!lang) {
    return escapeHtml(code);
  }

  if (C_BLOCK_COMMENT_LANGS.has(lang) && COMMENT_CONTINUATION.test(code)) {
    return `<span class="hljs-comment">${escapeHtml(code)}</span>`;
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
  const queue: Array<[code: string, filename: string]> = [];
  for (const f of files) {
    if (!(f.patch && isHighlightable(f.filename))) {
      continue;
    }
    for (const hunk of parsePatch(f.patch)) {
      for (const row of hunk.rows) {
        if (row.type === "hunk") {
          continue;
        }
        queue.push([row.content, f.filename]);
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
        deadline == null
          ? performance.now() > budgetEnd
          : deadline.timeRemaining() < 2;
      if (out) {
        break;
      }
      highlightLine(queue[i][0], queue[i][1]);
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
export type IntraRanges = ReadonlyArray<[number, number]> | null;

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

/**
 * Syntax-highlighted line with intraline word-diff emphasis (`qf-intra-mark`)
 * layered over it — the plain-diff path when no find/occurrence marks are
 * active. Safe to dangerouslySetInnerHTML (same guarantees as highlightLine).
 */
export function highlightLineWithIntra(
  code: string,
  filename: string,
  intra: IntraRanges
): string {
  return withIntra(highlightLine(code, filename), intra);
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
  intra: IntraRanges = null
): string {
  const html = withIntra(highlightLine(code, filename), intra);
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
  intra: IntraRanges = null
): string {
  const html = withIntra(highlightLine(code, filename), intra);
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
