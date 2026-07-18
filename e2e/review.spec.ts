import { setupApp } from "./bridge.ts";
import { DETAIL_NO_CI } from "./fixtures.ts";
import { expect, test } from "./test.ts";
import type { Page } from "./types.ts";

const SUBMIT_REVIEW = /Submit review/;
const COPY_FILE_PATH = /Copy file path/;
const COPY_PR_LINK = /Copy PR link/;
const REVIEW_REQUESTS = /Review requests/;
const QF_ROW_FLASH = /qf-row-flash/;
const QF_SWAP_MASK = /qf-swap-mask/;
const QF_FILE_ACTIVE = /qf-file-active/;
const QF_DRAWER_WIDE = /qf-drawer-wide/;

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("continuous scroll: all files render with sticky headers", async ({
  page,
}) => {
  await expect(
    page.locator('.qf-fsec-head[data-file-index="0"]').first()
  ).toContainText("fuzzy.ts");
  await expect(
    page.locator('.qf-fsec-head[data-file-index="1"]').first()
  ).toContainText("search.ts");
  await expect(
    page.locator('.qf-fsec-head[data-file-index="2"]').first()
  ).toContainText("retry.ts");
});

test("j moves the line cursor; sidebar follows the cursor's file", async ({
  page,
}) => {
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-active")).toHaveCount(1);
  await expect(
    page.locator(".js-comment").getByText("Is this constant right?")
  ).toBeVisible();
});

test("f and g fast-move the cursor without scrolling when still in view", async ({
  page,
}) => {
  const active = page.locator(".qf-row-active");
  const scrollHost = page.locator(".qf-scrollhost");

  await page.keyboard.press("j");
  const anchor0 = await active.getAttribute("data-anchor");
  const scroll0 = await scrollHost.evaluate((el) => el.scrollTop);

  await page.keyboard.press("f");
  await expect(active).not.toHaveAttribute("data-anchor", anchor0 ?? "");
  expect(await scrollHost.evaluate((el) => el.scrollTop)).toBe(scroll0);

  await page.keyboard.press("g");
  await expect(active).toHaveAttribute("data-anchor", anchor0 ?? "");
});

test("c opens the composer; adding batches a pending card", async ({
  page,
}) => {
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  const box = page.getByRole("textbox", { name: "Add a review comment…" });
  await expect(box).toBeFocused();
  await box.fill("Tighten this up?");
  await page.getByRole("button", { name: "Add to review" }).click();
  await expect(page.getByText("Pending")).toBeVisible();
  await expect(page.getByText("Tighten this up?")).toBeVisible();
  await expect(page.getByRole("button", { name: SUBMIT_REVIEW })).toContainText(
    "1"
  );
});

