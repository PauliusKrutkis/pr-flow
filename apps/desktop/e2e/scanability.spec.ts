import { expect, test, type Page } from "@playwright/test";
import { setupApp } from "./bridge";

/**
 * Viewport-centre of `token`'s first occurrence within a real (non-hunk) diff
 * code line of file section `section` (same helper as occurrences.spec.ts).
 */
async function tokenCenter(page: Page, section: number, token: string) {
  const rect = await page.evaluate(
    ({ section, token }) => {
      const sec = document.querySelectorAll(".qf-fsec")[section];
      const codes =
        sec?.querySelectorAll(".qf-row:not(.qf-row-hunk) .qf-code") ?? [];
      for (const code of codes) {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const i = node.data.indexOf(token);
          if (i === -1) continue;
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + token.length);
          const r = range.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    },
    { section, token },
  );
  if (!rect) throw new Error(`token not found in diff: ${token}`);
  return rect;
}

/** Single-click a token (settling the hover first, like a real pointer). */
async function clickToken(page: Page, section: number, token: string) {
  const { x, y } = await tokenCenter(page, section, token);
  await page.mouse.move(x, y);
  await page.waitForTimeout(100);
  await page.mouse.click(x, y);
}

// Diff scanability: intraline word-diff emphasis (and friends — sticky hunk
// context, indent guides, the overview ruler — as they land).

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("a clean rename emphasizes exactly the changed word pieces", async ({ page }) => {
  // retry.ts pairs "const retryCount = 3;" with "const retryLimit = 3;" —
  // the tokenizer splits the camelCase identifier, so only the differing
  // pieces light up.
  const section = page.locator(".qf-fsec").nth(2);
  const marks = section.locator("mark.qf-intra-mark");
  await expect(marks).toHaveCount(2);
  expect(await marks.allTextContents()).toEqual(["Count", "Limit"]);
  await expect(
    section.locator(".qf-row-del mark.qf-intra-mark"),
  ).toHaveText("Count");
  await expect(
    section.locator(".qf-row-add mark.qf-intra-mark"),
  ).toHaveText("Limit");
});

test("a rewrite pair fails the noise guard and renders without emphasis", async ({ page }) => {
  // fuzzy.ts pairs "- return 1;" with "+ // tuned" (the del run's only row
  // against the add run's first): no substantive tokens in common, so
  // emphasizing would cover both lines wall-to-wall — the guard bails.
  const section = page.locator(".qf-fsec").nth(0);
  // The section is rendered (its marks WOULD be visible)…
  await expect(section.locator(".qf-row-del")).toHaveCount(1);
  // …but carries no intraline emphasis.
  await expect(section.locator("mark.qf-intra-mark")).toHaveCount(0);
});

test("the current hunk's @@ header pins under the sticky file header", async ({ page }) => {
  const host = page.locator(".qf-scrollhost");
  const section = page.locator(".qf-fsec").nth(2);
  const head = section.locator(".qf-fsec-head");
  // retry.ts's second hunk is ~40 lines — scrolling to the bottom puts us
  // deep inside it, with its header's natural flow position far off-screen.
  const hunk = section.locator(".qf-row-hunk").nth(1);
  await expect(hunk).toContainText("export function retryLoop");
  await host.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

  const headBox1 = (await head.boundingBox())!;
  const hunkBox1 = (await hunk.boundingBox())!;
  // Pinned: the hunk header's top sits at the file header's bottom edge.
  expect(Math.abs(hunkBox1.y - (headBox1.y + headBox1.height))).toBeLessThan(2);

  const row = section.locator(".qf-row-add").last();
  const rowY1 = (await row.boundingBox())!.y;

  // Scroll up a bit: code rows move, both sticky bands stay put.
  await host.evaluate((el) => {
    el.scrollTop -= 120;
  });
  const headBox2 = (await head.boundingBox())!;
  const hunkBox2 = (await hunk.boundingBox())!;
  const rowY2 = (await row.boundingBox())!.y;
  expect(Math.abs(hunkBox2.y - hunkBox1.y)).toBeLessThan(2);
  expect(Math.abs(headBox2.y - headBox1.y)).toBeLessThan(2);
  expect(rowY2 - rowY1).toBeGreaterThan(100);
});

test("a pinned hunk header still collapses its hunk on click", async ({ page }) => {
  const host = page.locator(".qf-scrollhost");
  const section = page.locator(".qf-fsec").nth(2);
  const hunk = section.locator(".qf-row-hunk").nth(1);
  await host.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  const rows = section.locator(".qf-row-add");
  const openCount = await rows.count();
  await hunk.click();
  // Collapsing hides the hunk's rows (hunk 1's single add remains).
  await expect(rows).toHaveCount(1);
  await hunk.click();
  await expect(rows).toHaveCount(openCount);
});

