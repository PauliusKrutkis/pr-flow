// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { highlightLine, highlightLineWithMatch, isHighlightable } from "./highlight";

describe("language resolution", () => {
  it("resolves by extension and special basenames", () => {
    expect(isHighlightable("src/main.ts")).toBe(true);
    expect(isHighlightable("Dockerfile")).toBe(true);
    expect(isHighlightable("Makefile")).toBe(true);
    expect(isHighlightable("photo.png")).toBe(false);
    expect(isHighlightable("LICENSE")).toBe(false);
  });
});

describe("highlightLine", () => {
  it("escapes HTML for unknown languages", () => {
    expect(highlightLine("<b>&x</b>", "notes.unknownext")).toBe(
      "&lt;b&gt;&amp;x&lt;/b&gt;",
    );
  });

  it("emits hljs token spans for known languages", () => {
    const html = highlightLine("const x = 1;", "a.ts");
    expect(html).toContain("hljs-keyword");
  });

  it("treats block-comment continuation lines as comments (per-line quirk)", () => {
    // ` * text` has no /* opener on its own line — the heuristic catches it.
    for (const line of [" * Registers keyboard bindings", " */", "*"]) {
      const html = highlightLine(line, "a.ts");
      expect(html).toContain("hljs-comment");
    }
  });

  it("does not mistake C dereferences for comments", () => {
    const html = highlightLine("*ptr = 5;", "a.c");
    expect(html).not.toContain("hljs-comment");
  });
});

describe("highlightLineWithMatch", () => {
  it("wraps matches in q-hl marks", () => {
    const html = highlightLineWithMatch("const value = 1;", "a.ts", "value");
    expect(html).toContain('<mark class="q-hl">value</mark>');
  });

  it("keeps syntax spans intact around the mark", () => {
    const html = highlightLineWithMatch("const value = 1;", "a.ts", "value");
    expect(html).toContain("hljs-keyword");
  });

  it("marks matches that span token boundaries", () => {
    // "st x" crosses from the `const` keyword token into plain text.
    const html = highlightLineWithMatch("const x = 1;", "a.ts", "st x");
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toBe("const x = 1;");
    expect((html.match(/<mark/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it("no marks when the query misses", () => {
    const html = highlightLineWithMatch("const x = 1;", "a.ts", "zzz");
    expect(html).not.toContain("<mark");
  });
});
