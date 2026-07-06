import { expect, test } from "./test";
import type { Page } from "@playwright/test";
import { setupApp } from "./bridge";
import { makeBigDetail, perfBudget } from "./fixtures";

// Find-in-diff performance guard, virtualized edition. The review scroll is
// ONE virtualized list (react-virtuoso), so only ~a viewport of rows exists
// no matter the PR size — keystroke cost is viewport-bounded BY CONSTRUCTION.
// This spec pins that construction:
//
//  1. Structurally: the rendered row count stays bounded on a 6,400-row PR,
//     and a MutationObserver counts how many .qf-code elements mutate per
//     keystroke — bounded by the rendered set, never the PR.
//  2. As a wall-clock budget: keystroke → second frame stays under a bound
//     that a regression to PR-sized work (uncached scans, full-list renders)
//     blows through.

// Wall-clock budgets flake when parallel workers compete for CPU; a genuine
// regression fails every attempt, contention doesn't survive a retry.
test.describe.configure({ retries: 2 });

const FILES = 16;
const LINES = 400;
// "zebra" lands on 3 lines per file (rows 75/225/375); no other fixture word
// shares a letter with it, so every prefix ("z", "ze", …) matches exactly
// those rows and the per-keystroke mutation count stays flat while typing.
const MATCH_ROWS = FILES * 3;
// The virtualization dividend: however big the PR, the DOM stays around a
// viewport (+ overscan) of rows. 200 is ~4× the typical rendered set.
const RENDERED_CAP = 200;

const BIG_DETAIL = makeBigDetail(FILES, LINES, (f, i) =>
  i % 150 === 75
    ? `const zebra_${f}_${i} = herd(${i});`
    : `const value_${f}_${i} = compute(${i} + ${f});`,
);

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
    input.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
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
});

test("typing in the find bar repaints the viewport, not the PR", async ({ page }) => {
  test.setTimeout(60_000);
  // The virtualization dividend, asserted: a 6,400-row PR renders a bounded
  // slice of rows.
  const rendered = await page.locator(".qf-row:not(.qf-row-hunk)").count();
  expect(rendered).toBeGreaterThan(10);
  expect(rendered).toBeLessThan(RENDERED_CAP);

  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Find in diff")).toBeFocused();

  // Warm up (dev-runtime/JIT + scan caches), then a settle pause so warmup
  // GC lands before the measured window.
  for (const ch of "zz") await keystroke(page, ch);
  await keystroke(page, "\b");
  await keystroke(page, "\b");
  await page.waitForTimeout(300);

  const times: number[] = [];
  for (const ch of "zebra") {
    const [ms, repainted] = await keystroke(page, ch);
    times.push(ms);
    // The tight guard: repaints bounded by the rendered set — a regression
    // that renders (or repaints) the whole PR is two orders past this.
    expect(repainted).toBeLessThanOrEqual(RENDERED_CAP);
  }
  // The counter counts across the WHOLE PR (patch text); the marks on screen
  // are whatever matches sit in the rendered slice.
  await expect(page.locator(".qf-findbar-count")).toHaveText(`1/${MATCH_ROWS}`);

  // Narrowing further exercises the clear-and-shrink path; keep timing.
  for (const ch of "_1_7") {
    const [ms, repainted] = await keystroke(page, ch);
    times.push(ms);
    expect(repainted).toBeLessThanOrEqual(RENDERED_CAP);
  }
  await expect(page.locator(".qf-findbar-count")).toHaveText("1/1");

  // Wall-clock budget on the warm steady state, as the MEDIAN (dev pages
  // throw one-off GC pauses; a real regression shifts every keystroke).
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  console.log(
    `find keystrokes ms: [${times.map((t) => t.toFixed(1)).join(", ")}] median ${median.toFixed(1)}`,
  );
  // ~35ms solo on the dev runtime; parallel-suite contention runs 2-4×. The
  // structural guards above are the tight net — this only trips gross,
  // PR-sized regressions.
  expect(median).toBeLessThan(perfBudget(150, test.info().project.name));
});

test("typing right after open stays smooth", async ({ page }) => {
  // Cold caches, first render just happened — the first thing a reviewer
  // does must not stutter.
  test.setTimeout(60_000);
  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Find in diff")).toBeFocused();

  const times: number[] = [];
  for (const ch of "zebra_1_7") {
    const [ms] = await keystroke(page, ch);
    times.push(ms);
    await page.waitForTimeout(120); // human typing cadence
  }
  const median = [...times].sort((a, b) => a - b)[Math.floor(times.length / 2)];
  console.log(
    `post-open keystrokes ms: [${times.map((t) => t.toFixed(1)).join(", ")}] median ${median.toFixed(1)}`,
  );
  expect(median).toBeLessThan(perfBudget(130, test.info().project.name));
});

test("a keystroke that clears all matches repaints only the marked rows", async ({ page }) => {
  test.setTimeout(60_000);
  await page.keyboard.press("Control+f");
  await expect(page.getByPlaceholder("Find in diff")).toBeFocused();
  for (const ch of "zebra") await keystroke(page, ch);
  // Jump to the current match so marked rows are in the rendered slice.
  await page.keyboard.press("Enter");
  await expect(page.locator("mark.qf-find-mark").first()).toBeVisible();
  const marked = await page.locator("mark.qf-find-mark").count();

  // "zebraq" matches nothing: every marked row must clear — and only those
  // rows (plus the odd cursor/flash neighbour) may repaint.
  const [, repainted] = await keystroke(page, "q");
  await expect(page.locator("mark.qf-find-mark")).toHaveCount(0);
  expect(repainted).toBeLessThanOrEqual(marked + 8);
});
