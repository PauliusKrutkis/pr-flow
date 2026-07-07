import { useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "../ui/dialog";
import { Kbd } from "../primitives";
import Backdrop from "./Backdrop";
import { X, Command } from "lucide-react";

/**
 * Help overlay (?) — the shortcut cheatsheet. In the app it is generated from
 * the live bindings so it can never drift from reality; here it renders the same
 * scope grouping the keyboard layer registers under. The point it makes visually:
 * shortcuts are scope-aware — only one column is "active" at a time (the scope
 * you're in), while `global` always applies. Active scope carries the iris tint.
 */

interface Binding { keys: string[]; label: string }
interface ScopeGroup { scope: string; note: string; bindings: Binding[]; active?: boolean }

const GROUPS: ScopeGroup[] = [
  {
    scope: "global",
    note: "Always available",
    bindings: [
      { keys: ["⌘", "K"], label: "Command palette" },
      { keys: ["?"], label: "This cheatsheet" },
      { keys: ["esc"], label: "Back / dismiss" },
    ],
  },
  {
    scope: "review",
    note: "When reading a diff",
    active: true,
    bindings: [
      { keys: ["n"], label: "Next file" },
      { keys: ["p"], label: "Previous file" },
      { keys: ["j"], label: "Next line" },
      { keys: ["k"], label: "Previous line" },
      { keys: ["c"], label: "Comment on line" },
      { keys: ["e"], label: "Mark viewed + next" },
      { keys: ["v"], label: "Toggle viewed" },
      { keys: ["]c"], label: "Next thread" },
      { keys: ["[c"], label: "Previous thread" },
      { keys: ["i"], label: "Toggle PR info" },
      { keys: ["s"], label: "Submit review" },
    ],
  },
  {
    scope: "inbox",
    note: "On the home list",
    bindings: [
      { keys: ["j"], label: "Move down" },
      { keys: ["k"], label: "Move up" },
      { keys: ["↵"], label: "Open PR" },
      { keys: ["/"], label: "Filter tab" },
      { keys: ["⇥"], label: "Switch tab" },
    ],
  },
  {
    scope: "palette",
    note: "Inside ⌘K",
    bindings: [
      { keys: ["↑"], label: "Previous result" },
      { keys: ["↓"], label: "Next result" },
      { keys: ["↵"], label: "Run / jump" },
      { keys: ["esc"], label: "Close" },
    ],
  },
];

const byScope = (s: string) => GROUPS.find((g) => g.scope === s)!;
// Two balanced columns: the tall active scope (review) stands alone on the
// right; the three short scopes stack on the left so neither column trails off.
const COLUMN_LEFT: ScopeGroup[] = [byScope("global"), byScope("inbox"), byScope("palette")];
const COLUMN_RIGHT: ScopeGroup[] = [byScope("review")];

export default function HelpOverlay() {
  const [open, setOpen] = useState(true);
  return (
    <div className="dir-quiet qh-root">
      <style>{CSS}</style>
      <Backdrop />

      {!open && (
        <button type="button" className="qh-reopen q-focus" onClick={() => setOpen(true)}>
          Show shortcuts
          <Kbd>?</Kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="qh-panel" aria-describedby={undefined}>
          <header className="qh-head">
            <div className="qh-head-title">
              <Command size={15} aria-hidden />
              <DialogTitle className="qh-title">Keyboard</DialogTitle>
              <span className="qh-head-note">Scope-aware — only the screen you're on responds</span>
            </div>
            <DialogClose asChild>
              <button type="button" className="qh-close q-focus" aria-label="Close">
                <X size={16} aria-hidden />
              </button>
            </DialogClose>
          </header>

          <div className="qh-grid">
            {[COLUMN_LEFT, COLUMN_RIGHT].map((col, ci) => (
              <div key={ci} className="qh-col">
                {col.map((g) => (
                  <section key={g.scope} className={"qh-scope" + (g.active ? " qh-scope-active" : "")}>
                    <div className="qh-scope-head">
                      <span className="qh-scope-name">{g.scope}</span>
                      {g.active && <span className="qh-scope-tag">active</span>}
                      <span className="qh-scope-note">{g.note}</span>
                    </div>
                    <dl className="qh-rows">
                      {g.bindings.map((b) => (
                        <div key={b.label} className="qh-row">
                          <dt className="qh-keys">
                            {b.keys.map((k, i) => <Kbd key={i}>{k}</Kbd>)}
                          </dt>
                          <dd className="qh-label">{b.label}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                ))}
              </div>
            ))}
          </div>

          <footer className="qh-foot">
            Generated from the live bindings — the legend, the palette, and this sheet
            can never drift.
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CSS = `
.qh-root { position: relative; }
.qh-reopen {
  position: absolute; left: 50%; top: 24vh; transform: translateX(-50%); z-index: 5;
  display: inline-flex; align-items: center; gap: 9px; padding: 10px 16px;
  border-radius: 10px; font-size: 13px; color: var(--fg);
  background: var(--surface); border: 1px solid var(--line-2); cursor: pointer;
}

.qh-panel { width: min(720px, calc(100vw - 32px)); padding: 0; }

.qh-head { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 1px solid var(--line); }
.qh-head-title { display: flex; align-items: center; gap: 10px; }
.qh-head-title svg { color: var(--accent); }
.qh-title { font-size: 14px; font-weight: 700; color: var(--fg); }
.qh-head-note { font-size: 12px; color: var(--faint); }
.qh-close { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; color: var(--muted); background: var(--surface-hi); border: 1px solid var(--line-2); cursor: pointer; transition: color 120ms ease; }
.qh-close:hover { color: var(--fg); }

.qh-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; padding: 20px; overflow-y: auto; align-items: start; }
.qh-col { display: flex; flex-direction: column; gap: 6px; }
.qh-scope { padding: 12px 14px; border-radius: 10px; border: 1px solid transparent; }
.qh-scope-active { background: var(--accent-soft); border-color: var(--accent-line); }
.qh-scope-head { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.qh-scope-name { font-family: var(--font-mono); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--accent); }
.qh-scope-tag { font-family: var(--font-mono); font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent-ink); background: var(--accent); border-radius: 999px; padding: 2px 6px; }
.qh-scope-note { font-size: 11px; color: var(--faint); margin-left: auto; }

.qh-rows { display: flex; flex-direction: column; gap: 1px; }
.qh-row { display: flex; align-items: center; gap: 10px; padding: 4px 0; }
.qh-keys { display: flex; gap: 4px; min-width: 64px; flex-shrink: 0; }
.qh-label { font-size: 13px; color: var(--fg); }

.qh-foot { padding: 12px 20px; border-top: 1px solid var(--line); background: var(--surface-2); font-size: 12px; color: var(--faint); }

@media (max-width: 640px) { .qh-grid { grid-template-columns: 1fr; } }
`;
