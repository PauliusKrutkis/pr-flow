import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

const WHATS_NEW = /What's new/;

test("after an update, the first launch shows what's new", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pr-flow:lastRunVersion", "1.3.0");
  });
  await setupApp(page, {
    appVersion: "1.4.0",
    releaseNotes: "Sharper diffs and a calmer inbox.",
  });

  const card = page.getByRole("status").filter({ hasText: WHATS_NEW });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1.4.0");
  await expect(card).toContainText("Sharper diffs and a calmer inbox.");

  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);

  const stored = await page.evaluate(() =>
    localStorage.getItem("pr-flow:lastRunVersion")
  );
  expect(stored).toBe("1.4.0");
});

test("a fresh install shows no what's-new card", async ({ page }) => {
  await setupApp(page, { appVersion: "1.4.0", releaseNotes: "unused" });
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(page.getByText(WHATS_NEW)).toHaveCount(0);
});
