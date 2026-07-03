import { defineConfig } from "@playwright/test";

// Frontend e2e (docs/TESTING.md "layer 2"): the real React app served by vite,
// with the Tauri bridge mocked per-test (see e2e/bridge.ts). Fast and
// deterministic; the Rust side is covered by cargo tests, not here.
export default defineConfig({
  testDir: "./e2e",
  timeout: 15_000,
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "pnpm dev",
    port: 1420,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
