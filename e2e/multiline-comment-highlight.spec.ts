import { setupApp } from "./bridge.ts";
import { DETAIL } from "./fixtures.ts";
import { expect, test } from "./test.ts";

/**
 * A flowing block comment (no leading `*` on continuation lines) used to
 * only grey out its first line — highlight.ts tokenized every line in
 * isolation, and the pre-existing COMMENT_CONTINUATION heuristic only
 * catches lines starting with `*`. markBlockCommentRows fixes this by
 * tracking open/close state per row within a patch's hunks.
 */
const MULTILINE_COMMENT_PATCH = `@@ -1,3 +1,7 @@
+/* Head-blob fixtures for full-file expansion (get_file_blob). fuzzy.ts must
+agree with PATCH line-for-line on the new side — expandFileRows validates —
+and carries extra tail lines that only exist when expanded. */
+const x = 1;
 export function fuzzyScore(query: string, target: string) {
   return target.includes(query) ? 1 : 0;
 }`;

test("a flowing multi-line block comment is highlighted on every line, not just the first", async ({
  page,
}) => {
  const detail = structuredClone(DETAIL) as typeof DETAIL;
  detail.files[0].patch = MULTILINE_COMMENT_PATCH;

  await setupApp(page, { detail });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await expect(
    page.locator(".hljs-comment", { hasText: "Head-blob fixtures" })
  ).toBeVisible();
  await expect(
    page.locator(".hljs-comment", {
      hasText: "agree with PATCH line-for-line",
    })
  ).toBeVisible();
  await expect(
    page.locator(".hljs-comment", { hasText: "carries extra tail lines" })
  ).toBeVisible();

  await expect(
    page.locator(".hljs-comment", { hasText: "const x = 1" })
  ).toHaveCount(0);
  await expect(
    page.locator(".hljs-keyword", { hasText: "const" }).first()
  ).toBeVisible();

  await page.screenshot({ path: "evidence/multiline-comment-highlight.png" });
});