test("pending drafts survive leaving and reopening the PR", async ({
  page,
}) => {
  await page.keyboard.press("j");
  await page.keyboard.press("c");
  await page
    .getByRole("textbox", { name: "Add a review comment…" })
    .fill("Draft to keep");
  await page.getByRole("button", { name: "Add to review" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Draft to keep")).toBeVisible();
});

test("text search (mod+r) lands on the line and seeds the comment cursor", async ({
  page,
}) => {
  await page.keyboard.press("Control+r");
  const input = page.getByPlaceholder("Search code in this PR…");
  await expect(input).toBeFocused();
  await input.fill("gamma");
  await expect(page.locator(".qsp-row").first()).toContainText("gamma");
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-row-flash")).toHaveCount(1);
  await page.keyboard.press("c");
  await expect(
    page.getByRole("textbox", { name: "Add a review comment…" })
  ).toBeVisible();
});

test("find bar: mod+f opens it, typing counts, Enter steps and wraps", async ({
  page,
}) => {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Find in diff");
  await expect(input).toBeFocused();

  await input.fill("return");
  const count = page.locator(".qf-findbar-count");
  await expect(count).toHaveText("1/3");
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(3);

  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1/3");
  await expect(page.locator('.qf-row-flash[data-file-index="0"]')).toHaveCount(
    1
  );
  await expect(page.locator("mark.qf-find-current")).toHaveCount(1);
  await expect(
    page.locator('.qf-row[data-file-index="0"] mark.qf-find-current')
  ).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(count).toHaveText("2/3");
  await page.keyboard.press("Enter");
  await expect(count).toHaveText("3/3");
  await expect(
    page.locator('.qf-row[data-file-index="1"] mark.qf-find-current')
  ).toHaveCount(1);

  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1/3");
  await page.keyboard.press("Shift+Enter");
  await expect(count).toHaveText("3/3");
});

test("next file lands cleanly: current file's header pinned, no previous rows peeking", async ({
  page,
}) => {
  await page.keyboard.press("r");
  await page.waitForFunction(() => {
    const pinned = document.querySelector<HTMLElement>(
      '[data-testid="virtuoso-top-item-list"] .qf-fsec-head'
    );
    return pinned?.dataset.fileIndex === "1";
  });
  const prevPeeking = await page.evaluate(() => {
    const host = document.querySelector(".qf-scrollhost");
    if (!host) {
      return false;
    }
    const { top } = host.getBoundingClientRect();
    return Array.from(
      document.querySelectorAll('.qf-row[data-file-index="0"]')
    ).some((r) => r.getBoundingClientRect().bottom > top + 2);
  });
  expect(prevPeeking).toBe(false);
  await page.keyboard.press("t");
  await page.waitForFunction(() => {
    const pinned = document.querySelector<HTMLElement>(
      '[data-testid="virtuoso-top-item-list"] .qf-fsec-head'
    );
    return pinned?.dataset.fileIndex === "0";
  });
});

test("resume: reopening paints the spot you left — no visible jump after", async ({
  page,
}) => {
  await page.keyboard.press("r");
  await page.keyboard.press("r");
  const fileRow = page.locator('.qf-row[data-file-index="2"]').first();
  await expect(fileRow).toBeVisible();
  await page.waitForFunction(() => {
    const host = document.querySelector(".qf-scrollhost");
    const row = document.querySelector('.qf-row[data-file-index="2"]');
    if (!(host && row)) {
      return false;
    }
    const d =
      row.getBoundingClientRect().top - host.getBoundingClientRect().top;
    return d >= 0 && d < 120;
  });
  await page.evaluate(() => {
    const host = document.querySelector(".qf-scrollhost");
    if (host) {
      host.scrollTop += 120;
    }
  });

  const before = await page.evaluate(() => {
    const host = document.querySelector(".qf-scrollhost");
    const row = document.querySelector('[data-anchor][data-file-index="2"]');
    if (!(host && row)) {
      return null;
    }
    return row.getBoundingClientRect().top - host.getBoundingClientRect().top;
  });
  await page.waitForTimeout(900);

  await page.reload();
  await expect(page.locator(".qf-diff").first()).toBeVisible();
  await expect(
    page.locator('[data-anchor][data-file-index="2"]').first()
  ).toBeVisible();

  const measure = () =>
    page.evaluate(() => {
      const host = document.querySelector(".qf-scrollhost");
      const row = document.querySelector('[data-anchor][data-file-index="2"]');
      if (!(host && row)) {
        return null;
      }
      return row.getBoundingClientRect().top - host.getBoundingClientRect().top;
    });
  const after = await measure();
  expect(after).not.toBeNull();
  expect(before).not.toBeNull();
  expect(Math.abs((after as number) - (before as number))).toBeLessThan(40);
  await page.waitForTimeout(700);
  const settled = await measure();
  expect(Math.abs((settled as number) - (after as number))).toBeLessThan(24);
});

test("find seeds from the viewport: the current match is the one near you, not the top", async ({
  page,
}) => {
  await page.keyboard.press("r");
  await page.waitForFunction(() => {
    const pinned = document.querySelector<HTMLElement>(
      '[data-testid="virtuoso-top-item-list"] .qf-fsec-head'
    );
    return pinned?.dataset.fileIndex === "1";
  });
  await expect(
    page.locator('.qf-row[data-file-index="1"]').first()
  ).toBeVisible();

  await page.keyboard.press("Control+f");
  await page.getByPlaceholder("Find in diff").fill("return");
  const count = page.locator(".qf-findbar-count");
  await expect(count).toHaveText("3/3");
  await expect(page.locator("mark.qf-find-mark").first()).toBeVisible();

  await page.keyboard.press("Enter");
  await expect(count).toHaveText("3/3");
  await expect(page.locator('.qf-row-flash[data-file-index="1"]')).toHaveCount(
    1
  );

  await page.keyboard.press("Enter");
  await expect(count).toHaveText("1/3");
});

test("find bar: Esc closes, clears marks, and j moves the cursor immediately", async ({
  page,
}) => {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Find in diff");
  await input.fill("gamma");
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/2");

  await page.keyboard.press("Enter");
  await expect(page.locator('.qf-row-flash[data-file-index="1"]')).toHaveCount(
    1
  );

  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-findbar")).toHaveCount(0);
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(0);
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-active")).toHaveCount(1);
});

test("find bar: reopening keeps the query selected; typing replaces it", async ({
  page,
}) => {
  await page.keyboard.press("Control+f");
  const input = page.getByPlaceholder("Find in diff");
  await input.fill("gamma");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Find in diff")).toBeFocused();
  await page.keyboard.type("beta");
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/1");
});

test("info drawer: i opens with the conversation, esc closes drawer first", async ({
  page,
}) => {
  await page.keyboard.press("i");
  await expect(page.locator(".qf-drawer")).toHaveAttribute(
    "aria-hidden",
    "false"
  );
  await expect(page.getByText("Nice direction overall.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-drawer")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" })
  ).toBeVisible();
});

test("shift+i widens the drawer; the head button and Esc still work", async ({
  page,
}) => {
  const drawer = page.locator(".qf-drawer");
  await page.keyboard.press("i");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(drawer).not.toHaveClass(QF_DRAWER_WIDE);

  await page.keyboard.press("Shift+i");
  await expect(drawer).toHaveClass(QF_DRAWER_WIDE);

  await page.getByRole("button", { name: "Narrow panel" }).click();
  await expect(drawer).not.toHaveClass(QF_DRAWER_WIDE);

  await page.keyboard.press("Shift+i");
  await expect(drawer).toHaveClass(QF_DRAWER_WIDE);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveAttribute("aria-hidden", "true");
});

test("shift+i from closed opens without toggling width", async ({ page }) => {
  const drawer = page.locator(".qf-drawer");
  await page.keyboard.press("Shift+i");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(drawer).not.toHaveClass(QF_DRAWER_WIDE);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+i");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(drawer).not.toHaveClass(QF_DRAWER_WIDE);

  await page.keyboard.press("Shift+i");
  await expect(drawer).toHaveClass(QF_DRAWER_WIDE);

  await page.keyboard.press("Escape");
  await page.keyboard.press("Shift+i");
  await expect(drawer).toHaveAttribute("aria-hidden", "false");
  await expect(drawer).toHaveClass(QF_DRAWER_WIDE);
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
  await expect(
    page.getByRole("button", { name: COPY_FILE_PATH })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: COPY_PR_LINK })).toBeVisible();
});

