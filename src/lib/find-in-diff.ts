/**
 * Matching for the editor-style find-in-diff bar (mod+f). Matches are computed
 * from the PATCH TEXT, not the DOM — so every changed file counts, whether or
 * not its diff section is currently rendered (sections mount lazily). Each
 * match carries the same "SIDE:line" anchor the diff viewer keys its rows by,
 * so navigation can reuse the existing selectLine/jump machinery unchanged.
 *
 * The scan runs on every keystroke, so it works on the raw patch string with
 * one indexOf sweep per file — no per-row slicing or lowercasing. Everything
 * it needs (lowered text, line offsets, per-line anchors) is cached by patch
 * identity; the per-keystroke cost is the sweep itself plus O(hits).
 */

import { type DiffRow, parsePatch, rowAnchor } from "./diff.ts";

export interface FindMatch {
  anchor: string;
  end: number;
  fileIndex: number;
  start: number;
}

/**
 * `rowsByFile` overrides the patch-text scan for files whose row stream isn't
 * the patch — full-file expansion (expand-file.ts). Matches in synthesized
 * context lines would otherwise be invisible to the counter and n/p
 * navigation, since those lines don't exist in the patch string.
 */
export interface FindOptions {
  caseSensitive?: boolean;
  maxMatches?: number;
  rowsByFile?: ReadonlyMap<number, readonly DiffRow[]>;
}

/**
 * A one-letter query over a huge PR can explode; past this the counter stops
 * being useful anyway, so we cap the navigable list (rendered highlights are
 * computed per line and are unaffected).
 */

const MAX_MATCHES = 5000;

/**
 * Non-overlapping occurrences of `query` within one line, left to right.
 * Shared with the render side (highlightLineWithFind) so the marks on screen
 * and the navigable match list can never disagree about what counts as a hit.
 */
export function findMatchRangesInLine(
  text: string,
  query: string,
  caseSensitive = false
): [number, number][] {
  if (!(query && text)) {
    return [];
  }
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: [number, number][] = [];
  for (
    let i = hay.indexOf(needle);
    i !== -1;
    i = hay.indexOf(needle, i + needle.length)
  ) {
    out.push([i, i + needle.length]);
  }
  return out;
}

/**
 * All keyed by strings the query cache already holds (or their cached lowered
 * forms), so entries cost no text copies beyond the lowered one; cleared
 * wholesale past a cap, like the parse cache in diff.ts.
 */

const CACHE_MAX = 500;

const lowerCache = new Map<string, string>();

function lowered(patch: string): string {
  const hit = lowerCache.get(patch);
  if (hit !== undefined) {
    return hit;
  }
  const low = patch.toLowerCase();
  if (lowerCache.size >= CACHE_MAX) {
    lowerCache.clear();
  }
  lowerCache.set(patch, low);
  return low;
}

/**
 * Start offset of every line of `text`. Keyed by the exact text scanned (raw
 * or lowered) because toLowerCase can change a line's LENGTH for exotic
 * characters (İ → i̇) — offsets must come from the string the sweep runs on,
 * which also keeps columns identical to findMatchRangesInLine's (it indexes
 * into the lowered line too).
 */
const lineStartCache = new Map<string, number[]>();

function lineStarts(text: string): number[] {
  const hit = lineStartCache.get(text);
  if (hit !== undefined) {
    return hit;
  }
  const out = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    out.push(i + 1);
  }
  if (lineStartCache.size >= CACHE_MAX) {
    lineStartCache.clear();
  }
  lineStartCache.set(text, out);
  return out;
}

/**
 * Each patch line's row anchor, or null for lines that can never match (hunk
 * headers, "\ No newline" metadata, rows without an anchor). Built by walking
 * the patch's lines in lockstep with its parsed rows — parsePatch emits one
 * row per line except for "\" metadata lines, which it skips. toLowerCase
 * never adds or removes newlines, so one array serves the raw and lowered
 * text alike.
 */
const lineAnchorCache = new Map<string, ReadonlyArray<string | null>>();

