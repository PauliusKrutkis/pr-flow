import type { Locator } from "@playwright/test";
import { expect, test } from "./test";
import { setupApp } from "./bridge";

// The composer's hint-bar toolbar: markdown formatting rides hotkeys (⌘B/⌘I/
// ⌘K), the buttons run the same actions, and ⌘⇧P previews the rendered
// markdown in place — the textarea stays mounted and focused throughout.

/** The text currently selected inside the composer textarea. */
function selectedText(box: Locator) {
  return box.evaluate((el) => {
    const ta = el as HTMLTextAreaElement;
    return ta.value.slice(ta.selectionStart, ta.selectionEnd);
  });
}

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
  // Open the line composer on the first visible row of fuzzy.ts.
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  await expect(page.getByPlaceholder("Add a review comment…")).toBeFocused();
});

test("mod+b wraps the selection in bold and keeps it selected", async ({ page }) => {
  const box = page.getByPlaceholder("Add a review comment…");
  await page.keyboard.type("make this bold");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await expect(box).toHaveValue("**make this bold**");
  // The inner text stays selected, so stacking a second style just works.
  await expect.poll(() => selectedText(box)).toBe("make this bold");
  await page.keyboard.press("Control+i");
  await expect(box).toHaveValue("**_make this bold_**");
});

test("mod+k links the selection and aims the caret at the url placeholder", async ({ page }) => {
  const box = page.getByPlaceholder("Add a review comment…");
  await page.keyboard.type("docs");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+k");
  await expect(box).toHaveValue("[docs](url)");
  // ⌘K stays in the composer — the command palette must NOT have opened.
  await expect(page.locator(".qc-input")).toHaveCount(0);
  // The placeholder is selected: typing replaces it with the real url.
  await expect.poll(() => selectedText(box)).toBe("url");
  await page.keyboard.type("https://example.com");
  await expect(box).toHaveValue("[docs](https://example.com)");
});

test("mod+shift+p previews the rendered markdown in place, and back", async ({ page }) => {
  const box = page.getByPlaceholder("Add a review comment…");
  await page.keyboard.type("**bold** and `code`");
  await page.keyboard.press("Control+Shift+p");
  const pane = page.locator(".qa-preview");
  await expect(pane).toBeVisible();
  await expect(pane.locator("strong")).toHaveText("bold");
  await expect(pane.locator("code")).toHaveText("code");
  // The textarea keeps focus behind the pane — typing lands in the comment
  // and the preview re-renders live.
  await page.keyboard.type(" and more");
  await expect(pane).toContainText("and more");
  // Toggle back: the textarea returns, text intact, still focused.
  await page.keyboard.press("Control+Shift+p");
  await expect(pane).toHaveCount(0);
  await expect(box).toHaveValue("**bold** and `code` and more");
  await expect(box).toBeFocused();
});

test("Esc cancels the composer from preview mode", async ({ page }) => {
  await page.keyboard.type("draft");
  await page.keyboard.press("Control+Shift+p");
  await expect(page.locator(".qa-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Add a review comment…")).toHaveCount(0);
});

test("the hint-bar buttons mirror the hotkeys", async ({ page }) => {
  const box = page.getByPlaceholder("Add a review comment…");
  await page.keyboard.type("quiet");
  await page.keyboard.press("Control+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(box).toHaveValue("**quiet**");
  const previewBtn = page.getByRole("button", { name: "Preview", exact: true });
  await previewBtn.click();
  await expect(previewBtn).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".qa-preview strong")).toHaveText("quiet");
});
