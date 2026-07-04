import { describe, expect, it } from "vitest";
import { parsePatch } from "./diff";
import { detectIndentUnit, guideRange } from "./indent";

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
    expect(unitOf(["function f() {", "    four;", "        eight;", "}"])).toEqual(
      { ch: 4, chars: 4 },
    );
  });

  it("clamps to 2/4/8", () => {
    // A 3-space minimum reads as continuation alignment, not a 3-space unit.
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
    // Mixed tab/space lines count as tab-indented.
    expect(unitOf(["\t  mixed;", "  two;"])).toEqual({ ch: 8, chars: 1 });
  });

  it("ignores whitespace-only rows and hunk headers", () => {
    expect(unitOf(["      ", "    four;"])).toEqual({ ch: 4, chars: 4 });
  });
});

describe("guideRange", () => {
  const two = { ch: 2, chars: 2 };
  const tab = { ch: 8, chars: 1 };

  it("spans the leading whitespace from column 0", () => {
    expect(guideRange("    x = 1;", two)).toEqual([0, 4]);
    expect(guideRange("      deep();", two)).toEqual([0, 6]);
    expect(guideRange("\t\tx();", tab)).toEqual([0, 2]);
  });

  it("skips lines with less than two levels (no value, less DOM)", () => {
    expect(guideRange("  x = 1;", two)).toBeNull();
    expect(guideRange("top();", two)).toBeNull();
    expect(guideRange("\tx();", tab)).toBeNull();
  });

  it("skips blank and whitespace-only lines", () => {
    expect(guideRange("", two)).toBeNull();
    expect(guideRange("        ", two)).toBeNull();
  });
});
