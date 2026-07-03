import { expect, test } from "@playwright/test";
import { setupApp } from "./bridge";

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  // The heading paints in the cold-cache skeleton — wait for the DIFF, which
  // is what the keyboard talks to.
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("continuous scroll: both files render with sticky headers", async ({ page }) => {
  await expect(page.locator(".qf-fsec")).toHaveCount(2);
  await expect(page.locator(".qf-fsec-head").nth(0)).toContainText("fuzzy.ts");
  await expect(page.locator(".qf-fsec-head").nth(1)).toContainText("search.ts");
});

test("j moves the line cursor; sidebar follows the cursor's file", async ({ page }) => {
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-active")).toHaveCount(1);
  // Existing review comment from the fixture renders as a thread.
  await expect(page.getByText("Is this constant right?")).toBeVisible();
});

test("c opens the composer; adding batches a pending card", async ({ page }) => {
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  const box = page.getByPlaceholder("Add a review comment…");
  await expect(box).toBeFocused();
  await box.fill("Tighten this up?");
  await page.getByRole("button", { name: "Add to review" }).click();
  await expect(page.getByText("Pending")).toBeVisible();
  await expect(page.getByText("Tighten this up?")).toBeVisible();
  // The submit affordance now counts the batch.
  await expect(page.getByRole("button", { name: /Submit review/ })).toContainText("1");
});

test("pending drafts survive leaving and reopening the PR", async ({ page }) => {
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  await page.getByPlaceholder("Add a review comment…").fill("Draft to keep");
  await page.getByRole("button", { name: "Add to review" }).click();
  await page.keyboard.press("Escape"); // back to inbox
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter"); // reopen
  await expect(page.getByText("Draft to keep")).toBeVisible();
});

test("text search lands on the line and seeds the comment cursor", async ({ page }) => {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Search code in this PR…");
  await expect(input).toBeFocused();
  await input.fill("gamma");
  await expect(page.locator(".qsp-row").first()).toContainText("gamma");
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-row-flash")).toHaveCount(1);
  // The cursor landed there — c comments on that exact line.
  await page.keyboard.press("c");
  await expect(page.getByPlaceholder("Add a review comment…")).toBeVisible();
});

test("info drawer: i opens with the conversation, esc closes drawer first", async ({ page }) => {
  await page.keyboard.press("i");
  await expect(page.locator(".qf-drawer")).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByText("Nice direction overall.")).toBeVisible();
  await page.keyboard.press("Escape");
  // The drawer slides off-canvas (stays in the DOM) — aria-hidden is truth.
  await expect(page.locator(".qf-drawer")).toHaveAttribute("aria-hidden", "true");
  // Still on the review, not bounced to the inbox.
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" }),
  ).toBeVisible();
});

test("y and mod+shift+c copy with toast confirmations", async ({ page }) => {
  await page.keyboard.press("y");
  const toast = page.getByRole("alert");
  await expect(toast).toContainText("Copied PR link");
  await expect(toast).toContainText("https://github.com/acme/rocket/pull/1");

  await page.keyboard.press("Control+Shift+C");
  await expect(toast).toContainText("Copied file path");
  await expect(toast).toContainText("src/lib/fuzzy.ts");
});

test("the palette lists the copy actions in review scope", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Run a command…").fill("copy");
  await expect(page.getByRole("button", { name: /Copy file path/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy PR link/ })).toBeVisible();
});

test("esc returns to the inbox", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Review requests/ })).toBeVisible();
});
