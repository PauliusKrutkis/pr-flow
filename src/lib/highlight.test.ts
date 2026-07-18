import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff.ts";
import {
  highlightLine,
  highlightLineWithFind,
  highlightLineWithIntra,
  highlightLineWithMatch,
  highlightLineWithOccurrences,
  isHighlightable,
  markBlockCommentRows,
} from "./highlight.ts";

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
      "&lt;b&gt;&amp;x&lt;/b&gt;"
    );
  });

  it("emits hljs token spans for known languages", () => {
    const html = highlightLine("const x = 1;", "a.ts");
    expect(html).toContain("hljs-keyword");
  });

  it("treats block-comment continuation lines as comments (per-line quirk)", () => {
    for (const line of [" * Registers keyboard bindings", " */", "*"]) {
      const html = highlightLine(line, "a.ts");
      expect(html).toContain("hljs-comment");
    }
  });

  it("does not mistake C dereferences for comments", () => {
    const html = highlightLine("*ptr = 5;", "a.c");
    expect(html).not.toContain("hljs-comment");
  });

  it("treats a flowing continuation line (no leading *) as a comment when told it's open", () => {
    const html = highlightLine(
      "agree with PATCH line-for-line on the new side",
      "a.ts",
      true
    );
    expect(html).toBe(
      '<span class="hljs-comment">agree with PATCH line-for-line on the new side</span>'
    );
  });

  it("splits a closing continuation line into comment + normal code", () => {
    const html = highlightLine(
      "and carries extra tail lines. */ const x = 1;",
      "a.ts",
      true
    );
    expect(html.startsWith('<span class="hljs-comment">')).toBe(true);
    expect(html).toContain("and carries extra tail lines. */");
    expect(html).toContain("hljs-keyword");
    expect(html.replace(/<[^>]+>/g, "")).toBe(
      "and carries extra tail lines. */ const x = 1;"
    );
  });

  it("ignores startsInComment for languages without C-style block comments", () => {
    const html = highlightLine("no leading star here", "a.py", true);
    expect(html).not.toContain("hljs-comment");
  });
});

