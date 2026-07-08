import { cn } from "../../lib/cn.ts";

/**
 * Past this many ticks the ruler is a solid bar, not a distribution — sample
 * evenly instead (the current match always survives sampling).
 */

const MAX_TICKS = 200;

interface OverviewRulerProps {
  currentIndex: number | null;
  fractions: readonly number[];
  kind: "find" | "occurrence";
}

export function OverviewRuler({
  kind,
  fractions,
  currentIndex,
}: OverviewRulerProps) {
  if (fractions.length === 0) {
    return null;
  }
  const stride = Math.max(1, Math.ceil(fractions.length / MAX_TICKS));
  const ticks: Array<{ frac: number; current: boolean }> = [];
  for (let i = 0; i < fractions.length; i += 1) {
    const current = i === currentIndex;
    if (i % stride !== 0 && !current) {
      continue;
    }
    const frac = fractions[i];
    if (frac < 0) {
      continue;
    }
    ticks.push({ current, frac });
  }
  if (ticks.length === 0) {
    return null;
  }
  return (
    <div aria-hidden className="qf-ruler">
      {ticks.map((t, _i) => (
        <div
          className={cn(
            "qf-ruler-tick",
            kind === "find" ? "qf-ruler-find" : "qf-ruler-occ",
            t.current && "qf-ruler-current"
          )}
          key={`${t.frac}-${String(t.current)}`}
          style={{ top: `${t.frac * 100}%` }}
        />
      ))}
    </div>
  );
}
