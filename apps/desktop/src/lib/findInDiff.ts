// Matching for the editor-style find-in-diff bar (mod+f). Matches are computed
// from the PATCH TEXT, not the DOM — so every changed file counts, whether or
// not its diff section is currently rendered (sections mount lazily). Each
// match carries the same "SIDE:line" anchor the diff viewer keys its rows by,
// so navigation can reuse the existing selectLine/jump machinery unchanged.

import { parsePatch, rowAnchor } from "./diff";

export interface FindMatch {
  fileIndex: number;
  /** Diff row anchor ("LEFT:12" / "RIGHT:34") — the DiffViewer scroll target. */
  anchor: string;
  /** Column range of the match within the row's content (marker stripped). */
  start: number;
  end: number;
}

export interface FindOptions {
  /** Case-insensitive by default, like a browser's find. */
  caseSensitive?: boolean;
}

// A one-letter query over a huge PR can explode; past this the counter stops
// being useful anyway, so we cap the navigable list (rendered highlights are
// computed per line and are unaffected).
const MAX_MATCHES = 5000;

/**
 * Non-overlapping occurrences of `query` within one line, left to right.
 * Shared with the render side (highlightLineWithFind) so the marks on screen
 * and the navigable match list can never disagree about what counts as a hit.
 */
export function findMatchRangesInLine(
  text: string,
  query: string,
  caseSensitive = false,
): Array<[number, number]> {
  if (!query || !text) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Array<[number, number]> = [];
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
    out.push([i, i + needle.length]);
  }
  return out;
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
  opts: FindOptions = {},
): FindMatch[] {
  if (!query) return [];
  const caseSensitive = opts.caseSensitive ?? false;
  const out: FindMatch[] = [];

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const patch = files[fileIndex].patch;
    if (!patch) continue;
    for (const hunk of parsePatch(patch)) {
      for (const row of hunk.rows) {
        if (row.type === "hunk") continue;
        const anchor = rowAnchor(row);
        if (anchor == null) continue;
        for (const [start, end] of findMatchRangesInLine(
          row.content,
          query,
          caseSensitive,
        )) {
          out.push({ fileIndex, anchor, start, end });
          if (out.length >= MAX_MATCHES) return out;
        }
      }
    }
  }
  return out;
}