test("indent guides wrap deep lines' leading whitespace, and nothing else", async ({ page }) => {
  const section = page.locator(".qf-fsec").nth(2);
  // retry.ts is 2-space indented; "        attempt," sits four levels deep.
  const deep = section
    .locator(".qf-row:not(.qf-row-hunk)", { hasText: "attempt," })
    .first()
    .locator("mark.qf-indent");
  await expect(deep).toHaveText("        ");
  const gradient = await deep.evaluate(
    (el) => getComputedStyle(el).backgroundImage,
  );
  expect(gradient).toContain("repeating-linear-gradient");

  // One level deep (< 2 units) carries no guide — no value, less DOM.
  await expect(
    section
      .locator(".qf-row:not(.qf-row-hunk)", { hasText: "let delay = 100;" })
      .locator("mark.qf-indent"),
  ).toHaveCount(0);
});

test("intraline emphasis is paint-only and survives find marks on top", async ({ page }) => {
  const row = page.locator(".qf-fsec").nth(2).locator(".qf-row-add").first();
  const before = await row.boundingBox();

  // Find marks layer over the intraline marks without displacing them. One
  // logical match ("1/1") renders as TWO mark fragments: the query spans the
  // intraline mark's text-node boundary, and marks wrap per text node.
  await page.keyboard.press("Control+f");
  await page.getByPlaceholder("Find in diff").fill("retryLimit");
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/1");
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(2);
  await expect(
    page.locator(".qf-fsec").nth(2).locator("mark.qf-intra-mark"),
  ).toHaveCount(2);

  const after = await row.boundingBox();
  expect(after).toEqual(before);

  const style = await page
    .locator("mark.qf-intra-mark")
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { padding: s.padding, margin: s.margin, border: s.borderWidth };
    });
  expect(style).toEqual({ padding: "0px", margin: "0px", border: "0px" });

  await page.keyboard.press("Escape");
});

test("overview ruler: find ticks map matches across the whole PR", async ({ page }) => {
  // No active marks → no ruler at all.
  await expect(page.locator(".qf-ruler")).toHaveCount(0);

  await page.keyboard.press("Control+f");
  await page.getByPlaceholder("Find in diff").fill("const");
  // "const" hits all three files: 1 in fuzzy.ts, 1 in search.ts, 7 in
  // retry.ts (whose section sits far below the viewport — ticks come from
  // the patch text plus section geometry, not from rendered rows).
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/9");
  const ticks = page.locator(".qf-ruler-tick");
  await expect(ticks).toHaveCount(9);
  await expect(page.locator(".qf-ruler-current")).toHaveCount(1);

  // Document order top to bottom: later files' ticks sit strictly lower.
  const ys = await ticks.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().y),
  );
  expect([...ys]).toEqual([...ys].sort((a, b) => a - b));
  expect(ys[ys.length - 1] - ys[0]).toBeGreaterThan(50);

  // Esc closes the bar; the find ticks go with it.
  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-ruler")).toHaveCount(0);
});

test("overview ruler: occurrence ticks on click, cleared by a blank click", async ({ page }) => {
  await clickToken(page, 1, "gamma");
  await expect(page.locator("mark.qf-occ-mark")).toHaveCount(2);
  await expect(page.locator(".qf-ruler-tick.qf-ruler-occ")).toHaveCount(2);
  // No "current" among occurrence ticks — that's a find-mode concept.
  await expect(page.locator(".qf-ruler-current")).toHaveCount(0);

  // A click on blank code clears the marks — and their ticks.
  const row = await page
    .locator(".qf-fsec")
    .nth(1)
    .locator(".qf-row:not(.qf-row-hunk) .qf-code")
    .first()
    .boundingBox();
  await page.mouse.click(row!.x + row!.width - 8, row!.y + row!.height / 2);
  await expect(page.locator("mark.qf-occ-mark")).toHaveCount(0);
  await expect(page.locator(".qf-ruler")).toHaveCount(0);
});

test("occurrence navigation: n/p and mark clicks jump between occurrences", async ({ page }) => {
  // "gamma" occurs twice in search.ts: on the "const gamma" row and the
  // "return gamma" row. Click the first one.
  await clickToken(page, 1, "gamma");
  const marks = page.locator("mark.qf-occ-mark");
  await expect(marks).toHaveCount(2);

  // n jumps to the NEXT occurrence relative to the clicked one — the row
  // flashes, and the marks survive the jump (navigation must not clear them).
  await page.keyboard.press("n");
  const flash = page.locator(".qf-row-flash");
  await expect(flash).toHaveCount(1);
  await expect(flash).toContainText("return gamma");
  await expect(marks).toHaveCount(2);

  // n again wraps around to the first occurrence.
  await page.keyboard.press("n");
  await expect(flash).toContainText("const gamma");

  // p steps backwards (wrapping the other way).
  await page.keyboard.press("p");
  await expect(flash).toContainText("return gamma");

  // Clicking a mark jumps to the occurrence after it: the LAST mark (on the
  // "return gamma" row) wraps forward to the first ("const gamma") row.
  const markBox = (await marks.nth(1).boundingBox())!;
  await page.mouse.move(markBox.x + markBox.width / 2, markBox.y + markBox.height / 2);
  await page.waitForTimeout(100); // settle the hover-driven row re-render
  await page.mouse.click(markBox.x + markBox.width / 2, markBox.y + markBox.height / 2);
  await expect(flash).toContainText("const gamma");
  await expect(marks).toHaveCount(2);

  // The occurrence ticks rode along untouched the whole time.
  await expect(page.locator(".qf-ruler-tick.qf-ruler-occ")).toHaveCount(2);
});
