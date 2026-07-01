import type { ReactNode } from "react";

// A persistent footer legend so the keyboard shortcuts are discoverable without
// having to know to press `?`. Shows context-relevant keys for the active
// screen, plus the always-available Shortcuts / Palette entries.

interface Hint {
  keys: string[];
  label: string;
}

const HINTS: Record<string, Hint[]> = {
  inbox: [
    { keys: ["j", "k"], label: "Navigate" },
    { keys: ["enter"], label: "Open" },
    { keys: ["1–4"], label: "Tabs" },
    { keys: ["/"], label: "Search" },
  ],
  review: [
    { keys: ["r", "t"], label: "Files" },
    { keys: ["j", "k"], label: "Lines" },
    { keys: ["c"], label: "Comment" },
    { keys: ["e"], label: "Viewed + next" },
    { keys: ["s"], label: "Submit" },
    { keys: ["mod", "t"], label: "Find" },
    { keys: ["esc"], label: "Back" },
  ],
};

const KEY_LABEL: Record<string, string> = {
  enter: "↵",
  esc: "Esc",
  up: "↑",
  down: "↓",
  mod: "⌘",
  space: "␣",
};

function display(key: string): string {
  return KEY_LABEL[key] ?? key;
}

function Cap({ children }: { children: ReactNode }) {
  return <span className="q-kbd">{children}</span>;
}

function HintGroup({ hint }: { hint: Hint }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <span className="flex gap-0.5">
        {hint.keys.map((k) => (
          <Cap key={k}>{display(k)}</Cap>
        ))}
      </span>
      <span className="text-faint">{hint.label}</span>
    </span>
  );
}

export function StatusBar({ baseScope }: { baseScope: string }) {
  const hints = HINTS[baseScope] ?? [];
  return (
    <div className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-surface px-4 py-1.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-4 overflow-x-auto">
        {hints.map((h) => (
          <HintGroup key={h.label} hint={h} />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <HintGroup hint={{ keys: ["?"], label: "Shortcuts" }} />
        <HintGroup hint={{ keys: ["mod", "k"], label: "Palette" }} />
      </div>
    </div>
  );
}
