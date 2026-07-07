// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff.ts";
import { detectIndentUnit, guideLevelsForHunk } from "./indent.ts";

function unitOf(lines: string[]) {
  const patch = ["@@ -1,9 +1,9 @@", ...lines.map((l) => ` ${l}`)].join("\n");
  return detectIndentUnit(parsePatch(patch));
}

describe("detectIndentUnit", () => {
  it("uses the smallest nonzero space indent", () => {
    expect(unitOf(["function f() {", "  two;", "    four;", "}"])).toEqual({
      ch: 2,
      chars: 2,
    });
    expect(
      unitOf(["function f() {", "    four;", "        eight;", "}"])
    ).toEqual({ ch: 4, chars: 4 });
  });

  it("clamps to 2/4/8", () => {
    expect(unitOf(["   three;"]).ch).toBe(2);
    expect(unitOf(["     five;"]).ch).toBe(4);
    expect(unitOf(["         nine;"]).ch).toBe(8);
  });

  it("defaults to 2 when nothing is indented", () => {
    expect(unitOf(["top();", "level();"])).toEqual({ ch: 2, chars: 2 });
    expect(detectIndentUnit([])).toEqual({ ch: 2, chars: 2 });
  });

  it("treats tab files as one tab per level at the 8ch tab stop", () => {
    expect(unitOf(["fn() {", "\tone;", "\t\ttwo;", "}"])).toEqual({
      ch: 8,
      chars: 1,
    });
    expect(unitOf(["\t  mixed;", "  two;"])).toEqual({ ch: 8, chars: 1 });
  });

  it("ignores whitespace-only rows and hunk headers", () => {
    expect(unitOf(["      ", "    four;"])).toEqual({ ch: 4, chars: 4 });
  });
});

describe("guideLevelsForHunk", () => {
  const two = { ch: 2, chars: 2 };
  const row = (content: string, type = "context") => ({ content, type });

  it("counts levels per row; zero-indent rows get null", () => {
    const rows = [row("top();"), row("  one();"), row("    two();")];
    expect(guideLevelsForHunk(rows, two)).toEqual([null, 1, 2]);
  });

  it("bridges blank lines with the smaller neighbour so columns run straight", () => {
    const rows = [
      row("    a();"),
      row(""),
      row("      b();"),
      row("        "),
      row("  c();"),
    ];
    expect(guideLevelsForHunk(rows, two)).toEqual([2, 2, 3, 1, 1]);
  });

  it("does not bridge past the hunk's edge or invent guides at top level", () => {
    const rows = [row(""), row("    a();"), row("")];
    expect(guideLevelsForHunk(rows, two)).toEqual([null, 2, null]);
  });

  it("hunk header rows are null and stop bridging", () => {
    const rows = [row("    a();"), row("@@", "hunk"), row(""), row("    b();")];
    expect(guideLevelsForHunk(rows, two)).toEqual([2, null, null, 2]);
  });

  it("floors partial units — a continuation line keeps its block's guides", () => {
    expect(guideLevelsForHunk([row("     odd();")], two)).toEqual([2]);
  });
});
