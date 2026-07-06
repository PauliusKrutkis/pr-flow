import { expect, test } from "./test";
import { setupApp } from "./bridge";
import { makeBigDetail, perfBudget } from "./fixtures";

// Scroll-smoothness guard, virtualized edition. The review scroll renders a
// bounded slice of rows and materializes new ones as they enter the window —
// there are no section mounts to stall a frame, and no pre-mounter to wait
// for. This spec scrolls a 6,400-row PR top to bottom immediately after open
// and requires stall-free frames plus a bounded DOM the whole way.

// Wall-clock budgets flake when parallel workers compete for CPU; a genuine
// regression fails every attempt, contention doesn't survive a retry.
test.describe.configure({ retries: 2 });

const FILES = 16;
const LINES = 400;
const BIG_DETAIL = makeBigDetail(
  FILES,
  LINES,
  (f, i) => `const value_${f}_${i} = compute(${i} + ${f});`,
);

test("scrolling a large PR stays smooth, with a bounded DOM", async ({ page }) => {
  test.setTimeout(120_000);
  await setupApp(page, { detailByLoad: [BIG_DETAIL] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-diff").first()).toBeVisible();
  await page.waitForTimeout(300);

  // What counts as a stall scales with the engine baseline: headless WebKit
  // software-renders at ~35ms/frame, so its ordinary frames brush past the
  // 50ms that is already alarming on Chromium.
  const projectName = test.info().project.name;
  const stallMs = projectName.startsWith("webkit") ? 100 : 50;
  const result = await page.evaluate(async (stallMs) => {
    const host = document.querySelector(".qf-scrollhost")!;
    const frames: number[] = [];
    let maxRows = 0;
    let last = performance.now();
    while (host.scrollTop + host.clientHeight < host.scrollHeight - 4) {
      host.scrollTop += 150;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
      maxRows = Math.max(maxRows, document.querySelectorAll(".qf-row").length);
    }
    frames.sort((a, b) => a - b);
    return {
      n: frames.length,
      p50: frames[Math.floor(frames.length / 2)],
      p95: frames[Math.floor(frames.length * 0.95)],
      max: frames[frames.length - 1],
      stalls: frames.filter((f) => f > stallMs).length,
      maxRows,
    };
  }, stallMs);
  console.log(
    `scroll frames: n ${result.n} p50 ${result.p50.toFixed(1)} p95 ${result.p95.toFixed(1)} max ${result.max.toFixed(1)} over${stallMs}ms ${result.stalls} maxRows ${result.maxRows}`,
  );

  // The DOM never grows past a viewport-ish slice — the property every other
  // bound rests on.
  expect(result.maxRows).toBeLessThan(300);
  expect(result.stalls).toBeLessThanOrEqual(4);
  expect(result.p95).toBeLessThan(perfBudget(50, projectName));
});

test("resuming deep in a large PR holds position while the list restores", async ({ page }) => {
  test.setTimeout(120_000);
  await setupApp(page, { detailByLoad: [BIG_DETAIL] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-diff").first()).toBeVisible();

  // Jump deep (file 9, via the sidebar) and nudge into it.
  await page.locator('.qf-sidebar [data-file-index="8"]').click();
  await expect(
    page.locator('[data-anchor][data-file-index="8"]').first(),
  ).toBeVisible();
  await page.evaluate(() => {
    document.querySelector(".qf-scrollhost")!.scrollTop += 200;
  });
  const before = await page.evaluate(() => {
    const host = document.querySelector(".qf-scrollhost")!;
    const row = document.querySelector('[data-anchor][data-file-index="8"]')!;
    return row.getBoundingClientRect().top - host.getBoundingClientRect().top;
  });
  // Let the scroll-state snapshot (300ms) + review-memory write (400ms) flush.
  await page.waitForTimeout(900);

  await page.reload();
  await expect(page.locator(".qf-diff").first()).toBeVisible();
  await expect(
    page.locator('[data-anchor][data-file-index="8"]').first(),
  ).toBeVisible();

  const measure = () =>
    page.evaluate(() => {
      const host = document.querySelector(".qf-scrollhost")!;
      const row = document.querySelector('[data-anchor][data-file-index="8"]');
      if (!row) return null;
      return row.getBoundingClientRect().top - host.getBoundingClientRect().top;
    });
  const after = await measure();
  expect(after).not.toBeNull();
  expect(Math.abs((after as number) - before)).toBeLessThan(40);
  // …and it holds — no post-paint drift.
  await page.waitForTimeout(700);
  const settled = await measure();
  expect(Math.abs((settled as number) - (after as number))).toBeLessThan(24);
});
