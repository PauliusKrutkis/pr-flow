import { expect, test } from "./test";
import { setupApp } from "./bridge";
import { DETAIL, DETAIL_CHANGED, INBOX, INBOX_UPDATED } from "./fixtures";

// Viewed marks carry a content fingerprint: when the PR's head moves and a
// viewed file's diff changes underneath, the mark must drop automatically and
// say so — a transient toast plus a persistent per-file "updated" mark
// (sidebar dot + header chip) that re-viewing the file retires. The bridge
// serves DETAIL on the first load and DETAIL_CHANGED after a reload — a
// reload is the mocked stand-in for "quit, PR got a push, reopen" (viewed
// marks persist across it, like the real on-disk JSON).

test("a viewed file whose content changed is auto-unviewed on reopen, with a notice", async ({
  page,
}) => {
  await setupApp(page, { detailByLoad: [DETAIL, DETAIL_CHANGED] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  // Mark the active (first) file viewed.
  await page.keyboard.press("v");
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
  // Let the debounced persist land (400ms); the beforeunload flush is the
  // backstop, but don't race it.
  await page.waitForTimeout(600);

  // "Reopen": resumes straight into the PR; this load serves the new patch.
  await page.reload();
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  // Transient toast announces it; the per-file marks carry the state.
  await expect(page.locator(".qb-toast")).toContainText(
    "src/lib/fuzzy.ts changed since you viewed it — marked unviewed.",
  );
  await expect(page.locator(".qf-side-count")).toHaveText("0/3 viewed");
  await expect(page.locator(".qf-file-dot")).toHaveCount(1);
  await expect(page.locator(".qf-updated-chip")).toHaveCount(1);

  // Re-viewing the file acknowledges the change — the marks retire.
  await page.keyboard.press("v");
  await expect(page.locator(".qf-file-dot")).toHaveCount(0);
  await expect(page.locator(".qf-updated-chip")).toHaveCount(0);
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
});

test("an unchanged viewed file keeps its mark across reopen", async ({ page }) => {
  await setupApp(page, { detailByLoad: [DETAIL, DETAIL_CHANGED] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  // Mark the SECOND file (untouched by the "push") viewed. The file switch is
  // rAF-coalesced, so wait for it to land — a too-quick `v` would mark the
  // FIRST file (the one the push changes) and legitimately get unviewed.
  await page.keyboard.press("r"); // next file
  await expect(page.locator(".qf-file-active")).toHaveAttribute(
    "data-file-index",
    "1",
  );
  await page.keyboard.press("v");
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  // No unview, no notice — the mark survives the head move.
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
  await expect(page.locator(".qb-toast")).toHaveCount(0);
  await expect(page.locator(".qf-file-dot")).toHaveCount(0);
});

test("an inbox heartbeat that sees the PR move refreshes the open diff", async ({
  page,
}) => {
  // Same session, no reload: pr_detail serves the old diff first, the new one
  // on refetch. list_inbox is asked at boot, again when the review screen
  // mounts (staleTime 0), and a third time on the focus flip below — only
  // then does it report the newer updatedAt.
  await setupApp(page, {
    detailByCall: [DETAIL, DETAIL_CHANGED],
    inboxByCall: [INBOX, INBOX, INBOX_UPDATED],
  });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await page.keyboard.press("v");
  await expect(page.locator(".qf-side-count")).toHaveText("1/3 viewed");
  await expect(page.getByText("const two = 2;")).toHaveCount(0);

  // The heartbeat: a focus/visibility flip refetches the inbox, which now
  // reports the PR moved — the open detail must refresh right away (no 60s
  // wait), and the viewed mark on the reworked file must drop.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });

  await expect(page.getByText("const two = 2;")).toBeVisible();
  await expect(page.locator(".qb-toast")).toContainText(
    "changed since you viewed it — marked unviewed.",
  );
  await expect(page.locator(".qf-side-count")).toHaveText("0/3 viewed");
  await expect(page.locator(".qf-file-dot")).toHaveCount(1);
});

test.describe("path copy", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("clicking the file path in the diff header copies it", async ({ page }) => {
    await setupApp(page);
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

    await page.locator(".qf-fsec-copy").first().click();
    await expect(page.locator(".qf-fsec-copied")).toContainText("copied");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe("src/lib/fuzzy.ts");
  });
});
