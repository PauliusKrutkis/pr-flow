import { expect, test } from "@playwright/test";
import { setupApp } from "./bridge";

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  // The heading paints in the cold-cache skeleton — wait for the DIFF, which
  // is what the keyboard talks to.
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("continuous scroll: both files render with sticky headers", async ({ page }) => {
  await expect(page.locator(".qf-fsec")).toHaveCount(2);
  await expect(page.locator(".qf-fsec-head").nth(0)).toContainText("fuzzy.ts");
  await expect(page.locator(".qf-fsec-head").nth(1)).toContainText("search.ts");
});

test("j moves the line cursor; sidebar follows the cursor's file", async ({ page }) => {
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-active")).toHaveCount(1);
  // Existing review comment from the fixture renders as a thread (scoped to
  // the diff — the info drawer also lists it as a code-discussion row).
  await expect(
    page.locator(".js-comment").getByText("Is this constant right?"),
  ).toBeVisible();
});

test("c opens the composer; adding batches a pending card", async ({ page }) => {
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  const box = page.getByPlaceholder("Add a review comment…");
  await expect(box).toBeFocused();
  await box.fill("Tighten this up?");
  await page.getByRole("button", { name: "Add to review" }).click();
  await expect(page.getByText("Pending")).toBeVisible();
  await expect(page.getByText("Tighten this up?")).toBeVisible();
  // The submit affordance now counts the batch.
  await expect(page.getByRole("button", { name: /Submit review/ })).toContainText("1");
});

test("pending drafts survive leaving and reopening the PR", async ({ page }) => {
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  await page.getByPlaceholder("Add a review comment…").fill("Draft to keep");
  await page.getByRole("button", { name: "Add to review" }).click();
  await page.keyboard.press("Escape"); // back to inbox
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter"); // reopen
  await expect(page.getByText("Draft to keep")).toBeVisible();
});

test("text search lands on the line and seeds the comment cursor", async ({ page }) => {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Search code in this PR…");
  await expect(input).toBeFocused();
  await input.fill("gamma");
  await expect(page.locator(".qsp-row").first()).toContainText("gamma");
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-row-flash")).toHaveCount(1);
  // The cursor landed there — c comments on that exact line.
  await page.keyboard.press("c");
  await expect(page.getByPlaceholder("Add a review comment…")).toBeVisible();
});

test("info drawer: i opens with the conversation, esc closes drawer first", async ({ page }) => {
  await page.keyboard.press("i");
  await expect(page.locator(".qf-drawer")).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByText("Nice direction overall.")).toBeVisible();
  await page.keyboard.press("Escape");
  // The drawer slides off-canvas (stays in the DOM) — aria-hidden is truth.
  await expect(page.locator(".qf-drawer")).toHaveAttribute("aria-hidden", "true");
  // Still on the review, not bounced to the inbox.
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" }),
  ).toBeVisible();
});

test("esc returns to the inbox", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Review requests/ })).toBeVisible();
});

test("info timeline: review verdicts interleave with comments, oldest first", async ({ page }) => {
  await page.keyboard.press("i");
  const drawer = page.locator(".qf-drawer");
  await expect(drawer.getByText("LGTM, ship it.")).toBeVisible();
  await expect(drawer.locator(".q-pill-approved")).toHaveText("Approved");
  // Chronology: carol commented (08:00) before dave's approval (09:00).
  const items = drawer.locator(".qf-convo-item");
  await expect(items.nth(0)).toContainText("carol");
  await expect(items.nth(1)).toContainText("dave");
});

test("info code discussion lists inline threads; a row jumps to the diff", async ({ page }) => {
  await page.keyboard.press("i");
  const row = page.locator(".qf-thread-row");
  await expect(row).toContainText("src/lib/fuzzy.ts");
  await expect(row).toContainText(":2");
  await expect(row).toContainText("Is this constant right?");
  await row.click();
  // The drawer closes and the thread is centered + flashed in the diff.
  await expect(page.locator(".qf-drawer")).toHaveAttribute("aria-hidden", "true");
  const thread = page.locator('[data-comment-root="100"]');
  await expect(thread).toBeVisible();
  await expect(thread).toHaveClass(/qf-row-flash/);
});

test("the i button advertises how much conversation the drawer holds", async ({ page }) => {
  // 1 issue comment + 1 review with a body + 1 inline thread root.
  await expect(page.locator(".qf-info-count")).toHaveText("3");
});

test("esc in the drawer composer closes the drawer and releases the keyboard", async ({ page }) => {
  await page.keyboard.press("i");
  const box = page.getByPlaceholder("Comment on this pull request…");
  await box.click();
  await box.fill("half-typed thought");
  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-drawer")).toHaveAttribute("aria-hidden", "true");
  // Still on the review, not bounced to the inbox.
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" }),
  ).toBeVisible();
  // Focus left the hidden textarea — single-key shortcuts fire immediately.
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-active")).toHaveCount(1);
});

test("after esc-closing from the composer, i reopens the drawer", async ({ page }) => {
  await page.keyboard.press("i");
  await page.getByPlaceholder("Comment on this pull request…").click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-drawer")).toHaveAttribute("aria-hidden", "true");
  await page.keyboard.press("i");
  await expect(page.locator(".qf-drawer")).toHaveAttribute("aria-hidden", "false");
});

test("comment posting is optimistic even when the network hangs", async ({ page }) => {
  // Rebuild the bridge with create_issue_comment that never resolves. The
  // reload resumes straight into the PR we were reviewing.
  await setupApp(page, { hangIssueComment: true });
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
  await page.keyboard.press("i");
  const box = page.getByPlaceholder("Comment on this pull request…");
  await box.click();
  await box.fill("Ship it when green");
  await page.keyboard.press("Control+Enter");
  // The comment lands in the timeline instantly (the request is still pending)…
  await expect(
    page.locator(".qf-convo").getByText("Ship it when green"),
  ).toBeVisible({ timeout: 1000 });
  // …and the composer cleared, ready for the next thought.
  await expect(box).toHaveValue("");
});
