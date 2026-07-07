import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff";
import { intralineDiff, intralinePairs, tokenize } from "./intraline";

/** The emphasized substrings, for readable assertions. */
function slices(text: string, ranges: Array<[number, number]>): string[] {
  return ranges.map(([s, e]) => text.slice(s, e));
}

describe("tokenize", () => {
  it("tiles a line into words, whitespace runs, and single symbols", () => {
    const tokens = tokenize("  foo(a, b);");
    expect(tokens.map((t) => t.text)).toEqual([
      "  ",
      "foo",
      "(",
      "a",
      ",",
      " ",
      "b",
      ")",
      ";",
    ]);
    expect(tokens.map((t) => t.text).join("")).toBe("  foo(a, b);");
  });

  it("splits identifiers at camelCase humps and underscores", () => {
    expect(tokenize("retryCount").map((t) => t.text)).toEqual([
      "retry",
      "Count",
    ]);
    expect(tokenize("HTTPServer").map((t) => t.text)).toEqual([
      "HTTP",
      "Server",
    ]);
    expect(tokenize("retry_count2").map((t) => t.text)).toEqual([
      "retry",
      "_",
      "count2",
    ]);
  });

  it("flags whitespace tokens", () => {
    const tokens = tokenize("a  b");
    expect(tokens.map((t) => t.ws)).toEqual([false, true, false]);
  });
});

describe("intralineDiff", () => {
  it("emphasizes only the changed identifier piece in a rename", () => {
    const d = intralineDiff(
      "  const retryCount = 3;",
      "  const retryLimit = 3;",
    )!;
    expect(slices("  const retryCount = 3;", d.del)).toEqual(["Count"]);
    expect(slices("  const retryLimit = 3;", d.add)).toEqual(["Limit"]);
  });

  it("handles pure insertions (one side has no changed span)", () => {
    const d = intralineDiff("foo(a)", "foo(a, b)")!;
    expect(d.del).toEqual([]);
    expect(slices("foo(a, b)", d.add)).toEqual([", b"]);
  });

  it("merges adjacent changed tokens into one span", () => {
    const d = intralineDiff("call(x)", "call(y.z)")!;
    expect(slices("call(y.z)", d.add)).toEqual(["y.z"]);
  });

  it("keeps separate spans when an unchanged token sits between changes", () => {
    const d = intralineDiff("f(alpha, beta)", "f(gamma, delta)")!;
    expect(slices("f(gamma, delta)", d.add)).toEqual(["gamma", "delta"]);
    expect(slices("f(alpha, beta)", d.del)).toEqual(["alpha", "beta"]);
  });

  it("bails when the lines share too little (common-token ratio < 0.4)", () => {
    expect(intralineDiff("  return 1;", "  // tuned")).toBeNull();
    expect(
      intralineDiff("const a = compute();", "let done = false;"),
    ).toBeNull();
  });

  it("bails on empty or whitespace-only lines", () => {
    expect(intralineDiff("", "const a = 1;")).toBeNull();
    expect(intralineDiff("const a = 1;", "   ")).toBeNull();
  });

  it("bails on identical lines (nothing to emphasize)", () => {
    expect(intralineDiff("same();", "same();")).toBeNull();
  });

  it("bails past the span cap even when the ratio passes", () => {

    const del = "f(a1, b1, c1, d1, e1, f1, g1, h1, i1)";
    const add = "f(a2, b2, c2, d2, e2, f2, g2, h2, i2)";
    expect(intralineDiff(del, add)).toBeNull();
  });

  it("counts whitespace changes as changed spans but not toward the ratio", () => {
    const d = intralineDiff("a = b;", "a   = b;")!;
    expect(slices("a   = b;", d.add)).toEqual(["   "]);
  });
});

describe("intralinePairs", () => {
  const patch = [
    "@@ -1,6 +1,6 @@",
    " context();",
    "-  const retryCount = 3;",
    "-  return retryCount;",
    "+  const retryLimit = 3;",
    "+  return retryLimit;",
    " more();",
  ].join("\n");

  it("pairs a del run with the following add run index-wise", () => {
    const hunks = parsePatch(patch);
    const map = intralinePairs(hunks);
    const rows = hunks[0].rows;
    const del0 = rows.find((r) => r.content === "  const retryCount = 3;")!;
    const add0 = rows.find((r) => r.content === "  const retryLimit = 3;")!;
    const del1 = rows.find((r) => r.content === "  return retryCount;")!;
    const add1 = rows.find((r) => r.content === "  return retryLimit;")!;
    expect(slices(del0.content, map.get(del0)!)).toEqual(["Count"]);
    expect(slices(add0.content, map.get(add0)!)).toEqual(["Limit"]);
    expect(slices(del1.content, map.get(del1)!)).toEqual(["Count"]);
    expect(slices(add1.content, map.get(add1)!)).toEqual(["Limit"]);
    const ctx = rows.find((r) => r.type === "context")!;
    expect(map.has(ctx)).toBe(false);
  });

  it("leaves leftover rows of an unbalanced run unpaired", () => {

    const hunks = parsePatch(
      ["@@ -1,2 +1,3 @@", "-  return 1;", "+  // tuned", "+  return 2;"].join(
        "\n",
      ),
    );
    expect(intralinePairs(hunks).size).toBe(0);
  });

  it("does not pair across hunks or across context rows", () => {
    const hunks = parsePatch(
      [
        "@@ -1,3 +1,3 @@",
        "-  const retryCount = 3;",
        " between();",
        "+  const retryLimit = 3;",
        "@@ -10,1 +10,1 @@",
        "-  const retryCount = 3;",
      ].join("\n"),
    );
    expect(intralinePairs(hunks).size).toBe(0);
  });
});
