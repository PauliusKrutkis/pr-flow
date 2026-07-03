import { defineConfig } from "vitest/config";

// Unit tests for the pure-logic layer (docs/TESTING.md priority 1). Files that
// need a DOM (highlight mark-wrapping, store/localStorage) opt into jsdom via
// a `// @vitest-environment jsdom` pragma.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
});
