import { expect, test, type Page } from "@playwright/test";
import { setupApp } from "./bridge";
import { makeBigDetail } from "./fixtures";

// Find-in-diff performance guard. Typing in the find bar used to repaint the
// innerHTML of EVERY rendered diff row per keystroke; the fix gates mark props
// per row so only rows whose match state changed repaint. This spec pins that
// behavior two ways:
//
//  1. Structurally (the tight, deterministic guard): a MutationObserver counts
//     how many .qf-code elements mutate per keystroke. With ~3600 rendered
//     rows and 24 matching rows, the count must stay near 24 — if a change
//     re-breaks the row gating, this jumps to ~3600 and fails loudly on any
//     machine, fast or slow.
//  2. As a wall-clock budget (the gross backstop): keystroke → second frame
//     must stay under a generous bound, so a regression that keeps mutations
//     low but adds per-keystroke CPU (say, an uncached re-parse of every
//     patch) still trips something.

// Wall-clock budgets flake when parallel workers compete for CPU; a genuine
// regression fails every attempt, contention doesn't survive a retry.
test.describe.configure({ retries: 2 });

const FILES = 12;
const LINES = 300;
// "zebra" lands on 2 lines per file; no other fixture word shares a letter
// with it, so every prefix ("z", "ze", …) matches exactly those 24 rows and
// the per-keystroke mutation count stays flat while typing.
const MATCH_ROWS = FILES * 2;

const BIG_DETAIL = makeBigDetail(FILES, LINES, (f, i) =>
  i % 150 === 75
    ? `const zebra_${f}_${i} = herd(${i});`
    : `const value_${f}_${i} = compute(${i} + ${f});`,
);

/** Scroll the review pane to the bottom so every windowed section mounts
 *  (mounted sections never unmount — this is the realistic worst case for a
 *  reviewer who has scrolled through the PR before searching). */
async function mountAllSections(page: Page) {
  await page.waitForFunction(
    (want) => {
      const host = document.querySelector(".qf-scrollhost");
      if (!host) return false;
      host.scrollTop = host.scrollTop + host.clientHeight * 2;
      const atEnd =
        host.scrollTop + host.clientHeight >= host.scrollHeight - 2;
      return atEnd && document.querySelectorAll(".qf-row").length >= want;
    },
    FILES * LINES,
    { polling: 100, timeout: 30_000 },
  );
}

/** Dispatch one real (React-visible) keystroke into the find input ("\b" =
 *  backspace) and return [elapsed ms to the second following frame, distinct
 *  .qf-code repainted]. */
async function keystroke(page: Page, ch: string): Promise<[number, number]> {
  return page.evaluate(async (ch) => {
    const input = document.querySelector<HTMLInputElement>(".qf-findbar-input")!;
    const mutated = new Set<Element>();
    const observer = new MutationObserver((muts) => {
      for (const m of muts) {
        const el =
          m.target instanceof Element ? m.target : m.target.parentElement;
        const code = el?.closest?.(".qf-code");
        if (code) mutated.add(code);
      }
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    const t0 = performance.now();
    setValue.call(
      input,
      ch === "\b" ? input.value.slice(0, -1) : input.value + ch,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // Two frames: the first paints the React commit, the second proves the
    // main thread came back up for air.
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
    const elapsed = performance.now() - t0;
    observer.disconnect();
    return [elapsed, mutated.size] as [number, number];
  }, ch);
}

test.beforeEach(async ({ page }) => {
  await setupApp(page, { detailByLoad: [BIG_DETAIL] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-fsec-head").first()).toBeVisible();
  await mountAllSections(page);
});

test("typing in the find bar repaints matching rows, not the whole diff", async ({ page }) => {
  test.setTimeout(60_000);
  const rendered = await page.locator(".qf-row:not(.qf-row-hunk)").count();
  expect(rendered).toBeGreaterThanOrEqual(FILES * LINES);

  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Find in diff")).toBeFocused();

  // Warm up: the FIRST couple of keystrokes pay one-time costs that say
  // nothing about typing responsiveness — dev-runtime/JIT warmup and the
  // per-patch scan caches. (The dev server runs React's dev runtime, whose
  // jsxDEV element creation alone is several times the production cost.)
  // Then a settle pause so the major GC of the warmup's render garbage lands
  // before, not inside, the measured window. The budget below guards the
  // steady state a typing user actually feels.
  for (const ch of "zz") await keystroke(page, ch);
  await keystroke(page, "\b");
  await keystroke(page, "\b");
  await page.waitForTimeout(300);

  const times: number[] = [];
  for (const ch of "zebra") {
    const [ms, repainted] = await keystroke(page, ch);
    times.push(ms);
    // The tight guard: per keystroke, repaints stay in the neighbourhood of
    // the 24 matching rows (clears + paints + the odd extra), nowhere near
    // the ~3600 rendered rows a full repaint would touch.
    expect(repainted).toBeLessThanOrEqual(MATCH_ROWS * 3);
  }
  // The marks on screen agree with the counter (2 per file, every file).
  await expect(page.locator(".qf-findbar-count")).toHaveText(`1/${MATCH_ROWS}`);
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(MATCH_ROWS);

  // Narrowing further exercises the clear-and-shrink path; keep timing.
  for (const ch of "_1_7") {
    const [ms, repainted] = await keystroke(page, ch);
    times.push(ms);
    expect(repainted).toBeLessThanOrEqual(MATCH_ROWS * 3);
  }
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/1");

  // Wall-clock budget on the warm steady state, as the MEDIAN: ~40ms per
  // keystroke on a dev box under the dev runtime (production is far cheaper —
  // dev-mode element creation dominates what's left). The median is the
  // right statistic here: the dev page throws occasional one-off ~200ms GC
  // pauses that say nothing about the code, while a real regression (per-row
  // scanning, layout-forcing effects, full repaints) shifts EVERY keystroke
  // and moves the median with it. Logged so CI runs leave a trend.
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  console.log(
    `find keystrokes ms: [${times.map((t) => t.toFixed(1)).join(", ")}] median ${median.toFixed(1)}`,
  );
  expect(median).toBeLessThan(100);
});

test("a keystroke that clears all matches repaints only the previously marked rows", async ({ page }) => {
  test.setTimeout(60_000);
  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Find in diff")).toBeFocused();
  for (const ch of "zebra") await keystroke(page, ch);
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(MATCH_ROWS);

  // "zebraq" matches nothing: the 24 marked rows must clear — and ONLY they
  // may repaint.
  const [, repainted] = await keystroke(page, "q");
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(0);
  expect(repainted).toBeLessThanOrEqual(MATCH_ROWS + 6);
  expect(repainted).toBeGreaterThanOrEqual(MATCH_ROWS);
});
