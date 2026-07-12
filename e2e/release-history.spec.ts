import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

const WHATS_NEW = /What's new/;

const RELEASES = [
  {
    notes: "Sharper diffs.",
    publishedAt: "2026-07-06T12:00:00Z",
    tag: "v1.4.0",
  },
  {
    notes: "Faster startup.",
    publishedAt: "2026-07-01T12:00:00Z",
    tag: "v1.3.0",
  },
];

test("the palette opens the release history with the current version marked", async ({
  page,
}) => {
  await setupApp(page, { appVersion: "1.4.0", releases: RELEASES });
  await expect(page.getByRole("option").first()).toBeVisible();

  await page.keyboard.press("ControlOrMeta+k");
  await page.getByRole("combobox").fill("release history");
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "Release history" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("v1.4.0");
  await expect(dialog).toContainText("current");
  await expect(dialog).toContainText("Sharper diffs.");
  await expect(dialog).toContainText("v1.3.0");
  await expect(dialog).toContainText("Faster startup.");

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the what's-new card links to all releases", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("pr-flow:lastRunVersion", "1.3.0");
  });
  await setupApp(page, { appVersion: "1.4.0", releases: RELEASES });

  const card = page.getByRole("status").filter({ hasText: WHATS_NEW });
  await card.getByRole("button", { name: "All releases" }).click();

  await expect(
    page.getByRole("dialog", { name: "Release history" })
  ).toBeVisible();
});
