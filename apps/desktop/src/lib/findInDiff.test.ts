import { describe, expect, it } from "vitest";
import { findInDiff, findMatchRangesInLine } from "./findInDiff";

// @@ -1,3 +1,4 @@ resolves to: context old1/new1, del old2, add new2, add new3.
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
});
