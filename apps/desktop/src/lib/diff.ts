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

export function parsePatch(patch: string | null | undefined): DiffHunk[] {
  if (!patch) return [];
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

/** Total number of changed (added + removed) rows across a patch. */
export function changedRowCount(patch: string | null | undefined): number {
  const hunks = parsePatch(patch);
  let n = 0;
  for (const h of hunks) {
    for (const r of h.rows) if (r.type === "add" || r.type === "del") n += 1;
  }
  return n;
}
