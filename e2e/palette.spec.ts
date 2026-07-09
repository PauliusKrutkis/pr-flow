import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

const ARCHIVE_UNTIL_IT_UPDATES = /Archive until it updates/;
const WATCHING = /Watching/;

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
});

test("mod+k opens; fuzzy filters; esc closes", async ({ page }) => {
  await page.keyboard.press("Control+k");
  const input = page.getByPlaceholder("Run a command…");
  await expect(input).toBeFocused();
  await input.fill("arch");
  await expect(
    page.getByRole("button", { name: ARCHIVE_UNTIL_IT_UPDATES })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(input).not.toBeVisible();
});

test("running a command acts on the app", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Run a command…").fill("watching");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: WATCHING })).toHaveAttribute(
    "data-state",
    "active"
  );
});

test("? shows the scope-aware cheatsheet", async ({ page }) => {
  await page.keyboard.press("Shift+Slash");
  await expect(page.locator(".qh-panel")).toBeVisible();
  await expect(page.getByText("Archive until it updates")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".qh-panel")).not.toBeVisible();
});
