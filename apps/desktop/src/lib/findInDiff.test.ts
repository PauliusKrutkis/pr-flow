import { describe, expect, it } from "vitest";
import { findInDiff, findMatchRangesInLine, patchMayMatch } from "./findInDiff";
import { parsePatch, rowAnchor } from "./diff";

/** @@ -1,3 +1,4 @@ resolves to: context old1/new1, del old2, add new2, add new3. */

const PATCH = `@@ -1,3 +1,4 @@
 const alpha = 1;
-const beta = alpha + alpha;
+const Beta = alpha + alpha;
+const gamma = "@@ not a header";`;

const FILES = [
  { patch: PATCH },
  { patch: null }, // binary / oversized file — no patch to search
  { patch: `@@ -0,0 +1,1 @@\n+foo foo foo` },
];

describe("findMatchRangesInLine", () => {
  it("finds every occurrence on a line, left to right", () => {
    expect(findMatchRangesInLine("foo foo foo", "foo")).toEqual([
      [0, 3],
      [4, 7],
      [8, 11],
    ]);
  });

  it("steps past a hit — occurrences never overlap", () => {
    expect(findMatchRangesInLine("aaaa", "aa")).toEqual([
      [0, 2],
      [2, 4],
    ]);
  });

  it("empty query or empty line yields nothing", () => {
    expect(findMatchRangesInLine("code", "")).toEqual([]);
    expect(findMatchRangesInLine("", "code")).toEqual([]);
  });

  it("is case-insensitive unless asked otherwise", () => {
    expect(findMatchRangesInLine("Beta beta", "beta")).toHaveLength(2);
    expect(findMatchRangesInLine("Beta beta", "beta", true)).toEqual([[5, 9]]);
  });
});

describe("findInDiff", () => {
  it("returns nothing for an empty query", () => {
    expect(findInDiff(FILES, "")).toEqual([]);
  });

  it("anchors deletions LEFT and everything else RIGHT, in document order", () => {
    const matches = findInDiff(FILES, "const");
    expect(matches.map((m) => m.anchor)).toEqual([
      "RIGHT:1", // context line keeps its new-side number
      "LEFT:2", // the deleted line only exists on the old side
      "RIGHT:2",
      "RIGHT:3",
    ]);
    expect(matches.every((m) => m.fileIndex === 0)).toBe(true);
  });

  it("skips hunk headers — '@@' only matches inside real line content", () => {
    const matches = findInDiff(FILES, "@@");
    expect(matches).toHaveLength(1);
    expect(matches[0].anchor).toBe("RIGHT:3"); // the gamma string literal
  });

  it("reports every occurrence on a line with column offsets", () => {
    const matches = findInDiff(FILES, "foo");
    expect(matches).toEqual([
      { fileIndex: 2, anchor: "RIGHT:1", start: 0, end: 3 },
      { fileIndex: 2, anchor: "RIGHT:1", start: 4, end: 7 },
      { fileIndex: 2, anchor: "RIGHT:1", start: 8, end: 11 },
    ]);
  });

  it("matches case-insensitively by default; the toggle narrows it", () => {
    expect(findInDiff(FILES, "beta")).toHaveLength(2);
    expect(findInDiff(FILES, "beta", { caseSensitive: true })).toHaveLength(1);
    expect(
      findInDiff(FILES, "Beta", { caseSensitive: true })[0].anchor,
    ).toBe("RIGHT:2");
  });

  it("skips files without a patch but keeps later file indices right", () => {
    const matches = findInDiff(FILES, "foo");
    expect(matches[0].fileIndex).toBe(2);
  });

  it("caps at maxMatches; Infinity lifts the cap", () => {
    expect(findInDiff(FILES, "foo", { maxMatches: 2 })).toHaveLength(2);
    expect(findInDiff(FILES, "foo", { maxMatches: Infinity })).toHaveLength(3);
  });

  it("a needle with a newline never matches (rows are single lines)", () => {
    expect(findInDiff(FILES, "alpha;\nconst")).toEqual([]);
  });

  it("agrees with the per-line matcher when a periodic needle overlaps the marker column", () => {

    const files = [{ patch: "@@ -1,1 +1,1 @@\n-a-a-a" }];
    expect(findInDiff(files, "-a-a")).toEqual([
      { fileIndex: 0, anchor: "LEFT:1", start: 1, end: 5 },
    ]);
    expect(findMatchRangesInLine("a-a-a", "-a-a")).toEqual([[1, 5]]);
  });

  it("column offsets and hits agree with the per-line matcher row by row", () => {
    for (const query of ["const", "a", "@@", "foo", "Beta", " = "]) {
      for (const caseSensitive of [false, true]) {
        const matches = findInDiff(FILES, query, { caseSensitive });
        for (const m of matches) {
          const ranges = findMatchRangesInLine(
            contentAt(FILES[m.fileIndex].patch!, m.anchor),
            query,
            caseSensitive,
          );
          expect(ranges).toContainEqual([m.start, m.end]);
        }
      }
    }
  });
});

/** The content of the row a match anchors to (test helper). */
function contentAt(patch: string, anchor: string): string {
  for (const hunk of parsePatch(patch)) {
    for (const row of hunk.rows) {
      if (rowAnchor(row) === anchor) return row.content;
    }
  }
  throw new Error(`no row for anchor ${anchor}`);
}

describe("patchMayMatch", () => {
  it("is a conservative superset — never false when a row matches", () => {
    for (const query of ["const", "beta", "foo", "@@"]) {
      const hits = new Set(findInDiff(FILES, query).map((m) => m.fileIndex));
      for (const i of hits) {
        expect(patchMayMatch(FILES[i].patch, query)).toBe(true);
      }
    }
  });

  it("rejects files whose patch text lacks the query", () => {
    expect(patchMayMatch(FILES[0].patch, "zebra")).toBe(false);
    expect(patchMayMatch(null, "const")).toBe(false);
    expect(patchMayMatch(FILES[0].patch, "")).toBe(false);
  });

  it("respects the case-sensitivity flag", () => {
    expect(patchMayMatch(FILES[0].patch, "BETA")).toBe(true);
    expect(patchMayMatch(FILES[0].patch, "BETA", true)).toBe(false);
    expect(patchMayMatch(FILES[0].patch, "Beta", true)).toBe(true);
  });
});
