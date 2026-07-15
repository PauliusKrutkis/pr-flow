import { useState } from "react";

/**
 * Roving "armed" selection for the Tab-armed dialog pattern: DOM focus stays
 * put (an input, or nowhere), and Tab moves a visual highlight across `items`
 * instead of wandering focus — the armed item is the one Enter activates.
 * `items` is the ordered ring, rebuilt each render so a dynamic list stays in
 * sync; include a resting sentinel (e.g. `null`) for the "nothing armed" state.
 * `cycle(1)` advances, `cycle(-1)` steps back, both wrapping around.
 */
export function useArmedRing<T>(items: T[], initial: T) {
  const [armed, setArmed] = useState<T>(initial);

  const cycle = (dir: 1 | -1) => {
    const len = items.length;
    if (len === 0) {
      return;
    }
    const found = items.indexOf(armed);
    const from = found === -1 ? 0 : found;
    setArmed(items[(from + dir + len) % len]);
  };

  return { armed, cycle, setArmed };
}
