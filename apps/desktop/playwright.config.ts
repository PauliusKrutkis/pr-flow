import { defineConfig } from "@playwright/test";

// Frontend e2e (docs/TESTING.md "layer 2"): the real React app served by vite,
// with the Tauri bridge mocked per-test (see e2e/bridge.ts). Fast and
// deterministic; the Rust side is covered by cargo tests, not here.
//
// The suite runs on its OWN port, never the tauri dev port (1420), and never
// reuses a running server: reusing 1420 meant that whenever `pnpm dev` was up,
// the tests silently ran against THAT checkout's code instead of this one's —
// green runs that proved nothing. A port collision now fails loudly
// (--strictPort) instead of borrowing whatever happens to be listening.
// Override with E2E_PORT to run suites from several checkouts in parallel.
const port = Number(process.env.E2E_PORT ?? 14205);

export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    // The full suite on Chromium: fast, and fine for behavioral coverage.
    { name: "chromium", use: { browserName: "chromium" } },
    // The PERF specs additionally run on WebKit — the app ships on Tauri's
    // WebKitGTK, which shares its engine lineage (JavaScriptCore, main-thread
    // overflow scrolling), so Chromium-only budgets can pass while the real
    // app lags. Budgets in the specs scale via test.info().project.name.
    // CI-only by default: Playwright's WebKit is an Ubuntu build and won't
    // launch on every dev distro — opt in locally with E2E_WEBKIT=1.
    ...(process.env.CI || process.env.E2E_WEBKIT
      ? [
          {
            name: "webkit-perf",
            use: { browserName: "webkit" as const },
            testMatch: /(find|open|scroll)-perf\.spec\.ts/,
          },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm exec vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
