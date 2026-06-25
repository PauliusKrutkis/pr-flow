/**
 * E2E: PR inbox — TODO scaffold (NOT YET IMPLEMENTED).
 * Pending specs only. See ../README.md.
 */
declare const test: { todo(name: string): void };

test.todo("renders review-requested PRs from cache instantly, then refetches in the background");
test.todo("j / k and arrow keys move the selection");
test.todo("Enter opens the selected PR");
test.todo("'/' focuses search and filters by title/repo/author");
test.todo("Esc clears the search and blurs the input");
test.todo("'r' refreshes the list");
test.todo("unread indicator reflects updatedAt vs. last-seen");
test.todo("shows an empty state when there are no review requests");

export {};
