import { useMemo } from "react";
import { useKeyboard, useHotkeys } from "../keyboard";
import { useAppStore } from "../store/appStore";
import { Kbd } from "./ui/Kbd";

function firstKey(keys: string | string[]): string {
  return Array.isArray(keys) ? keys[0] : keys;
}

const OTHER = "Other";

export function HelpOverlay({ baseScope }: { baseScope: string }) {
  const helpOpen = useAppStore((s) => s.helpOpen);
  const setHelpOpen = useAppStore((s) => s.setHelpOpen);
  const { getBindings, version } = useKeyboard();

  // Hooks must run unconditionally — gate via `enabled`.
  useHotkeys(
    "help",
    [
      {
        keys: "esc",
        description: "Close",
        hidden: true,
        run: () => setHelpOpen(false),
      },
    ],
    { enabled: helpOpen },
  );

  const groups = useMemo(() => {
    if (!helpOpen) return [];
    void version;
    const byGroup = new Map<string, { combo: string; description: string }[]>();
    for (const b of getBindings(baseScope)) {
      if (b.hidden) continue;
      const group = b.group ?? OTHER;
      const list = byGroup.get(group) ?? [];
      list.push({ combo: firstKey(b.keys), description: b.description });
      byGroup.set(group, list);
    }
    return Array.from(byGroup.entries());
  }, [helpOpen, baseScope, getBindings, version]);

  if (!helpOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setHelpOpen(false);
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-card border border-line bg-surface shadow-2xl">
        <div className="border-b border-line px-5 py-3 text-sm font-semibold text-fg">
          Keyboard shortcuts
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          {groups.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted">
              No shortcuts available.
            </div>
          ) : (
            <div className="space-y-5">
              {groups.map(([group, bindings]) => (
                <div key={group}>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">
                    {group}
                  </div>
                  <div className="space-y-1.5">
                    {bindings.map((b, i) => (
                      <div
                        key={`${group}-${i}-${b.combo}`}
                        className="flex items-center justify-between gap-4"
                      >
                        <span className="text-sm text-fg">{b.description}</span>
                        <Kbd combo={b.combo} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-line px-5 py-2.5 text-center text-xs text-muted">
          Press ? or Esc to close
        </div>
      </div>
    </div>
  );
}
