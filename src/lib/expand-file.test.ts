import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../types.ts";
import { blobToLines, canExpandFile, expandFileRows } from "./expand-file.ts";

const PATCH = `@@ -1,4 +1,4 @@
 export function withRetry() {
-  const retryCount = 3;
+  const retryLimit = 3;
   let delay = 100;
 }
@@ -10,3 +10,4 @@ export function retryLoop() {
   let delay = base;
   let attempt = 0;
+  const history = [];`;

const FILE_LINES = [
  "export function withRetry() {",
  "  const retryLimit = 3;",
  "  let delay = 100;",
  "}",
  "",
  "const BASE = 100;",
  "const MAX = 5_000;",
  "",
  "export function retryLoop() {",
  "  let delay = base;",
  "  let attempt = 0;",
  "  const history = [];",
  "}",
  "",
  "export const done = true;",
];

function toBase64(text: string): string {
  return btoa(text);
}

describe("expandFileRows", () => {
  it("fills the gaps between hunks and after the last one", () => {
    const rows = expandFileRows(PATCH, FILE_LINES);
    expect(rows).not.toBeNull();
    if (!rows) {
      return;
    }
    expect(rows.map((r) => r.content)).toEqual([
      "export function withRetry() {",
      "  const retryCount = 3;",
      "  const retryLimit = 3;",
      "  let delay = 100;",
      "}",
      "",
      "const BASE = 100;",
      "const MAX = 5_000;",
      "",
      "export function retryLoop() {",
      "  let delay = base;",
      "  let attempt = 0;",
      "  const history = [];",
      "}",
      "",
      "export const done = true;",
    ]);
  });

  it("numbers synthesized rows on both sides with the hunk offset applied", () => {
    const rows = expandFileRows(PATCH, FILE_LINES);
    const synthetic = (rows ?? []).filter((r) => r.synthetic);
    expect(synthetic.map((r) => [r.oldLine, r.newLine])).toEqual([
      [5, 5],
      [6, 6],
      [7, 7],
      [8, 8],
      [9, 9],
      [12, 13],
      [13, 14],
      [14, 15],
    ]);
    expect(synthetic.every((r) => r.type === "context")).toBe(true);
  });

  it("keeps the patch's own row objects so metadata keyed by identity survives", () => {
    const rows = expandFileRows(PATCH, FILE_LINES);
    const del = rows?.find((r) => r.type === "del");
    expect(del?.content).toBe("  const retryCount = 3;");
    expect(del?.synthetic).toBeUndefined();
  });

  it("returns the same array for the same patch and lines", () => {
    expect(expandFileRows(PATCH, FILE_LINES)).toBe(
      expandFileRows(PATCH, FILE_LINES)
    );
  });

  it("rejects a blob that disagrees with the patch", () => {
    const edited = [...FILE_LINES];
    edited[2] = "  let delay = 999;";
    expect(expandFileRows(PATCH, edited)).toBeNull();
  });

  it("rejects a blob shorter than the patch expects", () => {
    expect(expandFileRows(PATCH, FILE_LINES.slice(0, 6))).toBeNull();
  });

  it("rejects an added-file patch (no old side to align)", () => {
    const added = `@@ -0,0 +1,2 @@
+const a = 1;
+const b = 2;`;
    expect(expandFileRows(added, ["const a = 1;", "const b = 2;"])).toBeNull();
  });
});

describe("blobToLines", () => {
  it("decodes text and drops the trailing-newline artifact", () => {
    const blob = { base64: toBase64("a\nb\n"), size: 4 };
    expect(blobToLines(blob)).toEqual(["a", "b"]);
  });

  it("keeps a genuine trailing blank line", () => {
    const blob = { base64: toBase64("a\n\n"), size: 3 };
    expect(blobToLines(blob)).toEqual(["a", ""]);
  });

  it("flags binary and oversized blobs", () => {
    expect(blobToLines({ base64: toBase64("a\u0000b"), size: 3 })).toBe(
      "binary"
    );
    expect(blobToLines({ base64: "", size: 3_000_000 })).toBe("too-large");
  });
});

describe("canExpandFile", () => {
  const base: ChangedFile = {
    additions: 1,
    changes: 1,
    deletions: 0,
    filename: "a.ts",
    patch: PATCH,
    sha: "s",
    status: "modified",
  };

  it("allows modified files with a patch, rejects added/removed/patchless", () => {
    expect(canExpandFile(base)).toBe(true);
    expect(canExpandFile({ ...base, status: "added" })).toBe(false);
    expect(canExpandFile({ ...base, status: "removed" })).toBe(false);
    expect(canExpandFile({ ...base, patch: null })).toBe(false);
  });
});
