import { expect, test } from "@playwright/test";
import { setupApp } from "./bridge";

// Diff scanability: intraline word-diff emphasis (and friends — sticky hunk
// context, indent guides, the overview ruler — as they land).

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("a clean rename emphasizes exactly the changed word pieces", async ({ page }) => {
  // retry.ts pairs "const retryCount = 3;" with "const retryLimit = 3;" —
  // the tokenizer splits the camelCase identifier, so only the differing
  // pieces light up.
  const section = page.locator(".qf-fsec").nth(2);
  const marks = section.locator("mark.qf-intra-mark");
  await expect(marks).toHaveCount(2);
  expect(await marks.allTextContents()).toEqual(["Count", "Limit"]);
  await expect(
    section.locator(".qf-row-del mark.qf-intra-mark"),
  ).toHaveText("Count");
  await expect(
    section.locator(".qf-row-add mark.qf-intra-mark"),
  ).toHaveText("Limit");
});

test("a rewrite pair fails the noise guard and renders without emphasis", async ({ page }) => {
  // fuzzy.ts pairs "- return 1;" with "+ // tuned" (the del run's only row
  // against the add run's first): no substantive tokens in common, so
  // emphasizing would cover both lines wall-to-wall — the guard bails.
  const section = page.locator(".qf-fsec").nth(0);
  // The section is rendered (its marks WOULD be visible)…
  await expect(section.locator(".qf-row-del")).toHaveCount(1);
  // …but carries no intraline emphasis.
  await expect(section.locator("mark.qf-intra-mark")).toHaveCount(0);
});

test("intraline emphasis is paint-only and survives find marks on top", async ({ page }) => {
  const row = page.locator(".qf-fsec").nth(2).locator(".qf-row-add").first();
  const before = await row.boundingBox();

  // Find marks layer over the intraline marks without displacing them. One
  // logical match ("1/1") renders as TWO mark fragments: the query spans the
  // intraline mark's text-node boundary, and marks wrap per text node.
  await page.keyboard.press("Control+f");
  await page.getByPlaceholder("Find in diff").fill("retryLimit");
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/1");
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(2);
  await expect(
    page.locator(".qf-fsec").nth(2).locator("mark.qf-intra-mark"),
  ).toHaveCount(2);

  const after = await row.boundingBox();
  expect(after).toEqual(before);

  const style = await page
    .locator("mark.qf-intra-mark")
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { padding: s.padding, margin: s.margin, border: s.borderWidth };
    });
  expect(style).toEqual({ padding: "0px", margin: "0px", border: "0px" });

  await page.keyboard.press("Escape");
});
