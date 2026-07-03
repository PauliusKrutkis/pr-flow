import { describe, expect, it } from "vitest";
import { changedRowCount, parsePatch } from "./diff";

const PATCH = `@@ -1,4 +1,5 @@
 context one
-removed line
+added line one
+added line two
 context two
@@ -10,2 +11,2 @@ fn header() {
 tail context
-old tail
+new tail`;

describe("parsePatch", () => {
  it("returns no hunks for missing patches", () => {
    expect(parsePatch(undefined)).toEqual([]);
    expect(parsePatch(null)).toEqual([]);
    expect(parsePatch("")).toEqual([]);
  });

  it("splits hunks and keeps headers", () => {
    const hunks = parsePatch(PATCH);
    expect(hunks).toHaveLength(2);
    expect(hunks[0].header).toBe("@@ -1,4 +1,5 @@");
    expect(hunks[1].header).toBe("@@ -10,2 +11,2 @@ fn header() {");
    // The header is also the first row of the hunk (type "hunk").
    expect(hunks[0].rows[0].type).toBe("hunk");
  });

  it("numbers context/add/del rows on the right sides", () => {
    const rows = parsePatch(PATCH)[0].rows.filter((r) => r.type !== "hunk");
    expect(rows.map((r) => [r.type, r.oldLine, r.newLine])).toEqual([
      ["context", 1, 1],
      ["del", 2, null],
      ["add", null, 2],
      ["add", null, 3],
      ["context", 3, 4],
    ]);
  });

  it("continues numbering from the second hunk's header", () => {
    const rows = parsePatch(PATCH)[1].rows.filter((r) => r.type !== "hunk");
    expect(rows.map((r) => [r.type, r.oldLine, r.newLine])).toEqual([
      ["context", 10, 11],
      ["del", 11, null],
      ["add", null, 12],
    ]);
  });

  it("ignores no-newline metadata lines", () => {
    const rows = parsePatch("@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new")[0]
      .rows.filter((r) => r.type !== "hunk");
    expect(rows.map((r) => r.type)).toEqual(["del", "add"]);
  });

  it("strips the +/-/space marker from content", () => {
    const rows = parsePatch("@@ -1 +1 @@\n-a\n+b")[0].rows.filter(
      (r) => r.type !== "hunk",
    );
    expect(rows.map((r) => r.content)).toEqual(["a", "b"]);
  });
});

describe("changedRowCount", () => {
  it("counts adds + dels across hunks", () => {
    expect(changedRowCount(PATCH)).toBe(5);
    expect(changedRowCount(null)).toBe(0);
  });
});
