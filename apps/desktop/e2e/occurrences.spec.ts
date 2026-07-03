import { expect, test, type Page } from "@playwright/test";
import { setupApp } from "./bridge";

// Selection-occurrence highlighting: selecting a token in the diff quietly
// marks its other occurrences (editor convention). The positive path drives a
// real double-click — the feature listens to selectionchange, and double-click
// word selection must arrive through that same path; negative cases build the
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
      const sec = document.querySelectorAll(".qf-fsec")[section];
      const codes = sec?.querySelectorAll(".qf-row:not(.qf-row-hunk) .qf-code") ?? [];
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
      const sec = document.querySelectorAll(".qf-fsec")[section];
      const codes = sec?.querySelectorAll(".qf-row:not(.qf-row-hunk) .qf-code") ?? [];
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

test("double-clicking a token marks every whole-word occurrence across files", async ({ page }) => {
  // "return" sits on three rendered rows: the -/+ pair in fuzzy.ts and one
  // line in search.ts — cross-file, and the deleted (LEFT) row counts too.
  await dblclickToken(page, 0, "return");
  await expect(occMarks(page)).toHaveCount(3);
  expect(await occMarks(page).allTextContents()).toEqual([
    "return",
    "return",
    "return",
  ]);

  // A plain click collapses the selection — the marks follow it out.
  const { x, y } = await tokenCenter(page, 0, "alpha");
  await page.mouse.click(x, y);
  await expect(occMarks(page)).toHaveCount(0);
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

test("Esc clears occurrence marks and stays on the review", async ({ page }) => {
  await dblclickToken(page, 1, "gamma");
  await expect(occMarks(page)).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(occMarks(page)).toHaveCount(0);
  // Esc consumed the marks layer — not bounced back to the inbox.
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
});
