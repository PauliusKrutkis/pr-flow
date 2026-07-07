import type { Page } from "@playwright/test";
import { setupApp } from "./bridge.ts";
import { expect, test } from "./test.ts";

/**
 * Viewport-centre of `token`'s first occurrence within a real (non-hunk) diff
 * code line of file section `section` (same helper as occurrences.spec.ts).
 */
async function tokenCenter(page: Page, section: number, token: string) {
  const rect = await page.evaluate(
    ({ section, token }) => {
      const codes = document.querySelectorAll(
        `.qf-row[data-file-index="${section}"]:not(.qf-row-hunk) .qf-code`
      );
      for (const code of codes) {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const i = node.data.indexOf(token);
          if (i === -1) {
            continue;
          }
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + token.length);
          const r = range.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }
      }
      return null;
    },
    { section, token }
  );
  if (!rect) {
    throw new Error(`token not found in diff: ${token}`);
  }
  return rect;
}

/** Single-click a token (settling the hover first, like a real pointer). */
async function clickToken(page: Page, section: number, token: string) {
  const { x, y } = await tokenCenter(page, section, token);
  await page.mouse.move(x, y);
  await page.waitForTimeout(100);
  await page.mouse.click(x, y);
}

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

test("a clean rename emphasizes exactly the changed word pieces", async ({
  page,
}) => {
  const marks = page.locator('.qf-row[data-file-index="2"] mark.qf-intra-mark');
  await expect(marks).toHaveCount(2);
  expect(await marks.allTextContents()).toEqual(["Count", "Limit"]);
  await expect(
    page.locator('.qf-row-del[data-file-index="2"] mark.qf-intra-mark')
  ).toHaveText("Count");
  await expect(
    page.locator('.qf-row-add[data-file-index="2"] mark.qf-intra-mark')
  ).toHaveText("Limit");
});

test("a rewrite pair fails the noise guard and renders without emphasis", async ({
  page,
}) => {
  await expect(page.locator('.qf-row-del[data-file-index="0"]')).toHaveCount(1);
  await expect(
    page.locator('.qf-row[data-file-index="0"] mark.qf-intra-mark')
  ).toHaveCount(0);
});

test("clicking inside an intraline-emphasized token still selects the whole word", async ({
  page,
}) => {
  const target = page.locator('.qf-row-add[data-file-index="2"]', {
    hasText: "retryLimit",
  });
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(200); // settle scroll + hover re-render
  const pos = await target.locator(".qf-code").evaluate((code) => {
    const w = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode as Text;
      const i = n.data.indexOf("retry");
      if (i === -1) {
        continue;
      }
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 5);
      const b = r.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }
    return null;
  });
  await page.mouse.move(pos!.x, pos!.y);
  await page.waitForTimeout(100);
  await page.mouse.click(pos!.x, pos!.y);

  const marks = page.locator('.qf-row[data-file-index="2"] mark.qf-occ-mark');
  await expect(marks.first()).toBeVisible();
  expect((await marks.allTextContents()).join("")).toBe("retryLimit");
});

test("indent guides paint on deep lines' code element, and nothing else", async ({
  page,
}) => {
  const deep = page
    .locator('.qf-row[data-file-index="2"]:not(.qf-row-hunk)', {
      hasText: "attempt,",
    })
    .first()
    .locator(".qf-code");
  const style = await deep.evaluate((el) => {
    const s = getComputedStyle(el, "::before");
    return {
      image: s.backgroundImage,
      lvl: (el as HTMLElement).style.getPropertyValue("--qf-lvl"),
      width: s.width,
    };
  });
  expect(style.lvl).toBe("4");
  expect(style.image).toContain("repeating-linear-gradient");
  expect(Number.parseFloat(style.width)).toBeGreaterThan(0);

  const drift = await deep.evaluate((el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    w.nextNode();
    const n = w.currentNode as Text;
    const r = document.createRange();
    r.setStart(n, 0);
    r.setEnd(n, 8); // 4 levels × 2-space unit
    const spaces = r.getBoundingClientRect().width;
    const before = Number.parseFloat(getComputedStyle(el, "::before").width);
    return Math.abs(before - (spaces - 1));
  });
  expect(drift).toBeLessThan(0.35);
  await expect(
    page.locator('.qf-row[data-file-index="2"] mark.qf-indent')
  ).toHaveCount(0);

  const shallow = page
    .locator('.qf-row[data-file-index="2"]:not(.qf-row-hunk)', {
      hasText: "let delay = 100;",
    })
    .first()
    .locator(".qf-code");
  await expect(shallow).toHaveAttribute("style", /--qf-lvl:\s*1/);

  const flat = page
    .locator('.qf-row[data-file-index="2"]:not(.qf-row-hunk)', {
      hasText: "export function withRetry",
    })
    .first()
    .locator(".qf-code");
  const flatW = await flat.evaluate(
    (el) => getComputedStyle(el, "::before").width
  );
  expect(Number.parseFloat(flatW) > 0).toBe(false);
});

