/**
 * E2E: authentication — TODO scaffold (NOT YET IMPLEMENTED).
 *
 * Pending specs only. No test runner is wired up yet; see ../README.md for the
 * planned stack. The ambient `test` below is a placeholder so this file is
 * self-consistent — replace it with the real runner's import/globals when the
 * harness lands.
 */
declare const test: { todo(name: string): void };

test.todo("shows the token gate when no token is stored");
test.todo("shows 'Sign in with GitHub' only when OAuth is configured");
test.todo("PAT fallback: an invalid token surfaces an error message");
test.todo("PAT fallback: a valid token authenticates and routes to the inbox");
test.todo("OAuth loopback round-trip (mocked GitHub) captures a token and routes to the inbox");

export {};
