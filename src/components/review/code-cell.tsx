import type { CSSProperties } from "react";
import { highlightHtmlToNodes } from "../../lib/highlight.ts";

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
