import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type RefObject,
} from "react";
import type { ChangedFile } from "../../types";
import { anchorFractions } from "../../lib/diff";
import { cn } from "../../lib/cn";

// The overview ruler: a slim column of tick marks along the diff's right edge
// showing where the active matches (find or selection occurrences) live in
// the WHOLE scroll range — the distribution at a glance, like an editor's
// scrollbar annotations.
//
// Position math: a tick's fraction of the scroll height is
//   (sectionTop + rowFraction × sectionHeight) / scrollHeight
// where sectionTop/Height are measured from the registered section elements
// and rowFraction is the row's share of its file's patch rows (lib/diff
// anchorFractions). Sections are windowed — unmounted bodies are placeholders
// with ESTIMATED heights — so this is an approximation by design; a 2px tick
// doesn't need better.

/** One match to mark: which file section, which row. */
export interface RulerMatch {
  fileIndex: number;
  anchor: string;
}

// Past this many ticks the ruler is a solid bar, not a distribution — sample
// evenly instead (the current match always survives sampling).
const MAX_TICKS = 200;

interface Tick {
  /** 0..1 of the scroll height. */
  frac: number;
  current: boolean;
}

interface OverviewRulerProps {
  /** The diff's scroll host (ReviewScreen's scrollRef). */
  hostRef: RefObject<HTMLDivElement | null>;
  /** ReviewScreen's registry of section elements, by file index. */
  sectionEls: RefObject<Map<number, HTMLElement>>;
  files: ChangedFile[];
  kind: "find" | "occurrence";
  matches: ReadonlyArray<RulerMatch>;
  /** Index of the current match within `matches` (find mode), or null. */
  currentIndex: number | null;
}

export function OverviewRuler({
  hostRef,
  sectionEls,
  files,
  kind,
  matches,
  currentIndex,
}: OverviewRulerProps) {
  const [ticks, setTicks] = useState<Tick[]>([]);

  // Row fractions per file, parsed lazily (only files that actually have
  // matches) and cached for the lifetime of the file list.
  const fractionsFor = useMemo(() => {
    const cache = new Map<number, Map<string, number>>();
    return (fileIndex: number): Map<string, number> => {
      let hit = cache.get(fileIndex);
      if (!hit) {
        hit = anchorFractions(files[fileIndex]?.patch);
        cache.set(fileIndex, hit);
      }
      return hit;
    };
  }, [files]);

  const recompute = useCallback(() => {
    const host = hostRef.current;
    if (!host || matches.length === 0) {
      setTicks((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const scrollHeight = host.scrollHeight;
    if (scrollHeight === 0) return;
    // Section offsets in scroll-content coordinates (rects move with scroll;
    // adding scrollTop pins them to the content).
    const hostTop = host.getBoundingClientRect().top;
    const scrollTop = host.scrollTop;
    const stride = Math.max(1, Math.ceil(matches.length / MAX_TICKS));
    const out: Tick[] = [];
    for (let i = 0; i < matches.length; i++) {
      const current = i === currentIndex;
      if (i % stride !== 0 && !current) continue;
      const section = sectionEls.current.get(matches[i].fileIndex);
      if (!section) continue;
      const rect = section.getBoundingClientRect();
      const sectionTop = rect.top - hostTop + scrollTop;
      const rowFrac = fractionsFor(matches[i].fileIndex).get(matches[i].anchor);
      if (rowFrac === undefined) continue;
      out.push({ frac: (sectionTop + rowFrac * rect.height) / scrollHeight, current });
    }
    setTicks(out);
  }, [hostRef, sectionEls, matches, currentIndex, fractionsFor]);

  // Ticks are content-anchored, not viewport-anchored: recompute when the
  // match list changes and when layout moves (sections mounting their real
  // bodies, comment threads opening, the window resizing) — never per scroll
  // event. A plain effect, NOT a layout effect: the rect reads run after the
  // browser has painted (and therefore laid out) the commit that changed the
  // matches. In a layout effect they'd run against the still-dirty layout the
  // same commit produced — a forced synchronous reflow of the whole diff on
  // every find keystroke, which is most of what a keystroke used to cost.
  // Ticks landing a frame after the marks is imperceptible.
  useEffect(recompute, [recompute]);
  useEffect(() => {
    const ro = new ResizeObserver(() => recompute());
    if (hostRef.current) ro.observe(hostRef.current);
    for (const el of sectionEls.current.values()) ro.observe(el);
    return () => ro.disconnect();
  }, [recompute, hostRef, sectionEls]);

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
