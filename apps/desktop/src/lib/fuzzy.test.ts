import { describe, expect, it } from "vitest";
import { fuzzyMatch, fuzzyMatchFields } from "./fuzzy";

describe("fuzzyMatch", () => {
  it("empty query matches everything with no highlights", () => {
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, indices: [] });
    expect(fuzzyMatch("   ", "anything")).toEqual({ score: 0, indices: [] });
  });

  it("misses when a character never appears", () => {
    expect(fuzzyMatch("xyz", "abc")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(fuzzyMatch("READ", "readme.md")).not.toBeNull();
    expect(fuzzyMatch("read", "README.md")).not.toBeNull();
  });

  it("substring beats scattered subsequence", () => {
    const sub = fuzzyMatch("view", "DiffViewer.tsx")!;
    const scattered = fuzzyMatch("view", "va_i_e_w_stuff")!;
    expect(sub.score).toBeGreaterThan(scattered.score);
  });

  it("word-boundary start beats mid-word", () => {
    const boundary = fuzzyMatch("side", "file-sidebar.tsx")!;
    const mid = fuzzyMatch("side", "beside.tsx")!;
    expect(boundary.score).toBeGreaterThan(mid.score);
  });

  it("returns contiguous indices for substring matches", () => {
    const m = fuzzyMatch("bar", "sidebar")!;
    expect(m.indices).toEqual([4, 5, 6]);
  });

  it("multi-term queries require every term, order-independent", () => {
    expect(fuzzyMatch("fix login", "login: fix the redirect")).not.toBeNull();
    expect(fuzzyMatch("fix logout", "login: fix the redirect")).toBeNull();
  });

  it("merges indices across terms", () => {
    const m = fuzzyMatch("a b", "a b")!;
    expect(m.indices).toEqual([0, 2]);
  });
});

describe("fuzzyMatchFields", () => {
  it("null when no field matches", () => {
    expect(fuzzyMatchFields("zzz", { a: "one", b: "two" })).toBeNull();
  });

  it("takes the best field's score and reports per-field indices", () => {
    const m = fuzzyMatchFields("titleword", {
      title: "titleword here",
      author: "someone",
    })!;
    expect(m.indices.title).toBeDefined();
    expect(m.indices.author).toBeUndefined();
    expect(m.score).toBeGreaterThan(0);
  });
});
