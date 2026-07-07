import { Fragment } from "react";
import { cn } from "../../lib/cn.ts";

const capClass = "q-kbd";

const NAMED: Record<string, string> = {
  alt: "⌥",
  backspace: "⌫",
  down: "↓",
  enter: "↵",
  esc: "Esc",
  left: "←",
  mod: "⌘",
  right: "→",
  shift: "⇧",
  space: "Space",
  tab: "Tab",
  up: "↑",
};

/** Turn one descriptor part into a display label. */
function renderPart(part: string): string {
  const lower = part.toLowerCase();
  if (NAMED[lower]) {
    return NAMED[lower];
  }
  if (part.length === 1) {
    return part.toUpperCase();
  }
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
  if (combo.length === 2 && !NAMED[combo.toLowerCase()]) {
    return [combo[0], combo[1]];
  }
  return [combo];
}

export function Kbd({
  combo,
  className,
}: {
  combo?: string;
  className?: string;
}) {
  if (!combo) {
    return null;
  }
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
