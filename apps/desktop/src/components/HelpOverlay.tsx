import { useMemo } from "react";
import { Command, X } from "lucide-react";
import { useKeyboard, useHotkeys } from "../keyboard";
import { useAppStore } from "../store/appStore";
import { Kbd } from "./ui/Kbd";

function firstKey(keys: string | string[]): string | undefined {
  return Array.isArray(keys) ? keys[0] : keys;
}

interface ScopeSection {
  scope: string;
  note: string;
  active: boolean;
  bindings: { combo: string; description: string }[];
}

const NOTE: Record<string, string> = {
  global: "Always available",
  review: "When reading a diff",
  inbox: "On the home list",
};

/**
 * Help overlay (?) — the shortcut cheatsheet, generated from the live bindings
 * so it can never drift. Shows the always-on global keys alongside the scope
 * you're currently in, with the active scope carrying the iris tint.
 */
export function HelpOverlay({ baseScope }: { baseScope: string }) {
  const helpOpen = useAppStore((s) => s.helpOpen);
  const setHelpOpen = useAppStore((s) => s.setHelpOpen);
  const { getBindings, version } = useKeyboard();

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

  const sections = useMemo<ScopeSection[]>(() => {
    if (!helpOpen) return [];
    void version;
    const byScope = new Map<string, { combo: string; description: string }[]>();
    for (const b of getBindings(baseScope)) {
      if (b.hidden) continue;
      const list = byScope.get(b.scope) ?? [];
      const combo = firstKey(b.keys);
      if (!combo) continue;
      list.push({ combo, description: b.description });
      byScope.set(b.scope, list);
    }
    const out: ScopeSection[] = [];
    const global = byScope.get("global");
    if (global) {
      out.push({ scope: "global", note: NOTE.global, active: false, bindings: global });
    }
    for (const [scope, bindings] of byScope) {
      if (scope === "global") continue;
      out.push({
        scope,
        note: NOTE[scope] ?? "",
        active: scope === baseScope,
        bindings,
      });
    }
    return out;
  }, [helpOpen, baseScope, getBindings, version]);

  if (!helpOpen) return null;

  const left = sections.filter((s) => !s.active);
  const right = sections.filter((s) => s.active);

  return (
    <div
      className="q-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setHelpOpen(false);
      }}
    >
      <div className="q-dialog qh-panel" role="dialog" aria-modal="true">
        <header className="qh-head">
          <div className="qh-head-title">
            <Command size={15} aria-hidden />
            <span className="qh-title">Keyboard</span>
            <span className="qh-head-note">
              Scope-aware — only the screen you're on responds
            </span>
          </div>
          <button
            type="button"
            className="qh-close q-focus"
            onClick={() => setHelpOpen(false)}
            aria-label="Close"
          >
            <X size={16} aria-hidden />
          </button>
        </header>

        <div className="qh-grid">
          {[left, right].map((col, ci) => (
            <div key={ci} className="qh-col">
              {col.map((g) => (
                <section
                  key={g.scope}
                  className={"qh-scope" + (g.active ? " qh-scope-active" : "")}
                >
                  <div className="qh-scope-head">
                    <span className="qh-scope-name">{g.scope}</span>
                    {g.active && <span className="qh-scope-tag">active</span>}
                    {g.note && <span className="qh-scope-note">{g.note}</span>}
                  </div>
                  <dl className="qh-rows">
                    {g.bindings.map((b, i) => (
                      <div key={`${g.scope}-${i}-${b.combo}`} className="qh-row">
                        <dt className="qh-keys">
                          <Kbd combo={b.combo} />
                        </dt>
                        <dd className="qh-label">{b.description}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          ))}
        </div>

        <footer className="qh-foot">
          Generated from the live bindings — the legend, the palette, and this
          sheet can never drift.
        </footer>
      </div>
    </div>
  );
}
