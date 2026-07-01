import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogClose } from "../ui/dialog";
import { Kbd } from "../primitives";
import Backdrop from "./Backdrop";
import { Check, XCircle, MessageSquare, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Submit review modal — the end of the loop. Approve / Request changes / Comment
 * as a real radio group (arrow-key navigable, aria-checked), with the batched
 * pending count surfaced up front so you always know what you're about to send.
 * The submit button renames itself to match the verdict, so the action keeps one
 * name from choice to click.
 */

type Verdict = "approve" | "changes" | "comment";
const PENDING = 3;

const OPTIONS: { id: Verdict; label: string; desc: string; icon: LucideIcon; cls: string; cta: string }[] = [
  { id: "approve", label: "Approve", desc: "Sign off — the changes look good to merge.", icon: Check, cls: "qs-opt-approve", cta: "Approve" },
  { id: "changes", label: "Request changes", desc: "Block the merge until your comments are resolved.", icon: XCircle, cls: "qs-opt-changes", cta: "Request changes" },
  { id: "comment", label: "Comment", desc: "Leave feedback without approving or blocking.", icon: MessageSquare, cls: "qs-opt-comment", cta: "Send comment" },
];

export default function SubmitReviewModal() {
  const [open, setOpen] = useState(true);
  const [verdict, setVerdict] = useState<Verdict>("approve");
  const [body, setBody] = useState("");
  const groupRef = useRef<HTMLDivElement>(null);

  function onGroupKey(e: React.KeyboardEvent) {
    const order = OPTIONS.map((o) => o.id);
    const i = order.indexOf(verdict);
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      setVerdict(order[(i + 1) % order.length]);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      setVerdict(order[(i - 1 + order.length) % order.length]);
    }
  }

  const active = OPTIONS.find((o) => o.id === verdict)!;

  return (
    <div className="dir-quiet qs-root">
      <style>{CSS}</style>
      <Backdrop />

      {!open && (
        <button type="button" className="qs-reopen q-focus" onClick={() => setOpen(true)}>
          Submit review
          <Kbd>s</Kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="qs-panel" aria-describedby={undefined}>
          <header className="qs-head">
            <div>
              <DialogTitle className="qs-title">Submit review</DialogTitle>
              <p className="qs-sub">
                <span className="qs-pending">{PENDING} pending comments</span> will be
                included with your review.
              </p>
            </div>
            <DialogClose asChild>
              <button type="button" className="qs-close q-focus" aria-label="Close">
                <X size={16} aria-hidden />
              </button>
            </DialogClose>
          </header>

          <div
            className="qs-options"
            role="radiogroup"
            aria-label="Review verdict"
            ref={groupRef}
            onKeyDown={onGroupKey}
          >
            {OPTIONS.map((o) => {
              const on = o.id === verdict;
              const Icon = o.icon;
              return (
                <button
                  key={o.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  className={"qs-opt q-focus " + o.cls + (on ? " qs-opt-on" : "")}
                  onClick={() => setVerdict(o.id)}
                >
                  <span className="qs-opt-icon"><Icon size={16} aria-hidden /></span>
                  <span className="qs-opt-text">
                    <span className="qs-opt-label">{o.label}</span>
                    <span className="qs-opt-desc">{o.desc}</span>
                  </span>
                  <span className="qs-radio" aria-hidden />
                </button>
              );
            })}
          </div>

          <div className="qs-composer">
            <textarea
              className="q-input qs-textarea"
              rows={3}
              placeholder={
                verdict === "changes"
                  ? "Summarize what needs to change…"
                  : "Add a summary (optional)…"
              }
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>

          <footer className="qs-foot">
            <span className="qs-foot-hint">
              <Kbd>⌘</Kbd><Kbd>↵</Kbd> to submit
            </span>
            <div className="qs-foot-actions">
              <DialogClose asChild>
                <button type="button" className="q-btn q-btn-ghost">Cancel</button>
              </DialogClose>
              <button
                type="button"
                className={"q-btn " + (verdict === "changes" ? "q-btn-danger" : "q-btn-primary")}
              >
                {active.cta}
                <span className="q-btn-badge">{PENDING}</span>
              </button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CSS = `
.qs-root { position: relative; }
.qs-reopen {
  position: absolute; left: 50%; top: 24vh; transform: translateX(-50%); z-index: 5;
  display: inline-flex; align-items: center; gap: 9px; padding: 10px 16px;
  border-radius: 10px; font-size: 13px; color: var(--fg);
  background: var(--surface); border: 1px solid var(--line-2); cursor: pointer;
}

.qs-panel { width: min(480px, calc(100vw - 32px)); padding: 0; }

.qs-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 14px; }
.qs-title { font-size: 15px; font-weight: 700; color: var(--fg); }
.qs-sub { margin-top: 5px; font-size: 12.5px; color: var(--muted); }
.qs-pending { color: var(--accent); font-weight: 600; }
.qs-close { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 7px; color: var(--muted); background: var(--surface-hi); border: 1px solid var(--line-2); cursor: pointer; transition: color 120ms ease; }
.qs-close:hover { color: var(--fg); }

.qs-options { display: flex; flex-direction: column; gap: 8px; padding: 0 20px; }
.qs-opt {
  display: flex; align-items: flex-start; gap: 12px; text-align: left;
  padding: 12px 14px; border-radius: 11px;
  background: var(--surface-2); border: 1px solid var(--line); cursor: pointer;
  transition: border-color 120ms ease, background-color 120ms ease;
}
.qs-opt:hover { border-color: var(--line-2); }
.qs-opt-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0; background: var(--surface-hi); color: var(--muted); }
.qs-opt-text { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.qs-opt-label { font-size: 13.5px; font-weight: 600; color: var(--fg); }
.qs-opt-desc { font-size: 12px; color: var(--muted); line-height: 1.45; }
.qs-radio { width: 16px; height: 16px; border-radius: 999px; border: 1.5px solid var(--line-2); flex-shrink: 0; margin-top: 6px; transition: border-color 120ms ease; position: relative; }

.qs-opt-on { background: var(--accent-soft); border-color: var(--accent-line); }
.qs-opt-on .qs-radio { border-color: var(--accent); }
.qs-opt-on .qs-radio::after { content: ""; position: absolute; inset: 3px; border-radius: 999px; background: var(--accent); }
.qs-opt-on.qs-opt-approve .qs-opt-icon { color: var(--add); background: var(--add-bg); }
.qs-opt-on.qs-opt-changes { background: var(--del-bg); border-color: rgba(255,112,136,0.3); }
.qs-opt-on.qs-opt-changes .qs-opt-icon { color: var(--del); background: rgba(255,112,136,0.16); }
.qs-opt-on.qs-opt-changes .qs-radio { border-color: var(--del); }
.qs-opt-on.qs-opt-changes .qs-radio::after { background: var(--del); }
.qs-opt-on.qs-opt-comment .qs-opt-icon { color: var(--accent); background: var(--accent-soft); }

.qs-composer { padding: 14px 20px 4px; }
.qs-textarea { min-height: 70px; }

.qs-foot { display: flex; align-items: center; justify-content: space-between; padding: 14px 20px; margin-top: 8px; border-top: 1px solid var(--line); background: var(--surface-2); }
.qs-foot-hint { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--faint); }
.qs-foot-actions { display: flex; align-items: center; gap: 8px; }
`;