test("esc returns to the inbox", async ({ page }) => {
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: REVIEW_REQUESTS })
  ).toBeVisible();
});

test("info timeline: review verdicts interleave with comments, oldest first", async ({
  page,
}) => {
  await page.keyboard.press("i");
  const drawer = page.locator(".qf-drawer");
  await expect(drawer.getByText("LGTM, ship it.")).toBeVisible();
  await expect(drawer.locator(".q-pill-approved")).toHaveText("Approved");

  const items = drawer.locator(".qf-convo-item");
  await expect(items.nth(0)).toContainText("carol");
  await expect(items.nth(1)).toContainText("dave");
});

test("info code discussion lists inline threads; a row jumps to the diff", async ({
  page,
}) => {
  await page.keyboard.press("i");
  const row = page.locator(".qf-thread-row");
  await expect(row).toContainText("src/lib/fuzzy.ts");
  await expect(row).toContainText(":2");
  await expect(row).toContainText("Is this constant right?");
  await row.click();
  await expect(page.locator(".qf-drawer")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
  const thread = page.locator('[data-comment-root="100"]');
  await expect(thread).toBeVisible();
  await expect(thread).toHaveClass(QF_ROW_FLASH);
});

test("the i button advertises how much conversation the drawer holds", async ({
  page,
}) => {
  await expect(page.locator(".qf-info-count")).toHaveText("3");
});

test("esc in the drawer composer closes the drawer and releases the keyboard", async ({
  page,
}) => {
  await page.keyboard.press("i");
  const box = page.getByRole("textbox", {
    name: "Comment on this pull request…",
  });
  await box.click();
  await box.fill("half-typed thought");
  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-drawer")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
  await expect(
    page.getByRole("heading", { name: "Add fuzzy matching to search" })
  ).toBeVisible();
  await page.keyboard.press("j");
  await expect(page.locator(".qf-row-active")).toHaveCount(1);
});

test("after esc-closing from the composer, i reopens the drawer", async ({
  page,
}) => {
  await page.keyboard.press("i");
  await page
    .getByRole("textbox", { name: "Comment on this pull request…" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-drawer")).toHaveAttribute(
    "aria-hidden",
    "true"
  );
  await page.keyboard.press("i");
  await expect(page.locator(".qf-drawer")).toHaveAttribute(
    "aria-hidden",
    "false"
  );
});

test("clicking a sidebar file blurs it so no focus ring lingers after r/t", async ({
  page,
}) => {
  const file2 = page.locator('.qf-file[data-file-index="2"]');
  await file2.click();
  await expect(file2).toHaveClass(QF_FILE_ACTIVE);
  await expect(page.locator(".qf-file:focus")).toHaveCount(0);

  await page.keyboard.press("t");
  await expect(page.locator('.qf-file[data-file-index="1"]')).toHaveClass(
    QF_FILE_ACTIVE
  );
  await expect(file2).not.toHaveClass(QF_FILE_ACTIVE);
  await expect(page.locator(".qf-file:focus")).toHaveCount(0);
});

test("comment posting is optimistic even when the network hangs", async ({
  page,
}) => {
  await setupApp(page, { hangIssueComment: true });
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
  await page.keyboard.press("i");
  const box = page.getByRole("textbox", {
    name: "Comment on this pull request…",
  });
  await box.click();
  await box.fill("Ship it when green");
  await page.keyboard.press("Control+Enter");
  await expect(
    page.locator(".qf-convo").getByText("Ship it when green")
  ).toBeVisible({ timeout: 1000 });
  await expect(box).toHaveText("");
});

test("shift+v expands the active file in place and collapses back", async ({
  page,
}) => {
  await expect(page.getByText("export function omega() {")).toHaveCount(0);
  await page.keyboard.press("Shift+v");
  const tail = page.locator(".qf-row-xctx", {
    hasText: "export function omega() {",
  });
  await expect(tail.first()).toBeVisible();
  await expect(page.locator(".qf-row-xctx .qf-add-btn")).toHaveCount(0);
  await page.keyboard.press("Shift+v");
  await expect(page.locator(".qf-row-xctx")).toHaveCount(0);
});

test("toggling parks the cursor row at a stable reading line", async ({
  page,
}) => {
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("j");
  }
  const cursorRow = page.locator(".qf-row-active");
  await expect(cursorRow).toBeVisible();
  const readReadingLine = async () => {
    await expect(page.locator(".qf-scrollhost")).not.toHaveClass(QF_SWAP_MASK);
    await expect(cursorRow).toBeVisible();
    return (await cursorRow.boundingBox())?.y ?? Number.NaN;
  };
  await page.keyboard.press("Shift+v");
  await expect(page.locator(".qf-row-xctx").first()).toBeVisible();
  const firstExpand = await readReadingLine();
  await page.keyboard.press("Shift+v");
  await expect(page.locator(".qf-row-xctx")).toHaveCount(0);
  await readReadingLine();
  await page.keyboard.press("Shift+v");
  await expect(page.locator(".qf-row-xctx").first()).toBeVisible();
  const secondExpand = await readReadingLine();
  expect(Math.abs(firstExpand - secondExpand)).toBeLessThan(4);
});

/**
 * The worst *visible* movement of the flashed reading row across the frames
 * after the swap reveals. The reading-line contract repositions the cursor row
 * to a constant spot on toggle (so its old offset is *meant* to change), and
 * the swap is masked (the scroller is hidden) while the virtualizer re-measures
 * the inserted rows — the reader sees nothing until reveal. What must not flash
 * is the row *after* reveal: a straggling re-measure jerking it. The sampler
 * presses the key, waits for the mask to lift, baselines the flashed row, and
 * reports the largest offset it wanders over the following frames.
 */
async function transientAnchorDrift(
  page: Page,
  press: string
): Promise<number> {
  await page.keyboard.press(press);
  await expect(page.locator(".qf-scrollhost")).not.toHaveClass(QF_SWAP_MASK);
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const scroller = document.querySelector<HTMLElement>(".qf-scrollhost");
        const flashed = scroller?.querySelector<HTMLElement>(".qf-row-flash");
        if (!(scroller && flashed)) {
          resolve(0);
          return;
        }
        const key = `${flashed.getAttribute("data-file-index")}::${flashed.getAttribute("data-anchor")}`;
        const base =
          flashed.getBoundingClientRect().top -
          scroller.getBoundingClientRect().top;
        let worst = 0;
        let frames = 0;
        const sample = () => {
          const [fileIndex, anchor] = key.split("::");
          const row = scroller.querySelector<HTMLElement>(
            `[data-file-index="${fileIndex}"][data-anchor="${anchor}"]`
          );
          if (row) {
            const top =
              row.getBoundingClientRect().top -
              scroller.getBoundingClientRect().top;
            worst = Math.max(worst, Math.abs(top - base));
          }
          frames += 1;
          if (frames < 30) {
            requestAnimationFrame(sample);
          } else {
            resolve(worst);
          }
        };
        requestAnimationFrame(sample);
      })
  );
}

