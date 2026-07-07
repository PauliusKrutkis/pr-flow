import { Fragment, type ReactNode } from "react";

/** Render `text` with the given character indices highlighted. */
export function HighlightIndices({
  text,
  indices,
}: {
  text: string;
  indices: number[];
}) {
  if (indices.length === 0) {
    return <>{text}</>;
  }
  const set = new Set(indices);
  const nodes: ReactNode[] = [];
  let start = 0;
  let inHl = set.has(0);
  for (let i = 1; i <= text.length; i++) {
    const hl = i < text.length && set.has(i);
    if (i === text.length || hl !== inHl) {
      const seg = text.slice(start, i);
      nodes.push(
        inHl ? (
          <mark className="q-hl" key={start}>
            {seg}
          </mark>
        ) : (
          <Fragment key={start}>{seg}</Fragment>
        )
      );
      start = i;
      inHl = hl;
    }
  }
  return <>{nodes}</>;
}

/** Render `text` with every case-insensitive occurrence of `query` highlighted. */
export function HighlightMatch({
  text,
  query,
}: {
  text: string;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return <>{text}</>;
  }
  const lower = text.toLowerCase();
  const nodes: ReactNode[] = [];
  let pos = 0;
  for (let idx = lower.indexOf(q); idx !== -1; idx = lower.indexOf(q, pos)) {
    if (idx > pos) {
      nodes.push(<Fragment key={pos}>{text.slice(pos, idx)}</Fragment>);
    }
    nodes.push(
      <mark className="q-hl" key={idx}>
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    pos = idx + q.length;
  }
  if (nodes.length === 0) {
    return <>{text}</>;
  }
  if (pos < text.length) {
    nodes.push(<Fragment key={pos}>{text.slice(pos)}</Fragment>);
  }
  return <>{nodes}</>;
}
