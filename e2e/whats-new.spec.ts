import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

const WHATS_NEW = /What's new/;

const RELEASES = [
  {
    notes: "Sharper diffs and a calmer inbox.",
    publishedAt: "2026-07-06T12:00:00Z",
    tag: "v1.4.0",
  },
  {
    notes: "Faster startup.",
    publishedAt: "2026-07-01T12:00:00Z",
    tag: "v1.3.0",
  },
  { notes: "Old news.", publishedAt: "2026-06-20T12:00:00Z", tag: "v1.2.0" },
];

test("after an update, the first launch shows every skipped release", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("pr-flow:lastRunVersion", "1.2.0");
  });
  await setupApp(page, { appVersion: "1.4.0", releases: RELEASES });

  const card = page.getByRole("status").filter({ hasText: WHATS_NEW });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1.4.0");
  await expect(card).toContainText("Sharper diffs and a calmer inbox.");
  await expect(card).toContainText("Faster startup.");
  await expect(card).not.toContainText("Old news.");

  // the version is acknowledged by "Got it", not by merely rendering
  const before = await page.evaluate(() =>
    localStorage.getItem("pr-flow:lastRunVersion")
  );
  expect(before).toBe("1.2.0");

  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);

  const stored = await page.evaluate(() =>
    localStorage.getItem("pr-flow:lastRunVersion")
  );
  expect(stored).toBe("1.4.0");
});

test("a fresh install shows no what's-new card", async ({ page }) => {
  await setupApp(page, { appVersion: "1.4.0", releases: RELEASES });
  await expect(page.getByRole("option").first()).toBeVisible();
  await expect(page.getByText(WHATS_NEW)).toHaveCount(0);
});
