import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

const REVIEW_REQUESTS = /Review requests/;

test("no accounts boots into the identity gate", async ({ page }) => {
  await setupApp(page, { hasToken: false });
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Continue with GitLab" })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Use a token" })).toBeVisible();
});

test("self-hosted step asks exactly one question", async ({ page }) => {
  await setupApp(page, { hasToken: false });
  await page.getByRole("button", { name: "Self-hosted GitLab" }).click();
  await expect(page.getByLabel("GitLab host")).toBeFocused();
  await expect(page.getByRole("button", { name: "Continue" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Continue with GitHub" })
  ).toBeVisible();
});

test("a stored account boots into the inbox", async ({ page }) => {
  await setupApp(page);
  await expect(
    page.getByRole("button", { name: REVIEW_REQUESTS })
  ).toBeVisible();
});

test.describe("todo", () => {
  // biome-ignore lint/suspicious/noSkippedTests: OAuth round-trip needs mocking infrastructure
  test.fixme("oauth loopback captures the token and lands in the inbox", async () => {
    /* fixme: needs a mocked OAuth round-trip */
  });
});
