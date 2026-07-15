import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

const REVIEW_REQUESTS = /Review requests/;
const ASSIGNED = /Assigned/;
const CREATED = /Created/;
const INVOLVED = /Involved/;
const WATCHING = /Watching/;
const WATCH_A_REPOSITORY = /Watch a repository/;
const ARCHIVED = /Archived/;

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
});

test("renders the review-requested list with counts", async ({ page }) => {
  await expect(page.getByRole("option")).toHaveCount(3);
  await expect(
    page.getByRole("button", { name: REVIEW_REQUESTS })
  ).toContainText("3");
  await expect(
    page.getByRole("listbox").getByText("Add fuzzy matching to search")
  ).toBeVisible();
});

test("j/k move the selection; the reading pane follows", async ({ page }) => {
  const options = page.getByRole("option");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("j");
  await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("complementary", { name: "Pull request detail" })
  ).toContainText("Fix cursor drift");
  await page.keyboard.press("k");
  await expect(options.nth(0)).toHaveAttribute("aria-selected", "true");
});

test("empty tabs are hidden; digits still reach them", async ({ page }) => {
  // Default fixture: only Review requests (3) and Created (1) hold PRs;
  // Assigned, Involved and Watching are empty and stay out of the bar.
  await expect(
    page.getByRole("button", { name: REVIEW_REQUESTS })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: CREATED })).toBeVisible();
  await expect(page.getByRole("button", { name: ASSIGNED })).toHaveCount(0);
  await expect(page.getByRole("button", { name: INVOLVED })).toHaveCount(0);
  await expect(page.getByRole("button", { name: WATCHING })).toHaveCount(0);

  if (process.env.CAPTURE_EVIDENCE) {
    await page.screenshot({ path: "evidence/inbox-hide-empty-tabs.png" });
  }

  // A digit selects an empty tab, which then appears as the active tab so you
  // land on its zero-state rather than nowhere.
  await page.keyboard.press("2");
  await expect(page.getByRole("button", { name: ASSIGNED })).toHaveAttribute(
    "data-state",
    "active"
  );
});

test("tab cycles only visible tabs; digits jump directly", async ({ page }) => {
  // Tab skips the hidden Assigned/Involved tabs: Review requests → Created.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: CREATED })).toHaveAttribute(
    "data-state",
    "active"
  );
  // Watching is hidden until a digit reveals it (then its zero-state offers the
  // watch-a-repository onboarding).
  await page.keyboard.press("5");
  await expect(page.getByRole("button", { name: WATCHING })).toHaveAttribute(
    "data-state",
    "active"
  );
  await expect(
    page.getByRole("button", { name: WATCH_A_REPOSITORY })
  ).toBeVisible();
  await page.keyboard.press("1");
});

test("e archives with an undo toast; z restores", async ({ page }) => {
  await page.keyboard.press("e");
  await expect(page.getByRole("option")).toHaveCount(2);
  const toast = page.getByRole("alert");
  await expect(toast).toContainText("Archived");
  await expect(toast).toContainText("Add fuzzy matching to search");
  await expect(
    page.getByRole("button", { name: REVIEW_REQUESTS })
  ).toContainText("2");
  await page.keyboard.press("z");
  await expect(page.getByRole("option")).toHaveCount(3);
});

test("u shows archived PRs; e there restores them to the inbox", async ({
  page,
}) => {
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.keyboard.press("e");
  await expect(page.getByRole("option")).toHaveCount(2);

  const archivedToggle = page.getByRole("button", { name: ARCHIVED });
  await expect(archivedToggle).toContainText("1");

  await page.keyboard.press("u");
  await expect(page.getByRole("option")).toHaveCount(1);
  await expect(
    page.getByRole("option").getByText("Add fuzzy matching to search")
  ).toBeVisible();

  await page.keyboard.press("e");
  const toast = page.getByRole("alert");
  await expect(toast).toContainText("Restored");
  await expect(page.getByRole("option")).toHaveCount(0);

  await page.keyboard.press("u");
  await expect(page.getByRole("option")).toHaveCount(3);
});

test("y copies the selected PR's link and confirms with a toast", async ({
  page,
}) => {
  await page.keyboard.press("j");
  await page.keyboard.press("y");
  const toast = page.getByRole("alert");
  await expect(toast).toContainText("Copied PR link");
  await expect(toast).toContainText("https://github.com/acme/rocket/pull/2");
});

test("enter opens the selected PR's review", async ({ page }) => {
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" })
  ).toBeVisible();
  await expect(page.getByText("src/lib/fuzzy.ts").first()).toBeVisible();
});

test("global search ranks and opens", async ({ page }) => {
  await page.keyboard.press("/");
  const input = page.getByPlaceholder("Search all pull requests…");
  await expect(input).toBeFocused();
  await input.fill("cursor drift");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" })
  ).toBeVisible();
});
