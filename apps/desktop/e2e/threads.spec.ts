import { expect, test } from "@playwright/test";
import { setupApp } from "./bridge";

// Thread-level features: resolve/unresolve, the `r` reply shortcut, and
// ```suggestion cards. The fixture thread is root #100 (bob) + reply #101
// (carol, carrying a suggestion fence), threadId "T100", on fuzzy.ts:2.

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("resolve collapses the thread; expanding offers unresolve", async ({ page }) => {
  const thread = page.locator('[data-comment-root="100"]');
  await expect(thread.getByText("Is this constant right?")).toBeVisible();

  // Resolve — optimistic: the thread collapses to a single quiet row (and the
  // bridge persists the flip, so the settling refetch agrees).
  await thread.getByRole("button", { name: "Resolve", exact: true }).click();
  const collapsed = page.locator(".qf-thread-collapsed");
  await expect(collapsed).toBeVisible();
  await expect(collapsed).toContainText("Resolved");
  await expect(collapsed).toContainText("bob");
  await expect(collapsed).toContainText("Is this constant right?");
  // The full comment body is out of the way.
  await expect(page.locator(".qf-comment")).toHaveCount(0);

  // The info drawer's code-discussion row now wears the resolved check.
  await page.keyboard.press("i");
  await expect(page.locator(".qf-thread-row .qf-thread-check")).toBeVisible();
  await page.keyboard.press("Escape");

  // Click to expand: the conversation returns under a "Resolved" strip.
  await collapsed.click();
  await expect(thread.getByText("Is this constant right?")).toBeVisible();
  await expect(thread.locator(".qf-thread-resolved-bar")).toBeVisible();

  // Unresolve restores the normal thread.
  await thread.getByRole("button", { name: "Unresolve", exact: true }).click();
  await expect(thread.locator(".qf-thread-resolved-bar")).toHaveCount(0);
  await expect(
    thread.getByRole("button", { name: "Resolve", exact: true }),
  ).toBeVisible();
});

test("r on a hovered thread opens its reply composer", async ({ page }) => {
  const thread = page.locator('[data-comment-root="100"]');
  await thread.hover();
  await page.keyboard.press("r");
  const box = page.getByPlaceholder("Reply…");
  await expect(box).toBeFocused();
  // Esc backs out of the composer without leaving the review.
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" }),
  ).toBeVisible();
});

test("]c focuses a thread, so r replies to it without hovering", async ({ page }) => {
  await page.keyboard.press("]");
  await page.keyboard.press("c");
  await page.keyboard.press("r");
  await expect(page.getByPlaceholder("Reply…")).toBeFocused();
});

test("r with no active thread keeps its old meaning: next file", async ({ page }) => {
  await expect(page.locator(".qf-fsec").nth(0)).toHaveClass(/qf-fsec-active/);
  await page.keyboard.press("r");
  await expect(page.locator(".qf-fsec").nth(1)).toHaveClass(/qf-fsec-active/);
});

test("suggestion fences render as a card; copy puts the lines on the clipboard", async ({ page }) => {
  const card = page.locator(".md-suggestion");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Suggested change");
  await expect(card.locator(".md-suggestion-line")).toHaveText("  return 3;");
  // The prose around the fence renders as ordinary markdown.
  await expect(page.getByText("How about:")).toBeVisible();

  await card.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "  return 3;",
  );
});

test("insert suggestion prefills the fence with the commented line", async ({ page }) => {
  // j reveals the cursor on the first visible line of fuzzy.ts, c comments.
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  const box = page.getByPlaceholder("Add a review comment…");
  await expect(box).toBeFocused();
  await page.getByRole("button", { name: "Insert suggestion" }).click();
  await expect(box).toHaveValue(
    "```suggestion\nexport function alpha() {\n```\n",
  );
  // The prefilled line is selected — typing replaces it in place.
  await page.keyboard.type("export function alpha(): number {");
  await expect(box).toHaveValue(
    "```suggestion\nexport function alpha(): number {\n```\n",
  );
});
