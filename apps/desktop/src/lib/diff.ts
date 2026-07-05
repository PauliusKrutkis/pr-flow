// Parses GitHub's per-file unified diff `patch` into hunks of rows with
// resolved old/new line numbers, so the diff viewer can render gutters and
// anchor inline comments to a line.

export type DiffRowType = "hunk" | "context" | "add" | "del";

export interface DiffRow {
  type: DiffRowType;
  /** Line text WITHOUT the leading +/-/space marker (full header text for "hunk"). */
  content: string;
  /** 1-based line number on the old side (LEFT), or null for added rows/headers. */
  oldLine: number | null;
  /** 1-based line number on the new side (RIGHT), or null for removed rows/headers. */
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  rows: DiffRow[];
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// Parses are cached by patch string: the find bar re-scans EVERY file's patch
// on each keystroke, and the viewer/ruler/occurrence paths parse the same
// patches again — all of them read-only. Callers must treat the result as
// immutable. Keys are references to strings already held by the query cache,
// so the map costs one array of row objects per distinct patch; cleared
// wholesale past the cap like the highlight cache.
const parseCache = new Map<string, DiffHunk[]>();
const PARSE_CACHE_MAX = 500;

export function parsePatch(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];
  const hit = parseCache.get(patch);
  if (hit !== undefined) return hit;
  const hunks = parsePatchUncached(patch);
  if (parseCache.size >= PARSE_CACHE_MAX) parseCache.clear();
  parseCache.set(patch, hunks);
  return hunks;
}

function parsePatchUncached(patch: string): DiffHunk[] {
  const lines = patch.split("\n");
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      const m = HUNK_RE.exec(line);
      oldLine = m ? parseInt(m[1], 10) : 0;
      newLine = m ? parseInt(m[2], 10) : 0;
      current = {
        header: line,
        rows: [{ type: "hunk", content: line, oldLine: null, newLine: null }],
      };
      hunks.push(current);
      continue;
    }

    if (!current) {
      current = { header: "", rows: [] };
      hunks.push(current);
    }

    // "\ No newline at end of file" and other metadata lines.
    if (line.startsWith("\\")) continue;

    const marker = line[0];
    const text = line.slice(1);

    if (marker === "+") {
      current.rows.push({ type: "add", content: text, oldLine: null, newLine });
      newLine += 1;
    } else if (marker === "-") {
      current.rows.push({ type: "del", content: text, oldLine, newLine: null });
      oldLine += 1;
    } else {
      current.rows.push({ type: "context", content: text, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }

  return hunks;
}

/** The DiffViewer's row anchor ("LEFT:12" / "RIGHT:34"), or null for rows
 *  that can't be anchored. Deletions anchor to their old-side line, everything
 *  else to the new side — the same convention findInDiff and DiffViewer use. */
export function rowAnchor(row: DiffRow): string | null {
  if (row.type === "hunk") return null;
  if (row.type === "del") {
    return row.oldLine != null ? `LEFT:${row.oldLine}` : null;
  }
  return row.newLine != null ? `RIGHT:${row.newLine}` : null;
}

/**
 * Each row anchor's fractional vertical position (0..1, at the row's center)
 * within its patch, in render order. For the overview ruler: unmounted
 * (windowed) sections have no row pixel positions to measure, so a row's
 * share of the patch's total rows stands in for its share of the section's
 * height. Hunk headers count in the denominator but comment threads and
 * collapsed hunks don't exist here — the result is an approximation, which is
 * exactly good enough to place a 2px tick.
 */
const fractionsCache = new Map<string, Map<string, number>>();

export function anchorFractions(
  patch: string | null | undefined,
): Map<string, number> {
  // Cached like parsePatch (callers treat the result as read-only): the
  // overview ruler asks for the same file's fractions on every recompute and
  // the find seed on every keystroke.
  if (patch) {
    const hit = fractionsCache.get(patch);
    if (hit !== undefined) return hit;
  }
  const out = new Map<string, number>();
  if (patch) {
    if (fractionsCache.size >= PARSE_CACHE_MAX) fractionsCache.clear();
    fractionsCache.set(patch, out);
  }
  const hunks = parsePatch(patch);
  let total = 0;
  for (const h of hunks) total += h.rows.length;
  if (total === 0) return out;
  let i = 0;
  for (const h of hunks) {
    for (const row of h.rows) {
      const anchor = rowAnchor(row);
      if (anchor != null && !out.has(anchor)) {
        out.set(anchor, (i + 0.5) / total);
      }
      i += 1;
    }
  }
  return out;
}

/** Total number of changed (added + removed) rows across a patch. */
export function changedRowCount(patch: string | null | undefined): number {
  const hunks = parsePatch(patch);
  let n = 0;
  for (const h of hunks) {
    for (const r of h.rows) if (r.type === "add" || r.type === "del") n += 1;
  }
  return n;
}
