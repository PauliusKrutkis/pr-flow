import { describe, expect, it } from "vitest";
import type { ChangedFile } from "../types.ts";
import { buildReviewItems, type ReviewItem } from "./review-items.ts";

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

function fileWith(patch: string | null): ChangedFile {
  return {
    additions: 3,
    changes: 4,
    deletions: 2,
    filename: "src/thing.ts",
    patch,
    sha: "abc",
    status: "modified",
  };
}

function build(collapsed = new Map<number, ReadonlySet<number>>()) {
  return buildReviewItems({
    collapsed,
    commentsByFile: new Map(),
    files: [fileWith(PATCH)],
    isImage: () => false,
    openBoxes: new Map(),
    pendingByFile: new Map(),
  });
}

function rowAt(model: ReturnType<typeof build>, navIndex: number): ReviewItem {
  return model.items[model.nav[navIndex].itemIndex];
}

describe("buildReviewItems hunkStarts", () => {
  it("marks the first navigable row of each hunk", () => {
    const model = build();
    expect(model.hunkStarts).toHaveLength(2);
    expect(model.hunkStarts[0]).toBe(0);
    expect(model.hunkStarts[0]).toBeLessThan(model.hunkStarts[1]);

    const first = rowAt(model, model.hunkStarts[0]);
    const second = rowAt(model, model.hunkStarts[1]);
    expect(first.kind === "row" && first.hunkIndex).toBe(0);
    expect(second.kind === "row" && second.hunkIndex).toBe(1);
  });

  it("skips a collapsed hunk (no rows to land on)", () => {
    const model = build(new Map([[0, new Set([0])]]));
    expect(model.hunkStarts).toHaveLength(1);
    const only = rowAt(model, model.hunkStarts[0]);
    expect(only.kind === "row" && only.hunkIndex).toBe(1);
  });
});
