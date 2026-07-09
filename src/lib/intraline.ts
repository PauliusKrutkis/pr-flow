/**
 * Intraline (word-level) diff emphasis — the GitHub convention where a
 * modified line's −/+ pair emphasizes only the spans that actually differ:
 * `return retryCount` → `return retryLimit` emphasizes `Count`/`Limit`, not
 * the whole line. This module is pure: it pairs del/add rows within a hunk,
 * token-diffs each pair, and reports per-side changed column ranges. The
 * render side layers them as marks (see highlight.ts / DiffViewer).
 */

import type { DiffHunk, DiffRow } from "./diff.ts";

/** Changed [start, end) column ranges within one line's content. */
export type IntralineRanges = [number, number][];

/**
 * Emphasizing everything is worse than emphasizing nothing: a rewritten line
 * wearing wall-to-wall emphasis is pure noise. So a pair only qualifies when
 * the lines are mostly the same:
 * - at least 40% of the busier side's substantive (non-whitespace) tokens
 * must be common to both lines, else the "diff" is really a replacement;
 * - at most 8 changed spans per side — beyond that the emphasis reads as
 * confetti even when the ratio passes (e.g. every argument renamed);
 * - empty/whitespace-only lines never pair meaningfully.
 */

const MIN_COMMON_RATIO = 0.4;
const MAX_SPANS = 8;
/**
 * Token-count product cap for the O(n·m) LCS — past this the line is minified
 * or generated, where intraline emphasis has no audience anyway.
 */

const MAX_LCS_WORK = 10_000;

interface Token {
  end: number;
  start: number;
  text: string;
  ws: boolean;
}

/**
 * A line tiles completely into: identifier pieces, whitespace runs, and single
 * symbols. Word runs (\w+) are further split at camelCase humps and
 * underscores so a rename like retryCount → retryLimit isolates `Count`, which
 * is both what a reviewer wants emphasized and what keeps the common-token
 * ratio honest (`retry` counts as common).
 */

const RUN_RE = /\w+|\s+|[^\w\s]/g;
const WORD_PIECE_RE = /[a-z0-9]+|[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|_+/g;
const WS_RUN_RE = /^\s/;
const WORD_RUN_RE = /^\w/;

export function tokenize(line: string): Token[] {
  const out: Token[] = [];
  for (const run of line.matchAll(RUN_RE)) {
    const [text] = run;
    const start = run.index ?? 0;
    if (WS_RUN_RE.test(text)) {
      out.push({ end: start + text.length, start, text, ws: true });
    } else if (WORD_RUN_RE.test(text)) {
      for (const piece of text.matchAll(WORD_PIECE_RE)) {
        out.push({
          end: start + (piece.index ?? 0) + piece[0].length,
          start: start + (piece.index ?? 0),
          text: piece[0],
          ws: false,
        });
      }
    } else {
      out.push({ end: start + text.length, start, text, ws: false });
    }
  }
  return out;
}

/**
 * Marks which tokens of each side belong to a longest common subsequence.
 * Plain O(n·m) DP — diff lines are short, and the work cap above bails on the
 * pathological ones.
 */
function lcsCommon(a: Token[], b: Token[]): { a: boolean[]; b: boolean[] } {
  const n = a.length;
  const m = b.length;

  const dp = new Uint16Array((n + 1) * (m + 1));
  const at = (rowIdx: number, colIdx: number) => rowIdx * (m + 1) + colIdx;
  for (let row = n - 1; row >= 0; row -= 1) {
    for (let col = m - 1; col >= 0; col -= 1) {
      dp[at(row, col)] =
        a[row].text === b[col].text
          ? dp[at(row + 1, col + 1)] + 1
          : Math.max(dp[at(row + 1, col)], dp[at(row, col + 1)]);
    }
  }
  const commonA = new Array<boolean>(n).fill(false);
  const commonB = new Array<boolean>(m).fill(false);
  let row = 0;
  let col = 0;
  while (row < n && col < m) {
    if (a[row].text === b[col].text) {
      commonA[row] = true;
      commonB[col] = true;
      row += 1;
      col += 1;
    } else if (dp[at(row + 1, col)] >= dp[at(row, col + 1)]) {
      row += 1;
    } else {
      col += 1;
    }
  }
  return { a: commonA, b: commonB };
}

/** Consecutive changed tokens merge into one span (tokens tile the line, so
 *  index-adjacent means string-adjacent). */
function changedRanges(tokens: Token[], common: boolean[]): IntralineRanges {
  const out: IntralineRanges = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (common[i]) {
      continue;
    }
    const last = out.at(-1);
    if (last && last[1] === tokens[i].start) {
      last[1] = tokens[i].end;
    } else {
      out.push([tokens[i].start, tokens[i].end]);
    }
  }
  return out;
}

