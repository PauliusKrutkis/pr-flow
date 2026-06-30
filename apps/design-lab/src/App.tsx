// Design Lab — the experimentation sandbox.
//
// This is where PR Flow gets stress-tested against exaggerated constraints: a PR
// with 87 files, 12 conversations, 3 conflicting reviews. It imports the same
// @pr-flow/ui components and @pr-flow/core model the desktop app uses, but feeds
// them mock data so we can iterate on look, feel, and keyboard flow without
// real GitHub traffic.
//
// Blank for now — scenarios and mocks land in follow-up PRs (see docs/DESIGN.md).

export function App() {
  return (
    <main className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-2xl font-semibold">PR Flow — Design Lab</h1>
      <p className="max-w-md text-sm text-muted">
        Sandbox for design experiments against mock PRs. Wired to{" "}
        <code className="text-accent">@pr-flow/ui</code> and{" "}
        <code className="text-accent">@pr-flow/core</code>. Scenarios coming soon.
      </p>
    </main>
  );
}
