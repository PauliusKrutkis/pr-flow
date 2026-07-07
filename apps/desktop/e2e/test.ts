// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { test as base, expect as playwrightExpect } from "@playwright/test";

/**
 * The suite-wide `test`: identical to Playwright's, plus an automatic guard
 * that FAILS any test whose page threw an uncaught exception or logged a
 * console error. Without it, the app can crash a React subtree (an error
 * boundary swallows it, the assertions that already ran keep the test green)
 * and CI stays quiet. Import `test`/`expect` from "./test" in every spec —
 * not from "@playwright/test".
 */

export const expect = playwrightExpect;

export const test = base.extend<{ pageErrorGuard: undefined }>({
  pageErrorGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (err) => {
        errors.push(`pageerror: ${err.message}`);
      });
      page.on("console", (msg) => {
        if (msg.type() !== "error") {
          return;
        }
        const text = msg.text();
        if (text.startsWith("Failed to load resource")) {
          return;
        }
        errors.push(`console.error: ${text}`);
      });
      await use();
      expect(errors, "the page logged errors during this test").toEqual([]);
    },
    { auto: true },
  ],
});