const MAX_TRANSIENT_DRIFT_PX = 8;

/**
 * Drive the cursor deep into a file with the fast-down key. The full-file
 * toggle anchors on the cursor row (not the scroll position), so the cursor is
 * what has to be parked mid-file for the swap to insert rows above the anchor.
 */
async function moveCursorDeep(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("f");
    await page.waitForTimeout(30);
  }
  await page.waitForTimeout(300);
}

test("expanding deep in a file does not flash the anchor row", async ({
  page,
}) => {
  await moveCursorDeep(page);
  const drift = await transientAnchorDrift(page, "Shift+v");
  await expect(page.locator(".qf-row-xctx").first()).toBeVisible();
  expect(drift).toBeLessThan(MAX_TRANSIENT_DRIFT_PX);
});

test("collapsing deep in a file does not flash the anchor row", async ({
  page,
}) => {
  await moveCursorDeep(page);
  await page.keyboard.press("Shift+v");
  await expect(page.locator(".qf-row-xctx").first()).toBeVisible();
  await expect(page.locator(".qf-scrollhost")).not.toHaveClass(QF_SWAP_MASK);
  const drift = await transientAnchorDrift(page, "Shift+v");
  await expect(page.locator(".qf-row-xctx")).toHaveCount(0);
  expect(drift).toBeLessThan(MAX_TRANSIENT_DRIFT_PX);
});

