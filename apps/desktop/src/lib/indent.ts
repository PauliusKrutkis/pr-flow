// Indent guides for the diff viewer — faint vertical lines at each indent
// level, the honest substitute for bracket matching when all you have is a
// patch fragment. This module is the pure half: detecting a file's indent
// unit from its patch rows, and deciding which leading-whitespace span of a
// line should carry the guide mark. The render side wraps that span in a
// <mark class="qf-indent"> whose repeating background gradient paints one
// hairline per unit (see highlight.ts / quiet.css).

import type { DiffHunk } from "./diff";

export interface IndentUnit {
  /** Gradient period — one guide per level — in ch (mono columns). */
  ch: number;
  /** Leading-whitespace CHARS that make one level (1 for a tab). */
  chars: number;
}

// Tab handling: a tab is one indent level, and the diff renders tabs at the
// CSS `tab-size` (pinned to the browser default of 8 in quiet.css so this
// stays a contract, not a coincidence). So tab files get an 8ch gradient
// period — one guide per rendered tab stop — while the level threshold below
// counts tab CHARS. Files mixing tabs and spaces count as tab-indented.
const TAB_UNIT: IndentUnit = { ch: 8, chars: 1 };

const LEADING_WS = /^[\t ]*/;

/**
 * The file's indent unit, from its patch rows' leading whitespace: the
 * smallest nonzero space indent, clamped to 2/4/8 (real codebases use nothing
 * else; a stray 3- or 5-space line is a continuation, not a unit), default 2
 * when nothing in the patch is indented.
 */
export function detectIndentUnit(hunks: DiffHunk[]): IndentUnit {
  let minSpaces = Infinity;
  for (const hunk of hunks) {
    for (const row of hunk.rows) {
      if (row.type === "hunk") continue;
      const ws = LEADING_WS.exec(row.content)![0];
      // Unindented rows say nothing; whitespace-only rows are trailing junk.
      if (ws.length === 0 || ws.length === row.content.length) continue;
      if (ws.includes("\t")) return TAB_UNIT;
      minSpaces = Math.min(minSpaces, ws.length);
    }
  }
  if (!Number.isFinite(minSpaces)) return { ch: 2, chars: 2 };
  const unit = minSpaces >= 8 ? 8 : minSpaces >= 4 ? 4 : 2;
  return { ch: unit, chars: unit };
}

/**
 * The [0, n) column span of `code`'s leading whitespace when it should carry
 * an indent-guide mark, or null for lines indented less than TWO levels —
 * a single level's guide hugs the text and adds DOM for no orientation value.
 * Whitespace-only lines get no guide either (nothing to guide the eye to).
 */
export function guideRange(
  code: string,
  unit: IndentUnit,
): [number, number] | null {
  const ws = LEADING_WS.exec(code)![0];
  if (ws.length === code.length) return null;
  if (ws.length < 2 * unit.chars) return null;
  return [0, ws.length];
}
