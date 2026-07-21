import { defineConfig } from "@playwright/test";

/**
 * Frontend e2e (docs/TESTING.md "layer 2"): the real React app served by vite,
 * with the Tauri bridge mocked per-test (see e2e/bridge.ts). Fast and
 * deterministic; the Rust side is covered by cargo tests, not here.
 *
 * The suite runs on its OWN port, never the tauri dev port (1420), and never
 * reuses a running server: reusing 1420 meant that whenever `pnpm dev` was up,
 * the tests silently ran against THAT checkout's code instead of this one's —
 * green runs that proved nothing. A port collision now fails loudly
 * (--strictPort) instead of borrowing whatever happens to be listening.
 * Override with E2E_PORT to run suites from several checkouts in parallel.
 *
 * Dev-mode budgets (fixtures.ts perfBudget) are loose by necessity: React's
 * dev runtime + GC noise inflate numbers ~2x over what a built app feels
 * like. The chromium-perf-prod project below runs the same perf specs
 * against `vite build` + `vite preview` so budgets reflect real
 * user-perceived performance.
 */

const port = Number(process.env.E2E_PORT ?? 14_205);
const prodPort = Number(process.env.E2E_PROD_PORT ?? 14_206);
const perfSpecs = /(find|open|scroll)-perf\.spec\.ts/;
const runProdPerf = process.env.CI || process.env.E2E_PROD_PERF;

export default defineConfig({
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    ...(process.env.CI || process.env.E2E_WEBKIT
      ? [
          {
            name: "webkit-perf",
            testMatch: perfSpecs,
            use: { browserName: "webkit" as const },
          },
        ]
      : []),
    ...(runProdPerf
      ? [
          {
            name: "chromium-perf-prod",
            testMatch: perfSpecs,
            use: {
              baseURL: `http://localhost:${prodPort}`,
              browserName: "chromium" as const,
            },
          },
        ]
      : []),
  ],
  testDir: "./e2e",
  timeout: 15_000,
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { height: 800, width: 1280 },
  },
  webServer: [
    {
      command: `pnpm exec vite --port ${port} --strictPort`,
      port,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    ...(runProdPerf
      ? [
          {
            command: `pnpm build && pnpm exec vite preview --port ${prodPort} --strictPort`,
            port: prodPort,
            reuseExistingServer: false,
            timeout: 60_000,
          },
        ]
      : []),
  ],
});
