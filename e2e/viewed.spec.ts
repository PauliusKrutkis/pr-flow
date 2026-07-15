import { setupApp } from "./bridge.ts";
import { DETAIL, DETAIL_CHANGED, INBOX, INBOX_UPDATED } from "./fixtures.ts";
import { expect, test } from "./test.ts";

test("a viewed file whose content changed is auto-unviewed on reopen, with a notice", async ({
  page,
}) => {
  await setupApp(page, { detailByLoad: [DETAIL, DETAIL_CHANGED] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await page.keyboard.press("v");
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await expect(page.locator(".qb-toast")).toContainText(
    "src/lib/fuzzy.ts changed since you viewed it — marked unviewed."
  );
  await expect(page.locator(".qf-side-count")).toHaveText("0/3 viewed");
  await expect(page.locator(".qf-file-dot")).toHaveCount(1);
  await expect(page.locator(".qf-updated-chip")).toHaveCount(1);

  await page.keyboard.press("v");
  await expect(page.locator(".qf-file-dot")).toHaveCount(0);
  await expect(page.locator(".qf-updated-chip")).toHaveCount(0);
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
});

test("an unchanged viewed file keeps its mark across reopen", async ({
  page,
}) => {
  await setupApp(page, { detailByLoad: [DETAIL, DETAIL_CHANGED] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await page.keyboard.press("r"); // next file
  await expect(page.locator(".qf-file-active")).toHaveAttribute(
    "data-file-index",
    "1"
  );
  await page.keyboard.press("v");
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
  await expect(page.locator(".qb-toast")).toHaveCount(0);
  await expect(page.locator(".qf-file-dot")).toHaveCount(0);
});

test("an inbox heartbeat that sees the PR move refreshes the open diff", async ({
  page,
}) => {
  await setupApp(page, {
    detailByCall: [DETAIL, DETAIL_CHANGED],
    inboxByCall: [INBOX, INBOX, INBOX_UPDATED],
  });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await page.keyboard.press("v");
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
  await expect(page.getByText("const two = 2;")).toHaveCount(0);

  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await expect(page.getByText("const two = 2;")).toBeVisible();
  await expect(page.locator(".qb-toast")).toContainText(
    "changed since you viewed it — marked unviewed."
  );
  await expect(page.locator(".qf-side-count")).toHaveText("0/3 viewed");
  await expect(page.locator(".qf-file-dot")).toHaveCount(1);
});

test("e skips files already viewed when advancing", async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  // Mark the middle file (index 1) viewed first, then start from the top.
  await page.keyboard.press("r"); // to file 1
  await expect(page.locator(".qf-file-active")).toHaveAttribute(
    "data-file-index",
    "1"
  );
  await page.keyboard.press("v");
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");

  await page.keyboard.press("t"); // previous file, back to file 0
  await expect(page.locator(".qf-file-active")).toHaveAttribute(
    "data-file-index",
    "0"
  );

  // e on file 0 marks it viewed and jumps past the already-viewed file 1
  // straight to file 2.
  await page.keyboard.press("e");
  await expect(page.locator(".qf-file-active")).toHaveAttribute(
    "data-file-index",
    "2"
  );
  await expect(page.locator(".qf-side-count")).toHaveText("2/3 viewed");
});

test.describe("path copy", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("clicking the file path in the diff header copies it", async ({
    page,
  }) => {
    await setupApp(page);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

    await page.locator(".qf-fsec-copy").first().click();
    await expect(page.locator(".qf-fsec-copied")).toContainText("copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe("src/lib/fuzzy.ts");
  });
});
