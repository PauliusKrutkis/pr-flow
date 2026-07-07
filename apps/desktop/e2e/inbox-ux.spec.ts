import { expect, test } from "./test";
import { setupApp } from "./bridge";
import { makePr, SUBSCRIBED } from "./fixtures";
import type { InboxFixture } from "./fixtures";

test("global search finds PRs that exist only in the watched bucket", async ({
  page,
}) => {
  await setupApp(page, { subscribed: SUBSCRIBED });
  await expect(page.getByRole("option").first()).toBeVisible();

  await page.keyboard.press("/");
  const input = page.getByPlaceholder("Search all pull requests…");
  await expect(input).toBeFocused();

  await input.fill("satellite");
  const rows = page.locator(".qsp-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Watched-only satellite uplink");
  await expect(rows.first()).toContainText("acme/comet");

  await input.fill("fuzzy matching");
  await expect(
    page.locator(".qsp-row", { hasText: "Add fuzzy matching to search" }),
  ).toHaveCount(1);

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

test("reading pane shows description, diff stats and the latest comment", async ({
  page,
}) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();

  const pane = page.getByRole("complementary", { name: "Pull request detail" });
  await expect(pane.getByText("Description")).toBeVisible();
  await expect(pane.locator("strong", { hasText: "fixture" })).toBeVisible();
  await expect(pane.locator(".qi-detail-stats")).toContainText("2 files");
  await expect(pane.locator(".qi-add")).toHaveText("+12");
  await expect(pane.locator(".qi-del")).toHaveText("−3");
  await expect(pane.getByText("Latest comment")).toBeVisible();
  await expect(pane.locator(".qi-detail-comment")).toContainText("bob");
  await expect(pane.locator(".qi-detail-comment-body")).toContainText(
    "one nit on the debounce timing",
  );
});

test("reading pane hides diff stats the provider didn't send", async ({
  page,
}) => {
  /**
   * GitLab list payloads have no +/- totals — zeros mean "unknown", and the
   * pane must not present them as facts.
   */

  const sparse = {
    ...makePr(9, "MR from a list payload", "erin", "2026-07-02T08:00:00Z"),
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    lastComment: undefined,
  };
  const inbox: InboxFixture = {
    reviewRequested: { count: 1, prs: [sparse] },
    assigned: { count: 0, prs: [] },
    created: { count: 0, prs: [] },
    involved: { count: 0, prs: [] },
  };
  await setupApp(page, { inbox });
  await expect(page.getByRole("option").first()).toBeVisible();

  const stats = page.locator(".qi-detail-stats");
  await expect(stats).toContainText("0 comments");
  await expect(stats).not.toContainText("file");
  await expect(stats).not.toContainText("+0");
});

test("watch dialog: Tab arms remove and Done without moving focus", async ({
  page,
}) => {
  await setupApp(page, { watchedRepos: ["acme/rocket", "acme/comet"] });
  await expect(page.getByRole("option").first()).toBeVisible();

  await page.keyboard.press("w");
  const input = page.getByPlaceholder(/Search repositories/);
  await expect(input).toBeFocused();
  await expect(page.locator(".qw-row")).toHaveCount(2);

  await page.keyboard.press("Tab");
  await expect(page.locator(".qw-row-armed")).toContainText("acme/rocket");
  await expect(input).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(page.locator(".qw-row")).toHaveCount(1);
  await expect(page.locator(".qw-row-armed")).toContainText("acme/comet");
  await expect(input).toBeFocused();

  await page.keyboard.press("Tab");
  await expect(page.locator(".qw-done-armed")).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Watched repositories" })).toHaveCount(0);
});

test("watch dialog search shows a border sweep in flight, no empty box", async ({
  page,
}) => {
  await setupApp(page, {
    repoHits: [{ fullName: "acme/rocket", description: "Main repo" }],
  });
  await expect(page.getByRole("option").first()).toBeVisible();

  await page.keyboard.press("w");
  const input = page.getByPlaceholder(/Search repositories/);
  await expect(input).toBeFocused();
  await input.fill("roc");

  await expect(page.locator(".qw-scan")).toBeVisible();
  await expect(page.locator(".qw-panel [role='listbox']")).toHaveCount(0);

  await expect(page.locator(".qw-hit")).toContainText("acme/rocket");
  await expect(page.locator(".qw-scan")).toHaveCount(0);
});

test("watch dialog input clears its leading icon", async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();

  await page.keyboard.press("w");
  const input = page.getByPlaceholder(/Search repositories/);
  await expect
    .poll(async () => input.evaluate((el) => getComputedStyle(el).paddingLeft))
    .toBe("34px");
});

test("scrollbar thumb is invisible at rest and themed while scrolling", async ({
  page,
}) => {
  /** Enough rows to overflow the list viewport. */

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

  expect(await thumbColor()).toBe("rgba(0, 0, 0, 0)");

  await list.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect(list).toHaveClass(/is-scrolling/);
  expect(await thumbColor()).toBe("rgb(44, 44, 64)");

  await expect(list).not.toHaveClass(/is-scrolling/, { timeout: 3_000 });
  expect(await thumbColor()).toBe("rgba(0, 0, 0, 0)");
});
