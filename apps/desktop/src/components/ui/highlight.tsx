import type { ReactNode } from "react";

/** Render `text` with the given character indices highlighted. */
export function HighlightIndices({
  text,
  indices,
}: {
  text: string;
  indices?: number[];
}) {
  const hits = indices ?? [];
  if (hits.length === 0) {
    return <>{text}</>;
  }
  const set = new Set(hits);
  const nodes: ReactNode[] = [];
  let start = 0;
  let inHl = set.has(0);
  for (let i = 1; i <= text.length; i += 1) {
    const hl = i < text.length && set.has(i);
    if (i === text.length || hl !== inHl) {
      const seg = text.slice(start, i);
      nodes.push(
        inHl ? (
          <mark className="q-hl" key={start}>
            {seg}
          </mark>
        ) : (
          <span key={start}>{seg}</span>
        )
      );
      start = i;
      inHl = hl;
    }
  }
  return <>{nodes}</>;
}
