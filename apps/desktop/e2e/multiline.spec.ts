import { expect, test } from "./test";
import { setupApp } from "./bridge";

// Multi-line comment ranges: shift+j/k grows a one-side, hunk-contiguous run
// from the cursor (a "fat cursor"); dragging the gutter "+" builds the same
// range with the mouse; `c` opens the composer under the range's END row
// carrying the start line; suggestions prefill every selected row.
//
// fuzzy.ts fixture rows, in nav order:
//   RIGHT:1 "export function alpha() {"   (context)
//   LEFT:2  "  return 1;"                 (del — the side boundary)
//   RIGHT:2 "  // tuned"                  (add)
//   RIGHT:3 "  return 2;"                 (add)
//   RIGHT:4 "}"                           (context)
//   RIGHT:5 "export const beta = true;"   (context)

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

/** Seat the cursor on "// tuned" (RIGHT:2). The first j only REVEALS the
 *  cursor (rAF-coalesced moves discard the delta on reveal), so wait for it
 *  before stepping. */
async function cursorToTuned(page: import("@playwright/test").Page) {
  await page.keyboard.press("j");
  await expect(
    page.locator('.qf-row-active[data-anchor="RIGHT:1"]'),
  ).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("j");
  await expect(
    page.locator('.qf-row-active[data-anchor="RIGHT:2"]'),
  ).toBeVisible();
}

test("shift+j grows the range; c comments on it with a multi-line suggestion", async ({ page }) => {
  await cursorToTuned(page);
  await page.keyboard.press("Shift+j");
  await page.keyboard.press("Shift+j");
  // "// tuned", "return 2;", "}" — three rows lit.
  await expect(page.locator(".qf-row-selected")).toHaveCount(3);

  await page.keyboard.press("c");
  await expect(page.locator(".qf-range-head")).toHaveText("Lines 2–4");
  const ed = page.getByRole("textbox", { name: "Add a review comment…" });
  await expect(ed).toBeFocused();

  // The suggestion block prefills the WHOLE range.
  await page.getByRole("button", { name: "Insert suggestion" }).click();
  const sugg = ed.locator("pre code.language-suggestion");
  await expect(sugg).toContainText("// tuned");
  await expect(sugg).toContainText("return 2;");
  await expect(sugg).toContainText("}");

  // Batch it: the pending card carries the range chip and the 3-line fence.
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".qf-range-tag")).toHaveText("Lines 2–4");
  await expect(
    page.locator(".qf-pending .md-suggestion-line"),
  ).toHaveCount(3);
});

test("the submitted review payload carries the range start", async ({ page }) => {
  await cursorToTuned(page);
  await page.keyboard.press("Shift+j");
  await page.keyboard.press("c");
  const ed = page.getByRole("textbox", { name: "Add a review comment…" });
  await expect(ed).toBeFocused();
  await page.keyboard.type("tighten this pair");
  await page.keyboard.press("Control+Enter"); // add to review
  await expect(page.getByText("Pending")).toBeVisible();

  await page.keyboard.press("s");
  await page.keyboard.press("Control+Enter"); // submit (COMMENT verdict)
  await expect
    .poll(async () =>
      page.evaluate(() =>
        JSON.parse(localStorage.getItem("e2e:lastReview") ?? "null"),
      ),
    )
    .toMatchObject({
      comments: [{ path: "src/lib/fuzzy.ts", line: 3, side: "RIGHT", startLine: 2 }],
    });
});

test("extension never crosses a side boundary", async ({ page }) => {
  // Cursor on RIGHT:1 — the next nav row is the LEFT:2 deletion.
  await page.keyboard.press("j");
  await expect(
    page.locator('.qf-row-active[data-anchor="RIGHT:1"]'),
  ).toBeVisible();
  await page.keyboard.press("Shift+j");
  await expect(page.locator(".qf-row-selected")).toHaveCount(0);
});

test("shift+k shrinks back over the anchor and the range collapses", async ({ page }) => {
  await cursorToTuned(page);
  await page.keyboard.press("Shift+j");
  await expect(page.locator(".qf-row-selected")).toHaveCount(2);
  await page.keyboard.press("Shift+k");
  await expect(page.locator(".qf-row-selected")).toHaveCount(0);
});

test("plain j collapses the range; esc clears it without leaving the review", async ({ page }) => {
  await cursorToTuned(page);
  await page.keyboard.press("Shift+j");
  await expect(page.locator(".qf-row-selected")).toHaveCount(2);
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-selected")).toHaveCount(0);

  await page.keyboard.press("Shift+j");
  await expect(page.locator(".qf-row-selected")).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-row-selected")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" }),
  ).toBeVisible();
});

test("dragging the gutter + selects the range and opens the composer", async ({ page }) => {
  const from = page.locator('.qf-row[data-file-index="0"][data-anchor="RIGHT:2"]');
  const to = page.locator('.qf-row[data-file-index="0"][data-anchor="RIGHT:4"]');
  await from.hover();
  const btn = from.locator(".qf-add-btn");
  await expect(btn).toBeVisible();

  const start = await btn.boundingBox();
  const end = await to.boundingBox();
  if (!start || !end) throw new Error("rows not laid out");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, {
    steps: 6,
  });
  await expect(page.locator(".qf-row-selected")).toHaveCount(3);
  // The "+" travels with the drag: it paints on the moving end row while the
  // pressed one (still holding pointer capture) fades out.
  await expect(to.locator(".qf-add-btn")).toHaveCSS("display", "grid");
  await expect(to.locator(".qf-add-btn")).toHaveCSS("opacity", "1");
  await expect(btn).toHaveCSS("opacity", "0");
  await page.mouse.up();

  await expect(page.locator(".qf-range-head")).toHaveText("Lines 2–4");
  await expect(
    page.getByRole("textbox", { name: "Add a review comment…" }),
  ).toBeFocused();
});

test("a plain + click still opens the single-line composer", async ({ page }) => {
  const row = page.locator('.qf-row[data-file-index="0"][data-anchor="RIGHT:2"]');
  await row.hover();
  await row.locator(".qf-add-btn").click();
  await expect(
    page.getByRole("textbox", { name: "Add a review comment…" }),
  ).toBeVisible();
  await expect(page.locator(".qf-range-head")).toHaveCount(0);
});

test("a pending range survives leaving and reopening the PR", async ({ page }) => {
  await cursorToTuned(page);
  await page.keyboard.press("Shift+j");
  await page.keyboard.press("c");
  await expect(
    page.getByRole("textbox", { name: "Add a review comment…" }),
  ).toBeFocused();
  await page.keyboard.type("keep this range");
  await page.keyboard.press("Control+Enter");
  await expect(page.locator(".qf-range-tag")).toHaveText("Lines 2–3");

  await page.keyboard.press("Escape"); // back to inbox
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter"); // reopen
  await expect(page.locator(".qf-range-tag")).toHaveText("Lines 2–3");
});
