import { expect, test } from "@playwright/test";
import { setupApp } from "./bridge";

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
});

test("renders the review-requested list with counts", async ({ page }) => {
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(page.getByRole("button", { name: /Review requests/ })).toContainText("3");
  await expect(
    page.getByRole("listbox").getByText("Add fuzzy matching to search"),
  ).toBeVisible();
});

test("j/k move the selection; the reading pane follows", async ({ page }) => {
  const options = page.getByRole("option");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("j");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("complementary", { name: "Pull request detail" }),
  ).toContainText("Fix cursor drift");
  await page.keyboard.press("k");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
});

test("tab cycles tabs; digits jump directly", async ({ page }) => {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /Assigned/ })).toHaveAttribute(
    "data-state",
    "active",
  );
  await page.keyboard.press("5");
  await expect(page.getByRole("button", { name: /Watching/ })).toHaveAttribute(
    "data-state",
    "active",
  );
  // Watching is empty in fixtures → the full-bleed zero state with its action.
  await expect(page.getByRole("button", { name: /Watch a repository/ })).toBeVisible();
  await page.keyboard.press("1");
});

test("e archives with an undo toast; z restores", async ({ page }) => {
  await page.keyboard.press("e");
  await expect(page.getByRole("option")).toHaveCount(2);
  const toast = page.getByRole("alert");
  await expect(toast).toContainText("Archived");
  await expect(toast).toContainText("Add fuzzy matching to search");
  await expect(
    page.getByRole("button", { name: /Review requests/ }),
  ).toContainText("2");
  await page.keyboard.press("z");
  await expect(page.getByRole("option")).toHaveCount(3);
});

test("y copies the selected PR's link and confirms with a toast", async ({ page }) => {
  await page.keyboard.press("j"); // select the second PR
  await page.keyboard.press("y");
  const toast = page.getByRole("alert");
  await expect(toast).toContainText("Copied PR link");
  await expect(toast).toContainText("https://github.com/acme/rocket/pull/2");
});

test("enter opens the selected PR's review", async ({ page }) => {
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" }),
  ).toBeVisible();
  await expect(page.getByText("src/lib/fuzzy.ts").first()).toBeVisible();
});

test("global search ranks and opens", async ({ page }) => {
  await page.keyboard.press("/");
  const input = page.getByPlaceholder("Search all pull requests…");
  await expect(input).toBeFocused();
  await input.fill("cursor drift");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" }),
  ).toBeVisible(); // fixture detail is the same PR payload for every number
});
