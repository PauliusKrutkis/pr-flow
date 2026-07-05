import { expect, test } from "./test";
import { setupApp } from "./bridge";

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  // The heading paints in the cold-cache skeleton — wait for the DIFF, which
  // is what the keyboard talks to.
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("continuous scroll: all files render with sticky headers", async ({ page }) => {
  await expect(page.locator(".qf-fsec")).toHaveCount(3);
  await expect(page.locator(".qf-fsec-head").nth(0)).toContainText("fuzzy.ts");
  await expect(page.locator(".qf-fsec-head").nth(1)).toContainText("search.ts");
  await expect(page.locator(".qf-fsec-head").nth(2)).toContainText("retry.ts");
});

test("j moves the line cursor; sidebar follows the cursor's file", async ({ page }) => {
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-active")).toHaveCount(1);
  // Existing review comment from the fixture renders as a thread.
  await expect(page.getByText("Is this constant right?")).toBeVisible();
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

test("text search (mod+r) lands on the line and seeds the comment cursor", async ({ page }) => {
  await page.keyboard.press("Control+r");
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

test("find bar: mod+f opens it, typing counts, Enter steps and wraps", async ({ page }) => {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Find in diff");
  await expect(input).toBeFocused();

  // "return" hits twice in fuzzy.ts (the -/+ pair) and once in search.ts.
  await input.fill("return");
  const count = page.locator(".qf-findbar-count");
  await expect(count).toHaveText("1/3");
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(3);

  // First Enter jumps to the CURRENT match (1/3, in the first file) — the row
  // flashes and the current mark singles out that occurrence.
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1/3");
  await expect(page.locator(".qf-fsec").nth(0).locator(".qf-row-flash")).toHaveCount(1);
  await expect(page.locator("mark.qf-find-current")).toHaveCount(1);
  await expect(page.locator(".qf-fsec").nth(0).locator("mark.qf-find-current")).toHaveCount(1);

  // Subsequent Enters advance; the third match lives in the second file.
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("2/3");
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("3/3");
  await expect(page.locator(".qf-fsec").nth(1).locator("mark.qf-find-current")).toHaveCount(1);

  // Wraps forward past the end, and Shift+Enter wraps backward.
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1/3");
  await page.keyboard.press("Shift+Enter");
  await expect(count).toHaveText("3/3");
});

test("resume: reopening paints the spot you left — no visible jump after", async ({ page }) => {
  // Land on the third file and scroll a little way into it.
  await page.keyboard.press("r");
  await page.keyboard.press("r");
  await expect(page.locator(".qf-fsec").nth(2).locator(".qf-diff")).toBeVisible();
  await page.evaluate(() => {
    document.querySelector(".qf-scrollhost")!.scrollTop += 120;
  });
  // Let the debounced review-memory write flush before "quitting".
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.locator(".qf-diff").first()).toBeVisible();

  // The resumed spot is ALREADY on screen: ~120px into file 3's section
  // (restored pre-paint — the old post-paint scrollIntoView painted the top
  // of the PR first and then visibly jumped there).
  const delta = await page.evaluate(() => {
    const host = document.querySelector(".qf-scrollhost")!;
    const sec = document.querySelectorAll(".qf-fsec")[2];
    return host.getBoundingClientRect().top - sec.getBoundingClientRect().top;
  });
  expect(Math.abs(delta - 120)).toBeLessThan(40);

  // …and it STAYS there while the idle pre-mounter fills in sections above
  // (scroll anchoring keeps the view pinned as their estimated heights turn
  // real). A drifting view here is the "scrolls to some visible place" bug.
  await page.waitForTimeout(900);
  const delta2 = await page.evaluate(() => {
    const host = document.querySelector(".qf-scrollhost")!;
    const sec = document.querySelectorAll(".qf-fsec")[2];
    return host.getBoundingClientRect().top - sec.getBoundingClientRect().top;
  });
  expect(Math.abs(delta2 - delta)).toBeLessThan(24);
});

test("find seeds from the viewport: the current match is the one near you, not the top", async ({ page }) => {
  // r jumps to search.ts — fuzzy.ts (matches 1 and 2) is now behind us.
  await page.keyboard.press("r");
  await expect(page.locator(".qf-fsec").nth(1).locator(".qf-diff")).toBeVisible();

  await page.keyboard.press("Control+f");
  await page.getByPlaceholder("Find in diff").fill("return");
  const count = page.locator(".qf-findbar-count");
  // The current match is the first one at/after the viewport — search.ts's,
  // i.e. #3 — while all three still mark and count.
  await expect(count).toHaveText("3/3");
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(3);

  // First Enter lands on THAT match, in the second file.
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("3/3");
  await expect(page.locator(".qf-fsec").nth(1).locator(".qf-row-flash")).toHaveCount(1);

  // Stepping on wraps around to the top of the PR.
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1/3");
});

test("find bar: Esc closes, clears marks, and j moves the cursor immediately", async ({ page }) => {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Find in diff");
  await input.fill("gamma");
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/2");

  // The jump lands in search.ts (the only file mentioning gamma).
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec").nth(1).locator(".qf-row-flash")).toHaveCount(1);

  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-findbar")).toHaveCount(0);
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(0);
  // Focus fell back to the document — j drives the line cursor right away.
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-active")).toHaveCount(1);
});

test("find bar: reopening keeps the query selected; typing replaces it", async ({ page }) => {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Find in diff");
  await input.fill("gamma");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  // The kept query is preselected, so typing replaces it wholesale.
  await expect(page.getByPlaceholder("Find in diff")).toBeFocused();
  await page.keyboard.type("beta");
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/1");
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

test("y and mod+shift+c copy with toast confirmations", async ({ page }) => {
  await page.keyboard.press("y");
  const toast = page.getByRole("alert");
  await expect(toast).toContainText("Copied PR link");
  await expect(toast).toContainText("https://github.com/acme/rocket/pull/1");

  await page.keyboard.press("Control+Shift+C");
  await expect(toast).toContainText("Copied file path");
  await expect(toast).toContainText("src/lib/fuzzy.ts");
});

test("the palette lists the copy actions in review scope", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Run a command…").fill("copy");
  await expect(page.getByRole("button", { name: /Copy file path/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy PR link/ })).toBeVisible();
});

test("esc returns to the inbox", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Review requests/ })).toBeVisible();
});
