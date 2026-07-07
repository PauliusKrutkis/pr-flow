import type { Page } from "@playwright/test";
import { setupApp } from "./bridge.ts";
import { makeBigDetail, perfBudget } from "./fixtures.ts";
import { expect, test } from "./test.ts";

test.describe.configure({ retries: 2 });

const FILES = 12;
const LINES = 300;
const BIG_DETAIL = makeBigDetail(
  FILES,
  LINES,
  (f, i) => `const value_${f}_${i} = compute(${i} + ${f});`
);

/** Arm an in-page stopwatch: Enter keydown → diff present → second frame. */
async function armOpenTimer(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __openMs: Promise<number> };
    w.__openMs = new Promise((resolve) => {
      window.addEventListener(
        "keydown",
        function onKey(e: KeyboardEvent) {
          if (e.key !== "Enter") {
            return;
          }
          window.removeEventListener("keydown", onKey, true);
          const t0 = performance.now();
          const check = () => {
            if (document.querySelector(".qf-diff")) {
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve(performance.now() - t0))
              );
            } else {
              requestAnimationFrame(check);
            }
          };
          check();
        },
        true
      );
    });
  });
}

async function openMs(page: Page): Promise<number> {
  await armOpenTimer(page);
  await page.keyboard.press("Enter");
  const ms = await page.evaluate(
    () => (window as unknown as { __openMs: Promise<number> }).__openMs
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option").first()).toBeVisible();
  return ms;
}

test("opening a PR from cache stays fast", async ({ page }) => {
  test.setTimeout(60_000);
  await setupApp(page, { detailByLoad: [BIG_DETAIL] });
  await expect(page.getByRole("option").first()).toBeVisible();

  const cold = await openMs(page);
  const warm: number[] = [];
  for (let i = 0; i < 3; i++) {
    warm.push(await openMs(page));
  }
  const avg = warm.reduce((a, b) => a + b, 0) / warm.length;
  console.log(
    `PR open ms: cold ${cold.toFixed(0)}, warm [${warm.map((w) => w.toFixed(0)).join(", ")}] avg ${avg.toFixed(0)}`
  );

  expect(avg).toBeLessThan(perfBudget(300, test.info().project.name));
  expect(cold).toBeLessThan(perfBudget(900, test.info().project.name));
});
