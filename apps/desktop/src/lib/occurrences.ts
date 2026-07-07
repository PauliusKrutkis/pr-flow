/**
 * Selection-driven occurrence highlighting — the editor convention where
 * selecting a token quietly lights up its other occurrences. This module is
 * the pure half (no DOM): deciding whether a selection qualifies as an
 * occurrence query, and finding that query's occurrences within one line.
 * ReviewScreen owns the DOM half (selectionchange listening + "is the
 * selection inside a single diff code line" gating).
 */

import { parsePatch, rowAnchor } from "./diff";
import { findMatchRangesInLine } from "./findInDiff";

export interface OccurrenceSpec {
  query: string;
  wholeWord: boolean;
}

/**
 * Under 2 chars marks half the screen; over 64 the user is grabbing a block,
 * not a token — neither reads as "show me this elsewhere".
 */

const MIN_LEN = 2;
const MAX_LEN = 64;

const WORD = /^\w+$/;
/**
 * At least one letter or digit — selections of pure whitespace/punctuation
 * (`) {`, `===`) would mark structural noise everywhere.
 */

const HAS_SUBSTANCE = /[\p{L}\p{N}]/u;

/**
 * Validates raw selection text into an occurrence query, or null when the
 * selection shouldn't trigger highlighting. The query keeps the selection
 * verbatim (including any incidental spaces) — the gates just use the trimmed
 * form so ` foo ` doesn't pass on padding alone.
 */
export function occurrenceSpecFromSelection(
  text: string,
): OccurrenceSpec | null {
  if (text.includes("\n")) return null;
  const trimmed = text.trim();
  if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) return null;
  if (!HAS_SUBSTANCE.test(trimmed)) return null;
  return { query: text, wholeWord: WORD.test(text) };
}

const WORD_CHAR = /\w/;

/**
 * Occurrences of the spec's query within one line, as [start, end) column
 * ranges. Rides the find feature's matcher (case-sensitive mode) so "what
 * counts as an occurrence" can't drift from the rest of the app, then drops
 * hits without word boundaries when the selection itself is a word.
 */
export function occurrenceRangesInLine(
  text: string,
  spec: OccurrenceSpec,
): Array<[number, number]> {
  const ranges = findMatchRangesInLine(text, spec.query, true);
  if (!spec.wholeWord) return ranges;
  return ranges.filter(
    ([start, end]) =>
      (start === 0 || !WORD_CHAR.test(text[start - 1])) &&
      (end === text.length || !WORD_CHAR.test(text[end])),
  );
}

export interface OccurrenceMatch {
  anchor: string;
  start: number;
  end: number;
}

/**
 * Every occurrence of the spec's query across ONE file's patch, in document
 * order (rows top to bottom, hits left to right). Scanned from the patch
 * text — like findInDiff — so the overview ruler's ticks and n/p navigation
 * see the whole file, including rows scrolled far off-screen. Hunk headers
 * are metadata, not code, and never match.
 */
export function occurrenceMatches(
  file: { patch?: string | null },
  spec: OccurrenceSpec,
): OccurrenceMatch[] {
  const out: OccurrenceMatch[] = [];
  for (const hunk of parsePatch(file.patch)) {
    for (const row of hunk.rows) {
      const anchor = rowAnchor(row);
      if (anchor == null) continue;
      for (const [start, end] of occurrenceRangesInLine(row.content, spec)) {
        out.push({ anchor, start, end });
      }
    }
  }
  return out;
}
