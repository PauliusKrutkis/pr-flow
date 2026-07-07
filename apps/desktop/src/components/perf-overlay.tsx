import { usePerfStore } from "../lib/perf.ts";

/**
 * Dev-only perceived-performance HUD: "⚡ PR open 84 ms · file 4 ms".
 * Tree-shaken out of release builds via the import.meta.env.DEV guard.
 */

function fmt(ms: number | null): string {
  if (ms === null) {
    return "—";
  }
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

export function PerfOverlay() {
  const lastPROpenMs = usePerfStore((s) => s.lastPROpenMs);
  const lastFileSwitchMs = usePerfStore((s) => s.lastFileSwitchMs);
  const visible = usePerfStore((s) => s.visible);

  if (!(import.meta.env.DEV && visible)) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed bottom-2 left-2 z-50 select-none rounded border border-line bg-surface/90 px-2 py-1 font-mono text-[10px] text-muted shadow-lg backdrop-blur">
      <span aria-hidden>⚡</span> PR open {fmt(lastPROpenMs)} · file switch{" "}
      {fmt(lastFileSwitchMs)}
    </div>
  );
}
