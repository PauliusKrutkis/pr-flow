import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("resolve collapses the thread; expanding offers unresolve", async ({
  page,
}) => {
  const thread = page.locator('[data-comment-root="100"]');
  await expect(thread.getByText("Is this constant right?")).toBeVisible();

  await thread.getByRole("button", { exact: true, name: "Resolve" }).click();
  const collapsed = page.locator(".qf-thread-collapsed");
  await expect(collapsed).toBeVisible();
  await expect(collapsed).toContainText("Resolved");
  await expect(collapsed).toContainText("bob");
  await expect(collapsed).toContainText("Is this constant right?");
  await expect(page.locator(".qf-comment")).toHaveCount(0);

  await page.keyboard.press("i");
  await expect(page.locator(".qf-thread-row .qf-thread-check")).toBeVisible();
  await page.keyboard.press("Escape");

  await collapsed.click();
  await expect(thread.getByText("Is this constant right?")).toBeVisible();
  await expect(thread.locator(".qf-thread-resolved-bar")).toBeVisible();

  await thread.getByRole("button", { exact: true, name: "Unresolve" }).click();
  await expect(thread.locator(".qf-thread-resolved-bar")).toHaveCount(0);
  await expect(
    thread.getByRole("button", { exact: true, name: "Resolve" })
  ).toBeVisible();
});

test("r on a hovered thread opens its reply composer", async ({ page }) => {
  const thread = page.locator('[data-comment-root="100"]');
  await thread.hover();
  await page.keyboard.press("r");
  const box = page.getByRole("textbox", { name: "Reply…" });
  await expect(box).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(box).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" })
  ).toBeVisible();
});

test("]c focuses a thread, so r replies to it without hovering", async ({
  page,
}) => {
  await page.keyboard.press("]");
  await page.keyboard.press("c");
  await page.keyboard.press("r");
  await expect(page.getByRole("textbox", { name: "Reply…" })).toBeFocused();
});

test("r with no active thread keeps its old meaning: next file", async ({
  page,
}) => {
  await expect(
    page.locator('.qf-fsec-head.qf-fsec-active[data-file-index="0"]').first()
  ).toBeVisible();
  await page.keyboard.press("r");
  await expect(
    page.locator('.qf-fsec-head.qf-fsec-active[data-file-index="1"]').first()
  ).toBeVisible();
});

test("x resolves the hovered thread; x on the collapsed row unresolves", async ({
  page,
}) => {
  const thread = page.locator('[data-comment-root="100"]');
  await thread.hover();
  await page.keyboard.press("x");
  const collapsed = page.locator(".qf-thread-collapsed");
  await expect(collapsed).toBeVisible();

  await collapsed.hover();
  await page.keyboard.press("x");
  await expect(collapsed).toHaveCount(0);
  await expect(thread.getByText("Is this constant right?")).toBeVisible();
});

test("]c focuses a thread, so x resolves it without hovering", async ({
  page,
}) => {
  await page.keyboard.press("]");
  await page.keyboard.press("c");
  await page.keyboard.press("x");
  await expect(page.locator(".qf-thread-collapsed")).toBeVisible();
});

test("hovering a thread fades in the r/x hotkey hints on its actions", async ({
  page,
}) => {
  const thread = page.locator('[data-comment-root="100"]');
  const hints = thread.locator(".qf-thread-actions .qf-key-hint");
  await expect(hints.first()).toHaveCSS("opacity", "0");
  await thread.hover();
  await expect(hints.first()).toHaveCSS("opacity", "1");
  await expect(thread.locator(".qf-thread-actions .q-kbd")).toHaveText([
    "R",
    "X",
  ]);
});

test("suggestion fences render as a card; copy puts the lines on the clipboard", async ({
  page,
}) => {
  const card = page.locator(".md-suggestion");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Suggested change");
  await expect(card.locator(".md-suggestion-line")).toHaveText("  return 3;");
  await expect(page.getByText("How about:")).toBeVisible();

  await card.getByRole("button", { exact: true, name: "Copy" }).click();
  await expect(card.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "  return 3;"
  );
});

test("insert suggestion prefills the block with the commented line", async ({
  page,
}) => {
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  const box = page.getByRole("textbox", { name: "Add a review comment…" });
  await expect(box).toBeFocused();
  await page.getByRole("button", { name: "Insert suggestion" }).click();
  const sugg = box.locator("pre code.language-suggestion");
  await expect(sugg).toHaveText("export function alpha() {");
  await expect(box).toBeFocused();
  await page.keyboard.type("export function alpha(): number {");
  await expect(sugg).toHaveText("export function alpha(): number {");
});