function lineAnchors(patch: string): ReadonlyArray<string | null> {
  const hit = lineAnchorCache.get(patch);
  if (hit !== undefined) {
    return hit;
  }
  const rows: DiffRow[] = [];
  for (const hunk of parsePatch(patch)) {
    for (const row of hunk.rows) {
      rows.push(row);
    }
  }
  const out: Array<string | null> = [];
  let ri = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("\\")) {
      out.push(null);
      continue;
    }
    const row = rows[ri];
    ri += 1;
    out.push(row === undefined ? null : rowAnchor(row));
  }
  if (lineAnchorCache.size >= CACHE_MAX) {
    lineAnchorCache.clear();
  }
  lineAnchorCache.set(patch, out);
  return out;
}

/**
 * Whether a file's patch can contain `query` at all — the cheap per-file gate
 * for mark highlighting. Deliberately a SUPERSET test on the raw patch text
 * (hunk headers and +/- markers included): a false positive just means one
 * section repaints and finds nothing, while a false negative would hide real
 * marks — so this must stay conservative. One indexOf over the patch, no
 * parsing, no allocation beyond the cached lowercase form.
 */
export function patchMayMatch(
  patch: string | null | undefined,
  query: string,
  caseSensitive = false
): boolean {
  if (!(patch && query)) {
    return false;
  }
  return caseSensitive
    ? patch.includes(query)
    : lowered(patch).includes(query.toLowerCase());
}

function scanRowsForMatches(
  rows: readonly DiffRow[],
  fileIndex: number,
  query: string,
  caseSensitive: boolean,
  max: number,
  out: FindMatch[]
): boolean {
  for (const row of rows) {
    const anchor = rowAnchor(row);
    if (anchor === null) {
      continue;
    }
    for (const [start, end] of findMatchRangesInLine(
      row.content,
      query,
      caseSensitive
    )) {
      out.push({ anchor, end, fileIndex, start });
      if (out.length >= max) {
        return true;
      }
    }
  }
  return false;
}

function scanFileForMatches(
  patch: string,
  fileIndex: number,
  needle: string,
  caseSensitive: boolean,
  max: number,
  out: FindMatch[]
): boolean {
  const hay = caseSensitive ? patch : lowered(patch);
  const starts = lineStarts(hay);
  const anchors = lineAnchors(patch);

  let li = 0;
  for (let o = hay.indexOf(needle); o !== -1; ) {
    while (li + 1 < starts.length && starts[li + 1] <= o) {
      li += 1;
    }
    const anchor = anchors[li];

    const col = o - starts[li] - 1;
    if (anchor === null || col < 0) {
      o = hay.indexOf(needle, o + 1);
      continue;
    }
    out.push({ anchor, end: col + needle.length, fileIndex, start: col });
    if (out.length >= max) {
      return true;
    }
    o = hay.indexOf(needle, o + needle.length);
  }
  return false;
}

/**
 * All matches of `query` across every file's patch, in document order (files
 * in PR order, rows top to bottom, occurrences left to right). Hunk headers
 * ("@@ … @@") are metadata, not code — they never match. Rows are anchored the
 * way DiffViewer anchors them: deletions to their old-side line, everything
 * else to the new side.
 */
export function findInDiff(
  files: ReadonlyArray<{ patch?: string | null }>,
  query: string,
  opts: FindOptions = {}
): FindMatch[] {
  if (!query || query.includes("\n")) {
    return [];
  }
  const caseSensitive = opts.caseSensitive ?? false;
  const max = opts.maxMatches ?? MAX_MATCHES;
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: FindMatch[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex += 1) {
    const rows = opts.rowsByFile?.get(fileIndex);
    if (rows) {
      if (scanRowsForMatches(rows, fileIndex, query, caseSensitive, max, out)) {
        return out;
      }
      continue;
    }
    const { patch } = files[fileIndex];
    if (!patch) {
      continue;
    }
    if (!patchMayMatch(patch, query, caseSensitive)) {
      continue;
    }
    if (scanFileForMatches(patch, fileIndex, needle, caseSensitive, max, out)) {
      return out;
    }
  }
  return out;
}
