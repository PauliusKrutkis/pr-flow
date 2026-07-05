import { expect, test } from "./test";
import type { Page } from "@playwright/test";
import { setupApp } from "./bridge";
import { makeBigDetail, perfBudget } from "./fixtures";

// PR-open latency guard: inbox → Enter → diff rows painted, measured inside
// the page (keydown to the second frame after the diff exists), on the same
// large synthetic PR the find-perf spec uses. This is the app's hottest
// perceived-performance path — the perf overlay's "north star" — so a budget
// lives in CI next to the find one.

// Wall-clock budgets flake when parallel workers compete for CPU; a genuine
// regression fails every attempt, contention doesn't survive a retry.
test.describe.configure({ retries: 2 });

const FILES = 12;
const LINES = 300;
const BIG_DETAIL = makeBigDetail(
  FILES,
  LINES,
  (f, i) => `const value_${f}_${i} = compute(${i} + ${f});`,
);

/** Arm an in-page stopwatch: Enter keydown → diff present → second frame. */
async function armOpenTimer(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __openMs: Promise<number> };
    w.__openMs = new Promise((resolve) => {
      window.addEventListener(
        "keydown",
        function onKey(e: KeyboardEvent) {
          if (e.key !== "Enter") return;
          window.removeEventListener("keydown", onKey, true);
          const t0 = performance.now();
          const check = () => {
            if (document.querySelector(".qf-diff")) {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(performance.now() - t0)),
              );
            } else {
              requestAnimationFrame(check);
            }
          };
          check();
        },
        true,
      );
    });
  });
}

async function openMs(page: Page): Promise<number> {
  await armOpenTimer(page);
  await page.keyboard.press("Enter");
  const ms = await page.evaluate(
    () => (window as unknown as { __openMs: Promise<number> }).__openMs,
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option").first()).toBeVisible();
  return ms;
}

test("opening a PR from cache stays fast", async ({ page }) => {
  test.setTimeout(60_000);
  await setupApp(page, { detailByLoad: [BIG_DETAIL] });
  await expect(page.getByRole("option").first()).toBeVisible();

  // First open pays one-time costs (highlighting the mounted rows, JIT); the
  // budget guards the WARM path — reopening a PR whose detail is already in
  // the query cache, which is the "even from cache it feels slow" complaint.
  const cold = await openMs(page);
  const warm: number[] = [];
  for (let i = 0; i < 3; i++) warm.push(await openMs(page));
  const avg = warm.reduce((a, b) => a + b, 0) / warm.length;
  console.log(
    `PR open ms: cold ${cold.toFixed(0)}, warm [${warm.map((w) => w.toFixed(0)).join(", ")}] avg ${avg.toFixed(0)}`,
  );

  // Warm opens measure ~80–120ms on a dev box under the dev runtime; ~2.5×
  // headroom for CI. The cold bound is looser — it includes first-time syntax
  // highlighting of every mounted row.
  expect(avg).toBeLessThan(perfBudget(300, test.info().project.name));
  expect(cold).toBeLessThan(perfBudget(900, test.info().project.name));
});