export interface IntralinePair {
  add: IntralineRanges;
  del: IntralineRanges;
}

/**
 * Word-level diff of one del/add line pair, or null when the pair fails the
 * noise guards (see above) and should render without emphasis.
 */
export function intralineDiff(
  delText: string,
  addText: string
): IntralinePair | null {
  const a = tokenize(delText);
  const b = tokenize(addText);
  if (a.length * b.length > MAX_LCS_WORK) {
    return null;
  }
  const substantiveA = a.filter((t) => !t.ws).length;
  const substantiveB = b.filter((t) => !t.ws).length;
  if (substantiveA === 0 || substantiveB === 0) {
    return null;
  }

  const common = lcsCommon(a, b);
  let commonSubstantive = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (common.a[i] && !a[i].ws) {
      commonSubstantive += 1;
    }
  }
  const ratio = commonSubstantive / Math.max(substantiveA, substantiveB);
  if (ratio < MIN_COMMON_RATIO) {
    return null;
  }

  const del = changedRanges(a, common.a);
  const add = changedRanges(b, common.b);
  if (del.length === 0 && add.length === 0) {
    return null;
  }
  if (del.length > MAX_SPANS || add.length > MAX_SPANS) {
    return null;
  }
  return { add, del };
}

function collectDelAddRuns(
  rows: DiffRow[],
  start: number
): { dels: DiffRow[]; adds: DiffRow[]; next: number } {
  const dels: DiffRow[] = [];
  let i = start;
  while (i < rows.length && rows[i].type === "del") {
    dels.push(rows[i]);
    i += 1;
  }
  const adds: DiffRow[] = [];
  while (i < rows.length && rows[i].type === "add") {
    adds.push(rows[i]);
    i += 1;
  }
  return { adds, dels, next: i };
}

function applyIntralinePair(
  out: Map<DiffRow, IntralineRanges>,
  dels: DiffRow[],
  adds: DiffRow[]
): void {
  const pairs = Math.min(dels.length, adds.length);
  for (let k = 0; k < pairs; k += 1) {
    const d = intralineDiff(dels[k].content, adds[k].content);
    if (!d) {
      continue;
    }
    if (d.del.length > 0) {
      out.set(dels[k], d.del);
    }
    if (d.add.length > 0) {
      out.set(adds[k], d.add);
    }
  }
}

/**
 * Intraline emphasis for a whole parsed patch, keyed by row object identity —
 * rows come from the same memoized parsePatch() result the viewer renders, so
 * a per-row lookup is a single Map.get. Pairing follows unified-diff shape:
 * within each hunk a contiguous run of del rows followed by a contiguous run
 * of add rows pairs index-wise (del[0]↔add[0], …); leftovers stay unpaired.
 */
export function intralinePairs(
  hunks: DiffHunk[]
): Map<DiffRow, IntralineRanges> {
  const out = new Map<DiffRow, IntralineRanges>();
  for (const hunk of hunks) {
    const { rows } = hunk;
    let i = 0;
    while (i < rows.length) {
      if (rows[i].type !== "del") {
        i += 1;
        continue;
      }
      const { dels, adds, next } = collectDelAddRuns(rows, i);
      applyIntralinePair(out, dels, adds);
      i = next;
    }
  }
  return out;
}
