// Design Lab — the gallery.
//
// One shared design system ("Quiet", born on the Review screen) rendered across
// every view in the app so they can be judged as one system. The Review screen
// is the reference direction (directions/quiet.tsx); every other view is built
// on the extracted base (theme.ts) + shadcn-on-Radix primitives (ui/*), so the
// palette, type, motion, and focus ring stay identical everywhere.
//
// The thin top strip is lab-only chrome: press 1–9 to jump between views.
import { useEffect, useRef, useState } from "react";
import { TooltipProvider } from "./ui/tooltip";
import { BASE_CSS } from "./theme";
import { REVIEW } from "./mock";

import Quiet from "./directions/quiet";
import TokenGate from "./views/TokenGate";
import Inbox from "./views/Inbox";
import CommandPalette from "./views/CommandPalette";
import HelpOverlay from "./views/HelpOverlay";
import SubmitReviewModal from "./views/SubmitReviewModal";
import AddCommentBox from "./views/AddCommentBox";
import ChromeSurfaces from "./views/ChromeSurfaces";

interface ViewDef {
  id: string;
  label: string;
  group: string;
  render: (ctx: ViewContext) => React.ReactNode;
}

/** Cross-view actions the lab shell wires up (e.g. opening a PR jumps to Review). */
interface ViewContext {
  openReview: () => void;
}

const VIEWS: ViewDef[] = [
  { id: "auth", label: "Auth", group: "Primary", render: () => <TokenGate /> },
  { id: "inbox", label: "Inbox", group: "Primary", render: (ctx) => <Inbox onOpenPR={ctx.openReview} /> },
  { id: "review", label: "Review", group: "Primary", render: () => <Quiet review={REVIEW} /> },
  { id: "palette", label: "Command ⌘K", group: "Overlays", render: () => <CommandPalette /> },
  { id: "help", label: "Help ?", group: "Overlays", render: () => <HelpOverlay /> },
  { id: "submit", label: "Submit", group: "Overlays", render: () => <SubmitReviewModal /> },
  { id: "comment", label: "Comment", group: "Overlays", render: () => <AddCommentBox /> },
  { id: "chrome", label: "Chrome & alerts", group: "Chrome", render: () => <ChromeSurfaces /> },
];

const REVIEW_INDEX = VIEWS.findIndex((v) => v.id === "review");

export function App() {
  const [active, setActive] = useState(REVIEW_INDEX); // open on the Review reference
  const frameRef = useRef<HTMLDivElement>(null);

  // Lab chrome owns the digit keys; the views own everything else. Ignore when
  // typing in a field or when a modal (Radix dialog) has the focus.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      // Views own every non-digit key; a focused field owns digits too (so
      // typing "5" into the palette filters rather than jumping views). An open
      // dialog with focus on a button is fine to switch away from.
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= VIEWS.length) {
        e.preventDefault();
        setActive(n - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Move focus into the freshly-mounted view so its keyboard layer is live.
  useEffect(() => {
    const el = frameRef.current?.querySelector<HTMLElement>(".dir-quiet");
    el?.focus();
  }, [active]);

  return (
    <TooltipProvider delayDuration={200}>
      <style>{BASE_CSS}</style>
      <style>{LAB_CSS}</style>

      <div className="lab">
        <header className="lab-bar">
          <div className="lab-brand">
            <span className="lab-mark" aria-hidden />
            <span className="lab-name">PR Flow</span>
            <span className="lab-tag">Design Lab</span>
          </div>
          <nav className="lab-nav" aria-label="Views">
            {VIEWS.map((v, i) => {
              const first = i === 0 || VIEWS[i - 1].group !== v.group;
              return (
                <div key={v.id} className="lab-nav-item">
                  {first && <span className="lab-group">{v.group}</span>}
                  <button
                    type="button"
                    className={"lab-pill" + (i === active ? " lab-pill-on" : "")}
                    onClick={() => setActive(i)}
                    aria-current={i === active}
                  >
                    <span className="lab-pill-key">{i + 1}</span>
                    {v.label}
                  </button>
                </div>
              );
            })}
          </nav>
          <span className="lab-hint">1–{VIEWS.length} to switch</span>
        </header>

        <div className="lab-frame" ref={frameRef}>
          {VIEWS[active].render({ openReview: () => setActive(REVIEW_INDEX) })}
        </div>
      </div>
    </TooltipProvider>
  );
}

const LAB_CSS = `
.lab { display: flex; flex-direction: column; height: 100%; background: #08080c; }

.lab-bar {
  display: flex; align-items: center; gap: 18px; height: 46px; padding: 0 16px;
  background: #0a0a10; border-bottom: 1px solid #1c1c28; flex-shrink: 0;
}
.lab-brand { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.lab-mark { width: 16px; height: 16px; border-radius: 5px; background: linear-gradient(135deg, #8b80ff, #6f63e6); box-shadow: 0 0 12px -2px rgba(139,128,255,0.5); }
.lab-name { font-family: Inter, system-ui, sans-serif; font-size: 13px; font-weight: 700; color: #e8e8f3; }
.lab-tag { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: #5f5f78; border: 1px solid #232334; border-radius: 5px; padding: 2px 6px; }

.lab-nav { display: flex; align-items: center; gap: 4px; flex: 1; overflow-x: auto; }
.lab-nav-item { display: flex; align-items: center; gap: 4px; }
.lab-group { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: #454458; margin: 0 8px 0 12px; white-space: nowrap; }
.lab-nav-item:first-child .lab-group { margin-left: 0; }

.lab-pill {
  display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px 5px 6px;
  border-radius: 8px; font-family: Inter, system-ui, sans-serif; font-size: 12.5px;
  font-weight: 500; color: #9a9ab2; background: transparent; border: 1px solid transparent;
  cursor: pointer; white-space: nowrap; transition: color 120ms ease, background-color 120ms ease, border-color 120ms ease;
}
.lab-pill:hover { color: #e8e8f3; background: #14141d; }
.lab-pill-on { color: #e8e8f3; background: rgba(139,128,255,0.16); border-color: rgba(139,128,255,0.4); }
.lab-pill-key {
  display: grid; place-items: center; min-width: 17px; height: 17px; padding: 0 3px;
  border-radius: 4px; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10px;
  color: #5f5f78; background: #14141d; border: 1px solid #232334;
}
.lab-pill-on .lab-pill-key { color: #8b80ff; border-color: rgba(139,128,255,0.4); background: #0a0a10; }

.lab-hint { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 10px; color: #454458; flex-shrink: 0; white-space: nowrap; }

.lab-frame { position: relative; flex: 1; min-height: 0; overflow: hidden; }

@media (max-width: 1000px) { .lab-hint { display: none; } }
`;
