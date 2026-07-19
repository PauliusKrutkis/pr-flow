import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

const WATCH = /Watch/;

/**
 * Icon-only buttons that used to only carry a `title` attribute now use the
 * shared <Tooltip>. This covers a representative sample (find bar, viewed
 * toggle, inbox watch button) across the review and inbox surfaces.
 */

test("find bar close button shows a tooltip with its keyboard hint", async ({
  page,
}) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await page.keyboard.press("Control+f");
  const closeBtn = page.locator(".qf-findbar-btn").last();
  await closeBtn.hover();
  await expect(page.locator(".q-tooltip")).toBeVisible();
  await expect(page.locator(".q-tooltip")).toContainText("Close");
  await page.screenshot({ path: "evidence/tooltips-findbar-close.png" });
});

test("viewed toggle button shows a tooltip with its hotkey", async ({
  page,
}) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  const viewedBtn = page.locator(".qf-viewed-btn").first();
  await viewedBtn.hover();
  await expect(page.locator(".q-tooltip")).toBeVisible();
  await expect(page.locator(".q-tooltip")).toContainText("Mark as viewed");
});

test("inbox watch button shows a tooltip", async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();

  const watchBtn = page.getByRole("button", { name: WATCH }).first();
  await watchBtn.hover();
  await expect(page.locator(".q-tooltip")).toBeVisible();
  await page.screenshot({ path: "evidence/tooltips-inbox-watch.png" });
});
