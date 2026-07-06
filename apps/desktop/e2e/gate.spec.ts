import { expect, test } from "./test";
import { setupApp } from "./bridge";

test("no accounts boots into the identity gate", async ({ page }) => {
  await setupApp(page, { hasToken: false });
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with GitLab" })).toBeVisible();
  // Fallbacks are links, not peers of the identity rows.
  await expect(page.getByRole("button", { name: "Use a token" })).toBeVisible();
});

test("self-hosted step asks exactly one question", async ({ page }) => {
  await setupApp(page, { hasToken: false });
  await page.getByRole("button", { name: "Self-hosted GitLab" }).click();
  await expect(page.getByLabel("GitLab host")).toBeFocused();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  // Esc walks back to the identity stack.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
});

test("a stored account boots into the inbox", async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("button", { name: /Review requests/ })).toBeVisible();
});

test.describe("todo", () => {
  test.fixme(true, "needs a mocked OAuth round-trip");
  test("oauth loopback captures the token and lands in the inbox", async () => {});
});
