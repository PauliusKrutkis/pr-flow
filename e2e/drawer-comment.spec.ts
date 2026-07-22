import { setupApp } from "./bridge.ts";
import { DETAIL_WITH_OWN_COMMENT } from "./fixtures.ts";
import { expect, test } from "./test.ts";

test.beforeEach(async ({ page }) => {
  await setupApp(page, { detail: DETAIL_WITH_OWN_COMMENT });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
  await page.keyboard.press("i");
  await expect(page.getByText("Deploying to staging first.")).toBeVisible();
});

test("edit and delete show only on your own conversation comments", async ({
  page,
}) => {
  const items = page.locator(".qf-convo-item");
  const mine = items.filter({ hasText: "Deploying to staging first." });
  const theirs = items.filter({ hasText: "Nice direction overall." });

  await expect(
    mine.getByRole("button", { name: "Edit comment" })
  ).toBeVisible();
  await expect(
    mine.getByRole("button", { name: "Delete comment" })
  ).toBeVisible();
  await expect(
    theirs.getByRole("button", { name: "Edit comment" })
  ).toHaveCount(0);
  await expect(
    theirs.getByRole("button", { name: "Delete comment" })
  ).toHaveCount(0);
});

test("editing a conversation comment prefills the markdown and saves", async ({
  page,
}) => {
  const mine = page
    .locator(".qf-convo-item")
    .filter({ hasText: "Deploying to staging first." });
  await mine.getByRole("button", { name: "Edit comment" }).click();

  const box = page.getByRole("textbox", { name: "Edit your comment…" });
  await expect(box).toBeFocused();
  await expect(box.locator("strong")).toHaveText("staging");

  await page.keyboard.type(" Then production.");
  await mine.getByRole("button", { name: "Save" }).click();

  await expect(box).toHaveCount(0);
  await expect(page.getByText("Then production.")).toBeVisible();

  const sent = JSON.parse(
    await page.evaluate(
      () => localStorage.getItem("e2e:lastConvoEdit") ?? "null"
    )
  );
  expect(sent.commentId).toBe(210);
  expect(sent.body).toContain("**staging**");
  expect(sent.body).toContain("Then production.");
});

test("deleting a conversation comment takes the two-step confirm", async ({
  page,
}) => {
  const mine = page
    .locator(".qf-convo-item")
    .filter({ hasText: "Deploying to staging first." });
  const del = mine.getByRole("button", { name: "Delete comment" });

  await del.click();
  await expect(del).toHaveText("Delete?");
  await del.click();

  await expect(page.getByText("Deploying to staging first.")).toHaveCount(0);
  const sent = JSON.parse(
    await page.evaluate(
      () => localStorage.getItem("e2e:lastConvoDelete") ?? "null"
    )
  );
  expect(sent.commentId).toBe(210);
});

test("review verdicts never grow edit/delete tools", async ({ page }) => {
  const verdict = page
    .locator(".qf-convo-item")
    .filter({ hasText: "LGTM, ship it." });
  await expect(verdict).toBeVisible();
  await expect(
    verdict.getByRole("button", { name: "Edit comment" })
  ).toHaveCount(0);
  await expect(
    verdict.getByRole("button", { name: "Delete comment" })
  ).toHaveCount(0);
});

test("shift+c opens the composer focused, from the diff or the open drawer", async ({
  page,
}) => {
  // drawer is open (beforeEach); shift+c expands the prompt into the editor
  await page.keyboard.press("Shift+c");
  const editor = page.getByRole("textbox", {
    name: "Comment on this pull request…",
  });
  await expect(editor).toBeFocused();

  // esc collapses back to the prompt, then closes the drawer
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Comment on this pull request…" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("aside.qf-drawer-open")).toHaveCount(0);

  // from the diff with the drawer closed, one press does it all
  await page.keyboard.press("Shift+c");
  await expect(page.locator("aside.qf-drawer-open")).toHaveCount(1);
  await expect(editor).toBeFocused();
});
