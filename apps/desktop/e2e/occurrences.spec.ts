import { expect, test } from "./test";
import type { Page } from "@playwright/test";
import { setupApp } from "./bridge";

// Selection-occurrence highlighting: click a token (or select text) in the
// diff and its other occurrences light up (editor convention, VS Code-style).
// Single click goes through a caret-from-point word lookup; double-click and
// drags arrive as selections via selectionchange. Negative cases build the
// selection programmatically (Playwright can't drag-select "two spaces").

test.beforeEach(async ({ page }) => {
  await setupApp(page);
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});

/**
 * Viewport-centre of `token`'s first occurrence within a real (non-hunk) diff
 * code line of file section `section` — so the mouse can double-click the
 * exact word, wherever hljs tokenization put it.
 */
async function tokenCenter(page: Page, section: number, token: string) {
  const rect = await page.evaluate(
    ({ section, token }) => {
      const codes = document.querySelectorAll(
        `.qf-row[data-file-index="${section}"]:not(.qf-row-hunk) .qf-code`,
      );
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

async function dblclickToken(page: Page, section: number, token: string) {
  const { x, y } = await tokenCenter(page, section, token);
  // Settle the hover first (it moves the line cursor, re-rendering the row).
  // A real double-click always happens on an already-hovered row; firing
  // move+click+click in one burst instead races that re-render and Chromium
  // never registers the second click as a double.
  await page.mouse.move(x, y);
  await page.waitForTimeout(100);
  await page.mouse.dblclick(x, y);
}

/** Programmatically select `text` inside a diff code line (fires selectionchange). */
async function selectInCode(page: Page, section: number, text: string) {
  const ok = await page.evaluate(
    ({ section, text }) => {
      const codes = document.querySelectorAll(
        `.qf-row[data-file-index="${section}"]:not(.qf-row-hunk) .qf-code`,
      );
      for (const code of codes) {
        const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode as Text;
          const i = node.data.indexOf(text);
          if (i === -1) continue;
          const range = document.createRange();
          range.setStart(node, i);
          range.setEnd(node, i + text.length);
          const sel = window.getSelection()!;
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }
      }
      return false;
    },
    { section, text },
  );
  if (!ok) throw new Error(`text not found in diff: ${text}`);
}

const occMarks = (page: Page) => page.locator("mark.qf-occ-mark");

test("single-clicking a token marks its occurrences within that file", async ({ page }) => {
  // "return" sits on the -/+ pair in fuzzy.ts AND once in search.ts — but
  // marks are scoped to the clicked file: repainting one section keeps a
  // click instant on huge PRs, and cross-file search is the find bar's job.
  const { x, y } = await tokenCenter(page, 0, "return");
  await page.mouse.move(x, y);
  await page.waitForTimeout(100); // settle the hover-driven row re-render
  await page.mouse.click(x, y);
  await expect(occMarks(page)).toHaveCount(2);
  expect(await occMarks(page).allTextContents()).toEqual(["return", "return"]);
  await expect(
    page.locator('.qf-row[data-file-index="1"] mark.qf-occ-mark'),
  ).toHaveCount(0);

  // Clicking another token retargets the marks to it.
  const alpha = await tokenCenter(page, 0, "alpha");
  await page.mouse.click(alpha.x, alpha.y);
  await expect(occMarks(page).first()).toHaveText("alpha");

  // Clicking blank code (not a word) clears them.
  const row = await page
    .locator('.qf-row[data-file-index="0"]:not(.qf-row-hunk) .qf-code')
    .first()
    .boundingBox();
  await page.mouse.click(row!.x + row!.width - 8, row!.y + row!.height / 2);
  await expect(occMarks(page)).toHaveCount(0);
});

test("double-clicking a token marks its occurrences", async ({ page }) => {
  await dblclickToken(page, 0, "return");
  await expect(occMarks(page)).toHaveCount(2);
});

test("clicking blank space right of a line ending in a word clears, not highlights", async ({ page }) => {
  // Arm some marks first so the clear is observable.
  await dblclickToken(page, 1, "gamma");
  await expect(occMarks(page)).toHaveCount(2);

  // "export default search" ends in a WORD character. Caret-from-point snaps
  // a click in the blank area to the nearest text position — the end of
  // "search" — and without the glyph-box guard that would highlight "search"
  // instead of reading as blank.
  const lineEnd = await page.evaluate(() => {
    const codes = document.querySelectorAll(
      '.qf-row[data-file-index="1"]:not(.qf-row-hunk) .qf-code',
    );
    for (const code of codes) {
      if (!code.textContent?.includes("export default search")) continue;
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      let last: Text | null = null;
      while (walker.nextNode()) last = walker.currentNode as Text;
      const range = document.createRange();
      range.selectNodeContents(last!);
      const r = range.getBoundingClientRect();
      return { x: r.right, y: r.y + r.height / 2 };
    }
    return null;
  });
  await page.mouse.click(lineEnd!.x + 60, lineEnd!.y);
  await expect(occMarks(page)).toHaveCount(0);
});

test("marks are paint-only — the line's geometry does not move", async ({ page }) => {
  const codeLine = page
    .locator('.qf-row[data-file-index="1"]:not(.qf-row-hunk) .qf-code')
    .first();
  const before = await codeLine.boundingBox();

  await dblclickToken(page, 1, "gamma");
  await expect(occMarks(page)).toHaveCount(2);

  const after = await codeLine.boundingBox();
  expect(after).toEqual(before);
  // The mark itself must not introduce box spacing.
  const style = await occMarks(page).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return { padding: s.padding, margin: s.margin, border: s.borderWidth };
  });
  expect(style).toEqual({ padding: "0px", margin: "0px", border: "0px" });
});

test("whitespace or single-character selections mark nothing", async ({ page }) => {
  // Prove marks CAN appear first, so the zero-counts below are meaningful
  // (the debounce would otherwise make "no marks yet" pass vacuously).
  await dblclickToken(page, 1, "gamma");
  await expect(occMarks(page)).toHaveCount(2);

  await selectInCode(page, 1, "q"); // 1 char — below the minimum
  await expect(occMarks(page)).toHaveCount(0);

  await dblclickToken(page, 1, "gamma");
  await expect(occMarks(page)).toHaveCount(2);

  await selectInCode(page, 1, "  "); // whitespace only
  await expect(occMarks(page)).toHaveCount(0);
});

test("the find bar suppresses occurrence marks; closing it restores them", async ({ page }) => {
  await dblclickToken(page, 1, "gamma");
  await expect(occMarks(page)).toHaveCount(2);

  // Find wins while its bar is open — the selection even seeds its query
  // (browser convention), so its marks take over the same occurrences.
  await page.keyboard.press("Control+f");
  await expect(page.locator(".qf-findbar")).toBeVisible();
  await expect(occMarks(page)).toHaveCount(0);
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(2);

  // Closing the bar hands the diff back to the still-live selection.
  await page.keyboard.press("Escape");
  await expect(page.locator(".qf-findbar")).toHaveCount(0);
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(0);
  await expect(occMarks(page)).toHaveCount(2);
});

test("Esc goes straight to the inbox — occurrence marks don't consume it", async ({ page }) => {
  await dblclickToken(page, 1, "gamma");
  await expect(occMarks(page)).toHaveCount(2);

  // Marks are passive furniture: Esc must not spend a press on them.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /Review requests/ })).toBeVisible();
});
