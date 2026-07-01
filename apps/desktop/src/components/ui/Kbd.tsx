import { Fragment } from "react";
import { cn } from "../../lib/cn";

const capClass = "q-kbd";

const NAMED: Record<string, string> = {
  mod: "⌘",
  enter: "↵",
  esc: "Esc",
  up: "↑",
  down: "↓",
  left: "←",
  right: "→",
  space: "Space",
  backspace: "⌫",
  tab: "Tab",
  shift: "⇧",
  alt: "⌥",
};

/** Turn one descriptor part into a display label. */
function renderPart(part: string): string {
  const lower = part.toLowerCase();
  if (NAMED[lower]) return NAMED[lower];
  if (part.length === 1) return part.toUpperCase();
  return part.charAt(0).toUpperCase() + part.slice(1);
}

/**
 * Break a key descriptor into the individual caps to display.
 * - "mod+k" -> ["mod", "k"]
 * - "]c"    -> ["]", "c"] (a two-key sequence: each char is its own cap)
 * - "enter" -> ["enter"]
 */
function toCaps(combo: string): string[] {
  if (combo.includes("+")) {
    return combo.split("+").filter(Boolean);
  }
  // A bare two-character token (no named key) is a vim-style sequence.
  if (combo.length === 2 && !NAMED[combo.toLowerCase()]) {
    return [combo[0], combo[1]];
  }
  return [combo];
}

export function Kbd({
  combo,
  className,
}: {
  combo: string;
  className?: string;
}) {
  const caps = toCaps(combo);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
      {caps.map((part, i) => (
        <Fragment key={i}>
          <kbd className={capClass}>{renderPart(part)}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
