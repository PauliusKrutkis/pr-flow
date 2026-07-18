/**
 * Full-file context expansion — the pure half. Turns a file's hunk-only patch
 * plus its head blob into one continuous DiffRow stream: the patch's own rows
 * (same objects parsePatch cached, so intraline/guide lookups keyed by row
 * identity still hit) with `synthetic: true` context rows synthesized from the
 * blob filling the gaps before, between, and after hunks. GitHub's "expand
 * context" taken to its limit, as data instead of DOM.
 *
 * Expansion is validated, not trusted: every patch row must land on the exact
 * line and content the blob has there, otherwise the blob and the diff
 * disagree (a push happened between fetches) and the whole expansion returns
 * null — the caller falls back to the plain hunk view rather than rendering a
 * frankenfile. Fully added files are gated out by canExpandFile (their patch
 * already IS the full file), removed files have no head blob to expand into.
 */

import type { ChangedFile, FileBlob } from "../types.ts";
import { type DiffHunk, type DiffRow, hunkStarts, parsePatch } from "./diff.ts";

/**
 * Beyond this the expanded view isn't worth the render cost; the diff and the
 * forge's own file view are better tools for a file that big.
 */
const MAX_EXPAND_BYTES = 2_000_000;

/** Whether a file can be expanded to its full head contents at all. */
export function canExpandFile(file: ChangedFile): boolean {
  return !!file.patch && file.status !== "removed" && file.status !== "added";
}

/**
 * The blob decoded into lines, or why it can't be. A trailing newline yields a
 * final empty element from split — dropped, matching how the patch counts
 * lines.
 */
export function blobToLines(
  blob: FileBlob
): readonly string[] | "binary" | "too-large" {
  if (blob.size > MAX_EXPAND_BYTES) {
    return "too-large";
  }
  const binary = atob(blob.base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  if (text.includes("\u0000")) {
    return "binary";
  }
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function syntheticRow(
  content: string,
  oldLine: number,
  newLine: number
): DiffRow {
  return { content, newLine, oldLine, synthetic: true, type: "context" };
}

interface Walk {
  newPos: number;
  oldPos: number;
  out: DiffRow[];
}

function fillSyntheticTo(
  walk: Walk,
  lines: readonly string[],
  newStop: number
): boolean {
  while (walk.newPos < newStop) {
    const content = lines[walk.newPos - 1];
    if (content === undefined) {
      return false;
    }
    walk.out.push(syntheticRow(content, walk.oldPos, walk.newPos));
    walk.oldPos += 1;
    walk.newPos += 1;
  }
  return true;
}

function appendPatchRow(
  walk: Walk,
  row: DiffRow,
  lines: readonly string[]
): boolean {
  if (row.type === "del") {
    if (row.oldLine !== walk.oldPos) {
      return false;
    }
    walk.oldPos += 1;
  } else {
    if (row.newLine !== walk.newPos || row.content !== lines[walk.newPos - 1]) {
      return false;
    }
    walk.newPos += 1;
    if (row.type === "context") {
      walk.oldPos += 1;
    }
  }
  walk.out.push(row);
  return true;
}

function appendHunk(
  walk: Walk,
  hunk: DiffHunk,
  lines: readonly string[]
): boolean {
  const starts = hunkStarts(hunk.header);
  if (
    starts === null ||
    starts.newStart < walk.newPos ||
    starts.oldStart - starts.newStart !== walk.oldPos - walk.newPos
  ) {
    return false;
  }
  if (!fillSyntheticTo(walk, lines, starts.newStart)) {
    return false;
  }
  for (const row of hunk.rows) {
    if (row.type !== "hunk" && !appendPatchRow(walk, row, lines)) {
      return false;
    }
  }
  return true;
}

function expandUncached(
  patch: string,
  lines: readonly string[]
): readonly DiffRow[] | null {
  const hunks = parsePatch(patch);
  if (hunks.length === 0) {
    return null;
  }
  const walk: Walk = { newPos: 1, oldPos: 1, out: [] };
  for (const hunk of hunks) {
    if (!appendHunk(walk, hunk, lines)) {
      return null;
    }
  }
  fillSyntheticTo(walk, lines, lines.length + 1);
  return walk.out;
}

/**
 * Cached by blob-lines identity then patch string, mirroring the parse cache:
 * the model rebuilds on every cursor/box state change and must get the SAME
 * row objects back each time, both for cost and so memoized row components and
 * WeakMap-keyed render metadata stay stable.
 */
const expandCache = new WeakMap<
  readonly string[],
  Map<string, readonly DiffRow[] | null>
>();

export function expandFileRows(
  patch: string,
  lines: readonly string[]
): readonly DiffRow[] | null {
  let byPatch = expandCache.get(lines);
  if (!byPatch) {
    byPatch = new Map();
    expandCache.set(lines, byPatch);
  }
  const hit = byPatch.get(patch);
  if (hit !== undefined) {
    return hit;
  }
  const rows = expandUncached(patch, lines);
  byPatch.set(patch, rows);
  return rows;
}
