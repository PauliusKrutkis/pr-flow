import { expect, test } from "./test";
import { setupApp } from "./bridge";
import { makeBigDetail, perfBudget } from "./fixtures";

// Scroll-smoothness guard. Sections used to mount inside scrolled frames
// (IntersectionObserver + a synchronous 400-row render ≈ a 110–160ms frozen
// frame per file — what "janky sticky headers" feels like). The idle
// pre-mounter now builds sections while you read, so scrolling lands on
// existing DOM; this spec pins that: after the pre-mount settles, a full
// top-to-bottom scroll of a 6,400-row PR must stay stall-free.

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

test("scrolling a large PR stays smooth once idle pre-mount settles", async ({ page }) => {
  test.setTimeout(120_000);
  await setupApp(page, { detailByLoad: [BIG_DETAIL] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-diff").first()).toBeVisible();

  // The idle pre-mounter builds one section per idle slice; wait until every
  // row exists (this also asserts the pre-mounter itself keeps working).
  await page.waitForFunction(
    (want) => document.querySelectorAll(".qf-row").length >= want,
    FILES * LINES,
    { timeout: 30_000 },
  );

  // What counts as a stall scales with the engine baseline: headless WebKit
  // software-renders at ~35ms/frame, so its ordinary frames brush past the
  // 50ms that is already alarming on Chromium. Mount-stall regressions sit
  // at 100ms+ on BOTH engines — safely past either threshold.
  const projectName = test.info().project.name;
  const stallMs = projectName.startsWith("webkit") ? 100 : 50;
  const result = await page.evaluate(async (stallMs) => {
    const host = document.querySelector(".qf-scrollhost")!;
    const frames: number[] = [];
    let last = performance.now();
    while (host.scrollTop + host.clientHeight < host.scrollHeight - 4) {
      host.scrollTop += 150;
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
    }
    frames.sort((a, b) => a - b);
    return {
      n: frames.length,
      p50: frames[Math.floor(frames.length / 2)],
      p95: frames[Math.floor(frames.length * 0.95)],
      max: frames[frames.length - 1],
      stalls: frames.filter((f) => f > stallMs).length,
    };
  }, stallMs);
  console.log(
    `scroll frames: n ${result.n} p50 ${result.p50.toFixed(1)} p95 ${result.p95.toFixed(1)} max ${result.max.toFixed(1)} over${stallMs}ms ${result.stalls}`,
  );

  // Mount-stall regressions produce ~15 stall frames on this fixture — far
  // past these bounds. Measured clean: zero stalls on either engine; the
  // slack absorbs GC blips and parallel-worker CPU contention.
  expect(result.stalls).toBeLessThanOrEqual(4);
  expect(result.p95).toBeLessThan(perfBudget(50, projectName));
});
