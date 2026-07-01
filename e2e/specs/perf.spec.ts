/**
 * E2E: performance budgets — TODO scaffold (NOT YET IMPLEMENTED).
 * Pending specs only. See ../README.md.
 *
 * Budgets come from docs/DESIGN.md ("Instant"):
 *   - open a PR      < 300ms
 *   - switch PR      < 100ms
 *   - switch file    <  16ms  (one frame)
 * Each is asserted with a targeted measurement around a single interaction
 * (performance marks / long-task observation) — deliberately NOT a dev overlay
 * you eyeball. A regression past a threshold should fail CI.
 */
declare const test: { todo(name: string): void };

test.todo("opening a PR paints the file sidebar + diff in under 300ms (open budget)");
test.todo("switching to an already-cached PR renders in under 100ms (switch-PR budget)");
test.todo("switching files within a PR renders in under 16ms — one frame (switch-file budget)");
test.todo("a previously-seen PR paints from cache with no loading spinner (never blocks on the network)");
test.todo("opening a large diff produces no main-thread long task over 50ms");
test.todo("the command palette opens in under 100ms with the full PR list available");

export {};
