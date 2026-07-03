import { expect, test } from "@playwright/test";
import { setupApp } from "./bridge";
import { DETAIL, DETAIL_CHANGED } from "./fixtures";

// Viewed marks carry a content fingerprint: when the PR's head moves and a
// viewed file's diff changes underneath, the mark must drop automatically and
// say so. The bridge serves DETAIL on the first load and DETAIL_CHANGED after
// a reload — a reload is the mocked stand-in for "quit, PR got a push, reopen"
// (viewed marks persist across it, like the real on-disk JSON).

test("a viewed file whose content changed is auto-unviewed on reopen, with a notice", async ({
  page,
}) => {
  await setupApp(page, { detailByLoad: [DETAIL, DETAIL_CHANGED] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  // Mark the active (first) file viewed.
  await page.keyboard.press("v");
  await expect(page.locator(".qf-side-count")).toHaveText("1/2 viewed");
  // Let the debounced persist land (400ms); the beforeunload flush is the
  // backstop, but don't race it.
  await page.waitForTimeout(600);

  // "Reopen": resumes straight into the PR; this load serves the new patch.
  await page.reload();
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await expect(page.locator(".qb-banner")).toContainText(
    "1 viewed file changed — marked unviewed.",
  );
  await expect(page.locator(".qf-side-count")).toHaveText("0/2 viewed");
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
  await expect(page.locator(".qf-side-count")).toHaveText("1/2 viewed");
  await page.waitForTimeout(600);

  await page.reload();
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  // No unview, no notice — the mark survives the head move.
  await expect(page.locator(".qf-side-count")).toHaveText("1/2 viewed");
  await expect(page.locator(".qb-banner")).toHaveCount(0);
});
