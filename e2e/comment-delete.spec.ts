import { setupApp } from "./bridge.ts";
import { DETAIL_WITH_OWN_COMMENT } from "./fixtures.ts";
import { expect, test } from "./test.ts";

test.beforeEach(async ({ page }) => {
  await setupApp(page, { detail: DETAIL_WITH_OWN_COMMENT });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("delete shows only on your own comments", async ({ page }) => {
  const mine = page.locator('[data-comment-root="150"]');
  const theirs = page.locator('[data-comment-root="100"]');
  await expect(
    mine.getByRole("button", { name: "Delete comment" })
  ).toBeVisible();
  await expect(
    theirs.getByRole("button", { name: "Delete comment" })
  ).toHaveCount(0);
});

test("the first click arms the confirm; leaving the button disarms it", async ({
  page,
}) => {
  const mine = page.locator('[data-comment-root="150"]');
  const del = mine.getByRole("button", { name: "Delete comment" });

  await del.click();
  await expect(del).toHaveText("Delete?");

  await mine.getByText("I will tighten this loop tomorrow.").hover();
  await expect(del).toHaveText("Delete");
  await expect(
    mine.getByText("I will tighten this loop tomorrow.")
  ).toBeVisible();
});

test("the second click deletes the comment", async ({ page }) => {
  const mine = page.locator('[data-comment-root="150"]');
  const del = mine.getByRole("button", { name: "Delete comment" });

  await del.click();
  await expect(del).toHaveText("Delete?");
  await del.click();

  await expect(page.locator('[data-comment-root="150"]')).toHaveCount(0);
  await expect(
    page.getByText("I will tighten this loop tomorrow.")
  ).toHaveCount(0);

  const sent = JSON.parse(
    await page.evaluate(
      () => localStorage.getItem("e2e:lastCommentDelete") ?? "null"
    )
  );
  expect(sent.commentId).toBe(150);
});