test("intraline emphasis is paint-only and survives find marks on top", async ({
  page,
}) => {
  const row = page.locator('.qf-row-add[data-file-index="2"]').first();
  const before = await row.boundingBox();

  await page.keyboard.press("Control+f");
  await page.getByPlaceholder("Find in diff").fill("retryLimit");
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/1");
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(2);
  await expect(
    page.locator('.qf-row[data-file-index="2"] mark.qf-intra-mark')
  ).toHaveCount(2);

  const after = await row.boundingBox();
  expect(after).toEqual(before);

  const style = await page
    .locator("mark.qf-intra-mark")
    .first()
    .evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderWidth, margin: s.margin, padding: s.padding };
    });
  expect(style).toEqual({ border: "0px", margin: "0px", padding: "0px" });

  await page.keyboard.press("Escape");
});

test("overview ruler: find ticks map matches across the whole PR", async ({
  page,
}) => {
  await expect(page.locator(".qf-ruler")).toHaveCount(0);

  await page.keyboard.press("Control+f");
  await page.getByPlaceholder("Find in diff").fill("const");
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/9");
  const ticks = page.locator(".qf-ruler-tick");
  await expect(ticks).toHaveCount(9);
  await expect(page.locator(".qf-ruler-current")).toHaveCount(1);

  const ys = await ticks.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().y)
  );
  expect([...ys]).toEqual([...ys].sort((a, b) => a - b));
  expect(ys[ys.length - 1] - ys[0]).toBeGreaterThan(50);

  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-ruler")).toHaveCount(0);
});

test("overview ruler: occurrence ticks on click, cleared by a blank click", async ({
  page,
}) => {
  await clickToken(page, 1, "gamma");
  await expect(page.locator("mark.qf-occ-mark")).toHaveCount(2);
  await expect(page.locator(".qf-ruler-tick.qf-ruler-occ")).toHaveCount(2);
  await expect(page.locator(".qf-ruler-current")).toHaveCount(0);

  const row = await page
    .locator('.qf-row[data-file-index="1"]:not(.qf-row-hunk) .qf-code')
    .first()
    .boundingBox();
  await page.mouse.click(row!.x + row!.width - 8, row!.y + row!.height / 2);
  await expect(page.locator("mark.qf-occ-mark")).toHaveCount(0);
  await expect(page.locator(".qf-ruler")).toHaveCount(0);
});

test("occurrence navigation: n/p and mark clicks jump between occurrences", async ({
  page,
}) => {
  await clickToken(page, 1, "gamma");
  const marks = page.locator("mark.qf-occ-mark");
  await expect(marks).toHaveCount(2);

  await page.keyboard.press("n");
  const flash = page.locator(".qf-row-flash");
  await expect(flash).toHaveCount(1);
  await expect(flash).toContainText("return gamma");
  await expect(marks).toHaveCount(2);

  await page.keyboard.press("n");
  await expect(flash).toContainText("const gamma");

  await page.keyboard.press("p");
  await expect(flash).toContainText("return gamma");

  const markBox = (await marks.nth(1).boundingBox())!;
  await page.mouse.move(
    markBox.x + markBox.width / 2,
    markBox.y + markBox.height / 2
  );
  await page.waitForTimeout(100); // settle the hover-driven row re-render
  await page.mouse.click(
    markBox.x + markBox.width / 2,
    markBox.y + markBox.height / 2
  );
  await expect(flash).toContainText("const gamma");
  await expect(marks).toHaveCount(2);

  await expect(page.locator(".qf-ruler-tick.qf-ruler-occ")).toHaveCount(2);
});
