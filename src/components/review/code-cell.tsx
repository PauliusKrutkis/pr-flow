import type { CSSProperties } from "react";
import {
  highlightHtmlToNodes,
  highlightLineWithFind,
  highlightLineWithIntra,
  highlightLineWithOccurrences,
} from "../../lib/highlight.ts";
import type { IntralineRanges } from "../../lib/intraline.ts";

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
  intra: IntralineRanges | null,
  markKind: MarkKind,
  markQuery: string | null,
  markFlag: boolean,
  findOrdinal: number | null
): string {
  if (markQuery === null) {
    return highlightLineWithIntra(content, filename, intra);
  }
  if (markKind === "find") {
    return highlightLineWithFind(
      content,
      filename,
      markQuery,
      markFlag,
      findOrdinal,
      intra
    );
  }
  return highlightLineWithOccurrences(
    content,
    filename,
    markQuery,
    markFlag,
    intra
  );
}

/**
 * The `<code>` cell of a code row: the single unit the find/occurrence DOM
 * helpers key on (`.qf-code`, its `.hljs` inner span, and the text nodes column
 * math walks). Every code-rendering surface must use this cell — rendering an
 * identical cell is what lets one find/occurrence controller drive them all
 * (see "Code view" in docs/ARCHITECTURE.md). Row-level chrome (gutters,
 * markers, `data-anchor`) stays with each caller; this is only the code
 * itself.
 *
 * `guideLvl` drives the indent-guide custom property; rows without indent
 * guides omit it.
 */
export function CodeCell({
  html,
  guideLvl = null,
}: {
  html: string;
  guideLvl?: number | null;
}) {
  return (
    <code
      className="qf-code"
      style={
        guideLvl === null
          ? undefined
          : ({ "--qf-lvl": guideLvl } as CSSProperties)
      }
    >
      <span className="hljs">{highlightHtmlToNodes(html)}</span>
    </code>
  );
}
