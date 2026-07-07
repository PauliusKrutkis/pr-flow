/**
 * Indent guides for the diff viewer — faint vertical lines at each indent
 * level, the honest substitute for bracket matching when all you have is a
 * patch fragment. This module is the pure half: detecting a file's indent
 * unit from its patch rows, and counting a line's indent levels. The render
 * side paints the guides as a row-level ::before gradient sized by those
 * levels (see .qf-code::before in quiet.css) — guides never enter the text
 * flow, so they can't fragment text nodes or interact with selection,
 * clicks, or the mark layers.
 */

import type { DiffHunk } from "./diff.ts";

export interface IndentUnit {
  ch: number;
  chars: number;
}

/**
 * Tab handling: a tab is one indent level, and the diff renders tabs at the
 * CSS `tab-size` (pinned to the browser default of 8 in quiet.css so this
 * stays a contract, not a coincidence). So tab files get an 8ch gradient
 * period — one guide per rendered tab stop — while the level threshold below
 * counts tab CHARS. Files mixing tabs and spaces count as tab-indented.
 */

const TAB_UNIT: IndentUnit = { ch: 8, chars: 1 };

const LEADING_WS = /^[\t ]*/;

function pickIndentChars(minSpaces: number): number {
  if (minSpaces >= 8) {
    return 8;
  }
  if (minSpaces >= 4) {
    return 4;
  }
  return 2;
}

/**
 * The file's indent unit, from its patch rows' leading whitespace: the
 * smallest nonzero space indent, clamped to 2/4/8 (real codebases use nothing
 * else; a stray 3- or 5-space line is a continuation, not a unit), default 2
 * when nothing in the patch is indented.
 */
export function detectIndentUnit(hunks: DiffHunk[]): IndentUnit {
  let minSpaces = Number.POSITIVE_INFINITY;
  for (const hunk of hunks) {
    for (const row of hunk.rows) {
      if (row.type === "hunk") {
        continue;
      }
      const ws = LEADING_WS.exec(row.content)?.[0];
      if (ws.length === 0 || ws.length === row.content.length) {
        continue;
      }
      if (ws.includes("\t")) {
        return TAB_UNIT;
      }
      minSpaces = Math.min(minSpaces, ws.length);
    }
  }
  if (!Number.isFinite(minSpaces)) {
    return { ch: 2, chars: 2 };
  }
  const unit = pickIndentChars(minSpaces);
  return { ch: unit, chars: unit };
}

/**
 * Guide levels per row of a hunk, editor-style: a line shows guides for its
 * own indentation, and blank / whitespace-only lines BRIDGE — they inherit
 * the smaller of their non-blank neighbours' levels, so a column of guides
 * runs straight through the gaps inside a block instead of reading as a
 * dashed fence. Rows with zero levels get null (nothing to paint), and each
 * hunk bridges independently (a hunk boundary is a real discontinuity).
 * Indexed to match `hunk.rows`; "hunk" header rows are null.
 */
export function guideLevelsForHunk(
  rows: ReadonlyArray<{ type: string; content: string }>,
  unit: IndentUnit
): Array<number | null> {
  const own = rows.map((row) => {
    if (row.type === "hunk") {
      return null;
    }
    const ws = LEADING_WS.exec(row.content)?.[0];
    if (ws.length === row.content.length) {
      return null;
    }
    return Math.floor(ws.length / unit.chars);
  });
  const out: Array<number | null> = own.slice();
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].type === "hunk" || own[i] !== null) {
      continue;
    }
    let prev: number | null = null;
    for (let j = i - 1; j >= 0 && rows[j].type !== "hunk"; j -= 1) {
      if (own[j] !== null) {
        prev = own[j];
        break;
      }
    }
    let next: number | null = null;
    for (let j = i + 1; j < rows.length && rows[j].type !== "hunk"; j += 1) {
      if (own[j] !== null) {
        next = own[j];
        break;
      }
    }
    out[i] = prev !== null && next !== null ? Math.min(prev, next) : null;
  }
  return out.map((lvl) => (lvl !== null && lvl >= 1 ? lvl : null));
}