test("expanding with an in-flight blob does not flash the anchor row", async ({
  page,
}) => {
  await setupApp(page, { fileBlobDelayMs: 250 });
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();

  await moveCursorDeep(page);
  const drift = await transientAnchorDrift(page, "Shift+v");
  await expect(page.locator(".qf-row-xctx").first()).toBeVisible();
  expect(drift).toBeLessThan(MAX_TRANSIENT_DRIFT_PX);
});

test("the header button toggles the full file and reads Diff only while expanded", async ({
  page,
}) => {
  const header = page.locator(".qf-fsec-head").first();
  await header.getByRole("button", { name: "Full file" }).click();
  await expect(page.locator(".qf-row-xctx").first()).toBeVisible();
  const collapse = header.getByRole("button", { name: "Diff only" });
  await expect(collapse).toHaveAttribute("aria-pressed", "true");
  await collapse.click();
  await expect(page.locator(".qf-row-xctx")).toHaveCount(0);
});

test("the header shows an approvals verdict with the reviewer's face", async ({
  page,
}) => {
  const pill = page.locator(".qf-verdict-approved");
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("title", "Approved · dave");
  await expect(pill.locator(".q-avatar")).toHaveCount(1);
  await expect(page.locator(".qf-verdict-changes")).toHaveCount(0);
});

test("the header shows a failing CI pill with the failed count", async ({
  page,
}) => {
  // CiPill lives in the info drawer (right-panel.tsx), not the header itself —
  // open it so the pill is actually on-screen and hoverable.
  await page.keyboard.press("i");
  const pill = page.locator(".qf-ci-failure");
  await expect(pill).toBeVisible();
  await pill.hover();
  await expect(page.locator(".q-tooltip")).toContainText(
    "Checks failing · 4 checks"
  );
  await expect(pill.locator(".qf-ci-count")).toHaveText("1/4");
});

test("a repo without CI shows no pill", async ({ page }) => {
  await setupApp(page, { detailByCall: [DETAIL_NO_CI] });
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
  await expect(page.locator(".qf-ci")).toHaveCount(0);
});