describe("markBlockCommentRows", () => {
  it("marks flowing continuation rows as inside a comment", () => {
    const patch = [
      "@@ -1,4 +1,4 @@",
      " /* Head-blob fixtures for full-file expansion. fuzzy.ts must",
      " agree with PATCH line-for-line on the new side —",
      " and carries extra tail lines that only exist when expanded. */",
      " const x = 1;",
    ].join("\n");
    const [hunk] = parsePatch(patch);
    const rows = hunk.rows.filter((r) => r.type !== "hunk");
    const marks = markBlockCommentRows([hunk], "a.ts");

    expect(marks.get(rows[0])).toBe(false); // the "/*" opener line itself
    expect(marks.get(rows[1])).toBe(true); // flowing continuation, no leading *
    expect(marks.get(rows[2])).toBe(true); // closes mid-line with */
    expect(marks.get(rows[3])).toBe(false); // after the comment closed
  });

  it("returns an empty map for languages without C-style block comments", () => {
    const patch = ["@@ -1,1 +1,1 @@", " x = 1"].join("\n");
    const [hunk] = parsePatch(patch);
    expect(markBlockCommentRows([hunk], "a.py").size).toBe(0);
  });

  it("resets comment state at hunk boundaries", () => {
    const patchA = [
      "@@ -1,2 +1,2 @@",
      " /* opens and never closes",
      " more",
    ].join("\n");
    const patchB = ["@@ -10,1 +10,1 @@", " plain code, not a comment"].join(
      "\n"
    );
    const [hunkA] = parsePatch(patchA);
    const [hunkB] = parsePatch(patchB);
    const marks = markBlockCommentRows([hunkA, hunkB], "a.ts");
    const bodyRow = hunkB.rows.find((r) => r.type !== "hunk");
    expect(bodyRow && marks.get(bodyRow)).toBe(false);
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

describe("highlightLineWithFind", () => {
  it("marks every occurrence and singles out the current one", () => {
    const html = highlightLineWithFind(
      "foo(foo, foo)",
      "a.ts",
      "foo",
      false,
      1
    );
    expect((html.match(/qf-find-mark/g) ?? []).length).toBe(3);
    expect((html.match(/qf-find-current/g) ?? []).length).toBe(1);

    const [beforeCurrent] = html.split("qf-find-current");
    expect((beforeCurrent.match(/<mark/g) ?? []).length).toBe(2);
  });

  it("no current mark when the current match is on another line", () => {
    const html = highlightLineWithFind("foo bar", "a.ts", "foo", false, null);
    expect(html).toContain("qf-find-mark");
    expect(html).not.toContain("qf-find-current");
  });

  it("respects the case toggle", () => {
    expect(
      highlightLineWithFind("Value value", "a.ts", "value", true, null).match(
        /<mark/g
      )
    ).toHaveLength(1);
    expect(
      highlightLineWithFind("Value value", "a.ts", "value", false, null).match(
        /<mark/g
      )
    ).toHaveLength(2);
  });

  it("keeps the rendered text byte-identical to the code", () => {
    const code = "const value = compute(value) + 1;";
    const html = highlightLineWithFind(code, "a.ts", "value", false, 0);
    expect(html.replace(/<[^>]+>/g, "")).toBe(code);
  });
});

describe("highlightLineWithIntra", () => {
  const code = "const retryLimit = 3;";

  it("wraps the given ranges in qf-intra-mark", () => {
    const html = highlightLineWithIntra(code, "a.ts", [[11, 16]]);
    expect(html).toContain('<mark class="qf-intra-mark">Limit</mark>');
    expect(html.replace(/<[^>]+>/g, "")).toBe(code);
  });

  it("null or empty ranges leave the highlighted line untouched", () => {
    expect(highlightLineWithIntra(code, "a.ts", null)).toBe(
      highlightLine(code, "a.ts")
    );
    expect(highlightLineWithIntra(code, "a.ts", [])).toBe(
      highlightLine(code, "a.ts")
    );
  });

  it("find marks nest inside intraline marks (intra is layered first)", () => {
    const html = highlightLineWithFind(code, "a.ts", "Lim", false, 0, [
      [11, 16],
    ]);
    expect(html).toContain("qf-intra-mark");
    expect(html).toContain("qf-find-mark");
    expect(html.indexOf("qf-intra-mark")).toBeLessThan(
      html.indexOf("qf-find-mark")
    );
    expect(html.replace(/<[^>]+>/g, "")).toBe(code);
  });

  it("occurrence marks nest inside intraline marks too", () => {
    const html = highlightLineWithOccurrences(
      code,
      "a.ts",
      "retryLimit",
      true,
      [[11, 16]]
    );
    expect(html).toContain("qf-intra-mark");
    expect(html).toContain("qf-occ-mark");
    expect(html.replace(/<[^>]+>/g, "")).toBe(code);
  });
});

describe("mark layering", () => {
  it("layers find marks over intraline emphasis with the text intact", () => {
    const code = "    const retryLimit = 3;";
    const html = highlightLineWithFind(code, "a.ts", "Lim", false, 0, [
      [15, 20],
    ]);
    expect(html).toContain("qf-intra-mark");
    expect(html).toContain("qf-find-mark");
    expect(html.replace(/<[^>]+>/g, "")).toBe(code);
  });
});

describe("highlightLineWithOccurrences", () => {
  it("marks whole-word occurrences with the quiet occurrence class", () => {
    const html = highlightLineWithOccurrences(
      "const id = width(id);",
      "a.ts",
      "id",
      true
    );
    expect((html.match(/qf-occ-mark/g) ?? []).length).toBe(2);
    expect(html).not.toContain("qf-find-mark");
  });

  it("substring mode marks hits inside identifiers", () => {
    const html = highlightLineWithOccurrences(
      "width widen",
      "a.ts",
      "wid",
      false
    );
    expect((html.match(/qf-occ-mark/g) ?? []).length).toBe(2);
  });

  it("keeps the rendered text byte-identical to the code", () => {
    const code = "const value = compute(value) + 1;";
    const html = highlightLineWithOccurrences(code, "a.ts", "value", true);
    expect(html.replace(/<[^>]+>/g, "")).toBe(code);
  });
});
