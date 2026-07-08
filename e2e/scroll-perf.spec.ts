import { setupApp } from "./bridge.ts";
import { makeBigDetail, perfBudget } from "./fixtures.ts";
import { expect, test } from "./test.ts";

test.describe.configure({ retries: 2 });

const FILES = 16;
const LINES = 400;
const BIG_DETAIL = makeBigDetail(
  FILES,
  LINES,
  (f, i) => `const value_${f}_${i} = compute(${i} + ${f});`
);

test("scrolling a large PR stays smooth, with a bounded DOM", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await setupApp(page, { detailByLoad: [BIG_DETAIL] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-diff").first()).toBeVisible();
  await page.waitForTimeout(300);

  const projectName = test.info().project.name;
  const stallThresholdMs = projectName.startsWith("webkit") ? 100 : 50;
  const result = await page.evaluate(async (thresholdMs) => {
    function hostEl(): HTMLElement {
      const host = document.querySelector(".qf-scrollhost");
      if (!host) {
        throw new Error(".qf-scrollhost not found");
      }
      return host as HTMLElement;
    }

    const host = hostEl();
    const frames: number[] = [];
    let maxRows = 0;
    let last = performance.now();
    while (host.scrollTop + host.clientHeight < host.scrollHeight - 4) {
      host.scrollTop += 150;
      // biome-ignore lint/performance/noAwaitInLoops: scroll frames must be measured sequentially
      await new Promise((r) => requestAnimationFrame(r));
      const now = performance.now();
      frames.push(now - last);
      last = now;
      maxRows = Math.max(maxRows, document.querySelectorAll(".qf-row").length);
    }
    frames.sort((a, b) => a - b);
    if (frames.length === 0) {
      throw new Error("no scroll frames captured");
    }
    return {
      max: frames.at(-1),
      maxRows,
      n: frames.length,
      p50: frames[Math.floor(frames.length / 2)],
      p95: frames[Math.floor(frames.length * 0.95)],
      stalls: frames.filter((f) => f > thresholdMs).length,
    };
  }, stallThresholdMs);
  console.log(
    `scroll frames: n ${result.n} p50 ${result.p50.toFixed(1)} p95 ${result.p95.toFixed(1)} max ${result.max.toFixed(1)} over${stallThresholdMs}ms ${result.stalls} maxRows ${result.maxRows}`
  );

  expect(result.maxRows).toBeLessThan(300);
  expect(result.stalls).toBeLessThanOrEqual(4);
  expect(result.p95).toBeLessThan(perfBudget(50, projectName));
});

test("resuming deep in a large PR holds position while the list restores", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await setupApp(page, { detailByLoad: [BIG_DETAIL] });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator(".qf-diff").first()).toBeVisible();

  await page.locator('.qf-sidebar [data-file-index="8"]').click();
  await expect(
    page.locator('[data-anchor][data-file-index="8"]').first()
  ).toBeVisible();
  await page.evaluate(() => {
    const host = document.querySelector(".qf-scrollhost");
    if (!host) {
      throw new Error(".qf-scrollhost not found");
    }
    host.scrollTop += 200;
  });
  await page.waitForFunction(() => {
    const host = document.querySelector(".qf-scrollhost");
    if (!host) {
      return false;
    }
    const w = window as unknown as { __lastTop?: number; __stable?: number };
    if (w.__lastTop === host.scrollTop) {
      w.__stable = (w.__stable ?? 0) + 1;
    } else {
      w.__stable = 0;
      w.__lastTop = host.scrollTop;
    }
    return (w.__stable ?? 0) >= 5;
  });

  const before = await page.evaluate(() => {
    const host = document.querySelector(".qf-scrollhost");
    if (!host) {
      return null;
    }
    const hostTop = host.getBoundingClientRect().top;
    for (const row of document.querySelectorAll<HTMLElement>(
      '[data-anchor][data-file-index="8"]'
    )) {
      const top = row.getBoundingClientRect().top - hostTop;
      if (top >= 0) {
        const { anchor } = row.dataset;
        if (!anchor) {
          continue;
        }
        return { anchor, top };
      }
    }
    return null;
  });
  expect(before).not.toBeNull();
  await page.waitForTimeout(900);

  await page.reload();
  await expect(page.locator(".qf-diff").first()).toBeVisible();
  const rowSel = `[data-anchor="${before?.anchor}"][data-file-index="8"]`;
  await expect(page.locator(rowSel)).toBeVisible();

  const measure = () =>
    page.evaluate((sel) => {
      const host = document.querySelector(".qf-scrollhost");
      const row = document.querySelector(sel);
      if (!(host && row)) {
        return null;
      }
      return row.getBoundingClientRect().top - host.getBoundingClientRect().top;
    }, rowSel);
  const after = await measure();
  expect(after).not.toBeNull();
  expect(Math.abs((after as number) - before?.top)).toBeLessThan(40);
  await page.waitForTimeout(700);
  const settled = await measure();
  expect(Math.abs((settled as number) - (after as number))).toBeLessThan(24);
});
