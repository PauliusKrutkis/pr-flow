import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";
import type { Page } from "./types.ts";

/**
 * The rich composer: a WYSIWYG surface that submits markdown. ⌘B/⌘I/⌘E
 * toggle real formatting (no symbols on the surface), ⌘K links the selection
 * through an inline url input, markdown typing shortcuts autoconvert, and the
 * suggestion block round-trips to the ```suggestion fence both hosts apply.
 */

function box(page: Page) {
  return page.getByRole("textbox", { name: "Add a review comment…" });
}

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  await expect(box(page)).toBeFocused();
});

test("mod+b bolds the selection for real — no symbols on the surface", async ({
  page,
}) => {
  const ed = box(page);
  await page.keyboard.type("make this bold");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await expect(ed.locator("strong")).toHaveText("make this bold");
  await expect(ed).not.toContainText("**");
  await expect(page.getByRole("button", { name: "Bold" })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
});

test("markdown typing shortcuts still resolve — muscle memory keeps working", async ({
  page,
}) => {
  const ed = box(page);
  await page.keyboard.type("**bold** and *italic* prose");
  await expect(ed.locator("strong")).toHaveText("bold");
  await expect(ed.locator("em")).toHaveText("italic");
  await expect(ed).not.toContainText("*");
});

test("mod+k links the selection via the inline url input", async ({ page }) => {
  const ed = box(page);
  await page.keyboard.type("docs");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+k");
  await expect(page.locator(".qc-input")).toHaveCount(0);
  const url = page.getByLabel("Link URL");
  await expect(url).toBeFocused();
  await url.fill("https://example.com");
  await page.keyboard.press("Enter");
  await expect(ed.locator('a[href="https://example.com"]')).toHaveText("docs");
});

test("rich text serializes to markdown on submit — bold survives the wire", async ({
  page,
}) => {
  await page.keyboard.type("ship it");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  await page.keyboard.press("Control+Enter"); // batch: "Add to review"
  await expect(page.getByText("Pending")).toBeVisible();
  await expect(page.locator(".qf-pending strong")).toHaveText("ship it");
});

test("the suggestion block round-trips: insert, edit in place, pending card", async ({
  page,
}) => {
  const ed = box(page);
  await page.getByRole("button", { name: "Insert suggestion" }).click();
  const sugg = ed.locator("pre code.language-suggestion");
  await expect(sugg).toHaveText("export function alpha() {");
  await expect(ed).toBeFocused();
  await page.keyboard.type("export function alpha(): number {");
  await expect(sugg).toHaveText("export function alpha(): number {");
  await page.keyboard.press("Control+Enter");
  await expect(page.getByText("Pending")).toBeVisible();
  await expect(page.locator(".qf-pending .md-suggestion-line")).toHaveText(
    "export function alpha(): number {"
  );
});

test("mod+shift+g inserts the suggestion block from the keyboard", async ({
  page,
}) => {
  const ed = box(page);
  await page.keyboard.press("Control+Shift+g");
  const sugg = ed.locator("pre code.language-suggestion");
  await expect(sugg).toHaveText("export function alpha() {");
  await expect(ed).toBeFocused();
  await page.keyboard.type("export function alpha(): number {");
  await expect(sugg).toHaveText("export function alpha(): number {");
});

test("esc backs out of the composer without leaving the review", async ({
  page,
}) => {
  await page.keyboard.type("draft");
  await page.keyboard.press("Escape");
  await expect(box(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" })
  ).toBeVisible();
});

test("tab still flips the batch/now mode from inside the editor", async ({
  page,
}) => {
  await page.keyboard.type("x");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("radio", { name: "Comment now" })
  ).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("radio", { name: "Add to review" })
  ).toHaveAttribute("aria-checked", "true");
});
