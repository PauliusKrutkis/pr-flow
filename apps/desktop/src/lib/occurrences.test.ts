import { describe, expect, it } from "vitest";
import {
  occurrenceMatches,
  occurrenceRangesInLine,
  occurrenceSpecFromSelection,
} from "./occurrences";

describe("occurrenceSpecFromSelection", () => {
  it("accepts a word selection and asks for whole-word matching", () => {
    expect(occurrenceSpecFromSelection("gamma")).toEqual({
      query: "gamma",
      wholeWord: true,
    });
    expect(occurrenceSpecFromSelection("foo_bar2")).toEqual({
      query: "foo_bar2",
      wholeWord: true,
    });
  });

  it("accepts non-word selections as plain substrings", () => {
    expect(occurrenceSpecFromSelection("q.trim")).toEqual({
      query: "q.trim",
      wholeWord: false,
    });
    expect(occurrenceSpecFromSelection("foo bar")).toEqual({
      query: "foo bar",
      wholeWord: false,
    });
  });

  it("keeps the selection verbatim but gates on the trimmed length", () => {
    expect(occurrenceSpecFromSelection("  a  ")).toBeNull();
    expect(occurrenceSpecFromSelection(" ab ")).toEqual({
      query: " ab ",
      wholeWord: false,
    });
  });

  it("rejects too-short, too-long, and multi-line selections", () => {
    expect(occurrenceSpecFromSelection("a")).toBeNull();
    expect(occurrenceSpecFromSelection("x".repeat(65))).toBeNull();
    expect(occurrenceSpecFromSelection("foo\nbar")).toBeNull();
    expect(occurrenceSpecFromSelection("")).toBeNull();
  });

  it("rejects whitespace- and punctuation-only selections", () => {
    expect(occurrenceSpecFromSelection("   ")).toBeNull();
    expect(occurrenceSpecFromSelection("=>")).toBeNull();
    expect(occurrenceSpecFromSelection("&& {")).toBeNull();
  });

  it("accepts non-ASCII identifiers (letters count as substance)", () => {
    expect(occurrenceSpecFromSelection("héllo")).not.toBeNull();
  });
});

describe("occurrenceRangesInLine", () => {
  const word = { query: "id", wholeWord: true };

  it("whole-word mode skips hits inside longer identifiers", () => {
    expect(occurrenceRangesInLine("const id = width(id);", word)).toEqual([
      [6, 8],
      [17, 19],
    ]);
  });

  it("whole-word boundaries hold at the line edges", () => {
    expect(occurrenceRangesInLine("id + x.id", word)).toEqual([
      [0, 2],
      [7, 9],
    ]);
  });

  it("underscores and digits count as word characters", () => {
    expect(occurrenceRangesInLine("my_id id2 id", word)).toEqual([[10, 12]]);
  });

  it("substring mode matches anywhere", () => {
    expect(
      occurrenceRangesInLine("q.trim(); return q.trim();", {
        query: "q.trim",
        wholeWord: false,
      }),
    ).toEqual([
      [0, 6],
      [17, 23],
    ]);
  });

  it("matching is case-sensitive, the editor convention", () => {
    expect(
      occurrenceRangesInLine("Gamma gamma", { query: "gamma", wholeWord: true }),
    ).toEqual([[6, 11]]);
  });

  it("finds every occurrence on a line, left to right", () => {
    expect(
      occurrenceRangesInLine("foo foo foo", { query: "foo", wholeWord: true }),
    ).toHaveLength(3);
  });
});

describe("occurrenceMatches", () => {
  const file = {
    patch: [
      "@@ -1,3 +1,4 @@",
      " const gamma = 1;",
      "-use(gamma);",
      "+use(gamma, gamma);",
      " done();",
    ].join("\n"),
  };

  it("walks the whole patch in document order with row anchors", () => {
    const matches = occurrenceMatches(file, { query: "gamma", wholeWord: true });
    expect(matches).toEqual([
      { anchor: "RIGHT:1", start: 6, end: 11 },
      { anchor: "LEFT:2", start: 4, end: 9 },
      { anchor: "RIGHT:2", start: 4, end: 9 },
      { anchor: "RIGHT:2", start: 11, end: 16 },
    ]);
  });

  it("respects whole-word mode and never matches hunk headers", () => {
    const noisy = {
      patch: "@@ -1,1 +1,1 @@ fn gamma() {\n+gammaray(gamma);",
    };
    const matches = occurrenceMatches(noisy, { query: "gamma", wholeWord: true });
    expect(matches).toEqual([{ anchor: "RIGHT:1", start: 9, end: 14 }]);
  });

  it("handles missing patches", () => {
    expect(occurrenceMatches({}, { query: "xy", wholeWord: false })).toEqual([]);
  });
});
