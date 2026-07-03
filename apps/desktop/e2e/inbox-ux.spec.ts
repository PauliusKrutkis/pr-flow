import { expect, test } from "@playwright/test";
import { setupApp } from "./bridge";
import { makePr, SUBSCRIBED } from "./fixtures";
import type { InboxFixture } from "./fixtures";

// UX regressions: search must index the watched bucket, the toast host must
// only dodge a reading pane that actually exists, and the custom overlay
// scrollbars must reveal a themed thumb while scrolling.

test("global search finds PRs that exist only in the watched bucket", async ({
  page,
}) => {
  await setupApp(page, { subscribed: SUBSCRIBED });
  await expect(page.getByRole("option").first()).toBeVisible();

  await page.keyboard.press("/");
  const input = page.getByPlaceholder("Search all pull requests…");
  await expect(input).toBeFocused();

  // This PR lives ONLY in the subscribed (Watching) bucket — acme/comet#77.
  await input.fill("satellite");
  const rows = page.locator(".qsp-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Watched-only satellite uplink");
  await expect(rows.first()).toContainText("acme/comet");

  // A PR present in an inbox bucket AND the watched bucket appears once.
  await input.fill("fuzzy matching");
  await expect(
    page.locator(".qsp-row", { hasText: "Add fuzzy matching to search" }),
  ).toHaveCount(1);

  // Enter opens the watched-only PR's review screen.
  await input.fill("satellite");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" }),
  ).toBeVisible(); // fixture detail is the same payload for every PR
});

test("toast host sits beside the reading pane when it is rendered", async ({
  page,
}) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();

  await page.keyboard.press("e"); // archive → undo toast; 2 PRs remain
  await expect(page.getByRole("alert")).toContainText("Archived");
  await expect(
    page.getByRole("complementary", { name: "Pull request detail" }),
  ).toBeVisible();
  // 18px corner + 380px pane + 12px gap = calc(380px + 30px).
  await expect
    .poll(async () =>
      page
        .locator(".qb-stack-host")
        .evaluate((el) => getComputedStyle(el).right),
    )
    .toBe("410px");
});

test("toast host returns to the corner when the inbox is empty", async ({
  page,
}) => {
  const oneShot: InboxFixture = {
    reviewRequested: {
      count: 1,
      prs: [makePr(1, "The only review", "alice", "2026-07-02T10:00:00Z")],
    },
    assigned: { count: 0, prs: [] },
    created: { count: 0, prs: [] },
    involved: { count: 0, prs: [] },
  };
  await setupApp(page, { inbox: oneShot });
  await expect(page.getByRole("option").first()).toBeVisible();

  // Archiving the only PR empties the tab: InboxZero replaces both panes,
  // and the undo toast must slide back to the corner — not float mid-canvas.
  await page.keyboard.press("e");
  await expect(page.getByRole("alert")).toContainText("Archived");
  await expect(page.getByText("All clear")).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Pull request detail" }),
  ).toHaveCount(0);
  await expect
    .poll(async () =>
      page
        .locator(".qb-stack-host")
        .evaluate((el) => getComputedStyle(el).right),
    )
    .toBe("18px");
});

test("scrollbar thumb is invisible at rest and themed while scrolling", async ({
  page,
}) => {
  // Enough rows to overflow the list viewport.
  const tall: InboxFixture = {
    reviewRequested: {
      count: 40,
      prs: Array.from({ length: 40 }, (_, i) =>
        makePr(i + 1, `Scrollable PR ${i + 1}`, "alice", "2026-07-02T10:00:00Z"),
      ),
    },
    assigned: { count: 0, prs: [] },
    created: { count: 0, prs: [] },
    involved: { count: 0, prs: [] },
  };
  await setupApp(page, { inbox: tall });
  await expect(page.getByRole("option").first()).toBeVisible();

  const list = page.locator(".q-inbox-list");
  const thumbColor = () =>
    list.evaluate(
      (el) =>
        getComputedStyle(el, "::-webkit-scrollbar-thumb").backgroundColor,
    );

  // At rest (no hover, no scroll): the thumb is fully transparent.
  expect(await thumbColor()).toBe("rgba(0, 0, 0, 0)");

  // Scrolling adds `.is-scrolling` (App.tsx capture listener) and the webkit
  // thumb takes --color-line-strong (#2c2c40). This is exactly the styling
  // that standard scrollbar-width/scrollbar-color used to disable.
  await list.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(list).toHaveClass(/is-scrolling/);
  expect(await thumbColor()).toBe("rgb(44, 44, 64)");

  // The reveal decays back to invisible once scrolling stops.
  await expect(list).not.toHaveClass(/is-scrolling/, { timeout: 3_000 });
  expect(await thumbColor()).toBe("rgba(0, 0, 0, 0)");
});
