import { cn } from "../../lib/cn";

// The overview ruler: a slim column of tick marks along the diff's right edge
// showing where the active matches (find or selection occurrences) live in
// the WHOLE scroll range — the distribution at a glance, like an editor's
// scrollbar annotations.
//
// With the review scroll virtualized, positions come straight from the item
// model: a match's fraction is its item index over the total item count. No
// layout reads, no observers — the windowed implementation needed both.

// Past this many ticks the ruler is a solid bar, not a distribution — sample
// evenly instead (the current match always survives sampling).
const MAX_TICKS = 200;

interface OverviewRulerProps {
  kind: "find" | "occurrence";
  /**
   * One entry per match: its fraction (0..1) of the list, or a negative
   * value for matches that currently have no position (collapsed hunks).
   * Indexes align with `currentIndex`.
   */
  fractions: ReadonlyArray<number>;
  /** Index of the current match within `fractions` (find mode), or null. */
  currentIndex: number | null;
}

export function OverviewRuler({ kind, fractions, currentIndex }: OverviewRulerProps) {
  if (fractions.length === 0) return null;
  const stride = Math.max(1, Math.ceil(fractions.length / MAX_TICKS));
  const ticks: Array<{ frac: number; current: boolean }> = [];
  for (let i = 0; i < fractions.length; i++) {
    const current = i === currentIndex;
    if (i % stride !== 0 && !current) continue;
    const frac = fractions[i];
    if (frac < 0) continue;
    ticks.push({ frac, current });
  }
  if (ticks.length === 0) return null;
  return (
    <div className="qf-ruler" aria-hidden>
      {ticks.map((t, i) => (
        <div
          key={i}
          className={cn(
            "qf-ruler-tick",
            kind === "find" ? "qf-ruler-find" : "qf-ruler-occ",
            t.current && "qf-ruler-current",
          )}
          style={{ top: `${t.frac * 100}%` }}
        />
      ))}
    </div>
  );
}
