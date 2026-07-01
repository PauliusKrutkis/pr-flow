import { useState } from "react";
import { Kbd, Avatar } from "../primitives";
import { PEOPLE } from "../mock";
import {
  X, ArrowUpRight, Download, RefreshCw, GitPullRequestArrow,
} from "lucide-react";

/**
 * Chrome & incoming surfaces — the persistent status bar plus the transient
 * surfaces the backlog is bringing in: new-review toast, "PR updated" orient
 * banner, and update-available prompt. The point of gathering them here is to
 * prove they obey the "no nags" principle as a set: every one is dismissable,
 * low-chrome, and reserves the iris accent only for the single action it wants
 * you to take. They're shown co-occurring — the honest worst case — and still
 * read as calm. (Perf budgets are enforced by automated tests, not a UI HUD.)
 */
export default function ChromeSurfaces() {
  const [toast, setToast] = useState(true);
  const [update, setUpdate] = useState(true);
  const [banner, setBanner] = useState(true);

  return (
    <div className="dir-quiet q-glow qb-root">
      <style>{CSS}</style>

      {/* a light review scene for context */}
      <main className="qb-scene">
        {banner && (
          <div className="qb-banner" role="status">
            <span className="qb-banner-icon"><GitPullRequestArrow size={15} aria-hidden /></span>
            <span className="qb-banner-text">
              <b>This PR changed since you opened it.</b> 3 files updated, 1 new comment.
            </span>
            <button type="button" className="qb-banner-act q-focus">
              Show what changed <Kbd>u</Kbd>
            </button>
            <button type="button" className="qb-x q-focus" aria-label="Dismiss" onClick={() => setBanner(false)}>
              <X size={14} aria-hidden />
            </button>
          </div>
        )}

        <div className="qb-scene-body">
          <span className="qb-scene-hint">Review screen</span>
        </div>
      </main>

      {/* persistent status bar — PR state only; shortcuts live in the ? overlay */}
      <footer className="qb-statusbar">
        <div className="qb-sb-status">
          <span className="qb-sb-state">
            <span className="qb-sb-state-dot" /> Open
          </span>
          <span className="qb-sb-sep" />
          <span className="q-mono qb-sb-num">#128</span>
          <span className="qb-sb-title">scope-aware hotkey layer</span>
          <span className="qb-sb-sep" />
          <span className="q-mono">2/8 viewed</span>
          <span className="qb-sb-sep" />
          <span className="qb-sb-pending">1 pending</span>
        </div>
      </footer>

      {/* bottom-right transient stack: toast + update prompt */}
      <div className="qb-stack" aria-live="polite">
        {toast && (
          <div className="qb-toast" role="status">
            <span className="qb-toast-rail" aria-hidden />
            <Avatar user={PEOPLE.mira} size={30} />
            <div className="qb-toast-body">
              <div className="qb-toast-head">
                <span className="qb-toast-title">New review request</span>
                <button type="button" className="qb-x q-focus" aria-label="Dismiss" onClick={() => setToast(false)}>
                  <X size={13} aria-hidden />
                </button>
              </div>
              <p className="qb-toast-text">
                <b>Mira Okafor</b> asked you to review{" "}
                <span className="q-mono qb-toast-num">#128</span>
              </p>
              <p className="qb-toast-sub">scope-aware hotkey layer with sequence support</p>
              <div className="qb-toast-actions">
                <button type="button" className="qb-toast-open q-focus">
                  Open <Kbd>↵</Kbd>
                </button>
                <button type="button" className="qb-toast-snooze q-focus" onClick={() => setToast(false)}>
                  Snooze
                </button>
              </div>
            </div>
          </div>
        )}

        {update && (
          <div className="qb-update" role="status">
            <span className="qb-update-icon"><Download size={16} aria-hidden /></span>
            <div className="qb-update-body">
              <div className="qb-update-head">
                <span className="qb-update-title">Update available</span>
                <span className="q-mono qb-update-ver">v0.3.2</span>
              </div>
              <p className="qb-update-text">Installs on the next restart — nothing interrupts your review.</p>
              <div className="qb-update-actions">
                <button type="button" className="q-btn q-btn-primary qb-update-primary">
                  <RefreshCw size={13} aria-hidden /> Restart &amp; update
                </button>
                <button type="button" className="qb-update-later q-focus" onClick={() => setUpdate(false)}>Later</button>
                <a className="qb-update-notes" href="#" onClick={(e) => e.preventDefault()}>
                  Notes <ArrowUpRight size={11} aria-hidden />
                </a>
              </div>
            </div>
          </div>
        )}
      </div>

      {(!toast || !update || !banner) && (
        <button
          type="button"
          className="qb-reset q-focus"
          onClick={() => { setToast(true); setUpdate(true); setBanner(true); }}
        >
          <RefreshCw size={12} aria-hidden /> Reset surfaces
        </button>
      )}
    </div>
  );
}

const CSS = `
.qb-root { display: flex; flex-direction: column; }

/* light scene */
.qb-scene { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 16px; }
.qb-scene-body { flex: 1; display: grid; place-items: center; border: 1px dashed var(--line); border-radius: 14px; margin-top: 14px; }
.qb-scene-hint { font-size: 12px; color: var(--faint); letter-spacing: 0.04em; text-transform: uppercase; }

/* orient banner */
.qb-banner {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px 10px 14px;
  border-radius: 11px; background: var(--surface-2);
  border: 1px solid var(--line-2); box-shadow: inset 3px 0 0 var(--accent);
}
.qb-banner-icon { color: var(--accent); display: grid; place-items: center; }
.qb-banner-text { flex: 1; font-size: 13px; color: var(--muted); }
.qb-banner-text b { color: var(--fg); font-weight: 600; }
.qb-banner-act {
  display: inline-flex; align-items: center; gap: 7px; padding: 6px 11px;
  border-radius: 8px; font-size: 12.5px; font-weight: 500; color: var(--accent);
  background: var(--accent-soft); border: 1px solid var(--accent-line); cursor: pointer;
  transition: filter 120ms ease;
}
.qb-banner-act:hover { filter: brightness(1.1); }

.qb-x { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; color: var(--faint); background: transparent; border: none; cursor: pointer; transition: color 120ms ease, background-color 120ms ease; flex-shrink: 0; }
.qb-x:hover { color: var(--fg); background: var(--surface-hi); }

/* status bar — PR state only */
.qb-statusbar { display: flex; align-items: center; padding: 8px 16px; border-top: 1px solid var(--line); background: var(--surface); }
.qb-sb-status { display: flex; align-items: center; gap: 10px; font-size: 11.5px; color: var(--muted); white-space: nowrap; min-width: 0; }
.qb-sb-state { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--add); }
.qb-sb-state-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.qb-sb-num { color: var(--faint); }
.qb-sb-title { color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.qb-sb-pending { color: var(--accent); }
.qb-sb-sep { width: 1px; height: 12px; background: var(--line-2); flex-shrink: 0; }

/* bottom-right stack */
.qb-stack { position: absolute; right: 18px; bottom: 60px; z-index: 9; display: flex; flex-direction: column; gap: 12px; width: 340px; max-width: calc(100vw - 36px); }

.qb-toast {
  position: relative; display: flex; gap: 12px; padding: 13px 14px 13px 16px;
  background: var(--surface); border: 1px solid var(--line-2); border-radius: 13px;
  box-shadow: 0 18px 48px -24px rgba(0,0,0,0.7); overflow: hidden;
  animation: qb-rise 200ms cubic-bezier(0.2,0.8,0.2,1);
}
.qb-toast-rail { position: absolute; left: 0; top: 12px; bottom: 12px; width: 3px; border-radius: 999px; background: var(--accent); box-shadow: 0 0 12px 0 var(--accent-line); }
.qb-toast-body { flex: 1; min-width: 0; }
.qb-toast-head { display: flex; align-items: center; justify-content: space-between; }
.qb-toast-title { font-size: 12px; font-weight: 700; letter-spacing: 0.01em; color: var(--fg); }
.qb-toast-text { margin-top: 3px; font-size: 12.5px; color: var(--muted); }
.qb-toast-text b { color: var(--fg); font-weight: 600; }
.qb-toast-num { color: var(--accent); }
.qb-toast-sub { margin-top: 2px; font-size: 12px; color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qb-toast-actions { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.qb-toast-open { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 7px; font-size: 12px; font-weight: 600; color: var(--accent-ink); background: var(--accent); border: none; cursor: pointer; }
.qb-toast-open:hover { filter: brightness(1.08); }
.qb-toast-open .q-kbd { color: var(--accent-ink); background: rgba(20,17,31,0.16); border-color: rgba(20,17,31,0.22); box-shadow: none; }
.qb-toast-snooze { font-size: 12px; color: var(--muted); background: transparent; border: none; cursor: pointer; padding: 5px 4px; }
.qb-toast-snooze:hover { color: var(--fg); }

.qb-update {
  display: flex; gap: 12px; padding: 13px 14px; background: var(--surface-2);
  border: 1px solid var(--line-2); border-radius: 13px;
  box-shadow: 0 18px 48px -24px rgba(0,0,0,0.7);
  animation: qb-rise 200ms cubic-bezier(0.2,0.8,0.2,1);
}
.qb-update-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; flex-shrink: 0; color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-line); }
.qb-update-body { flex: 1; min-width: 0; }
.qb-update-head { display: flex; align-items: baseline; gap: 8px; }
.qb-update-title { font-size: 13px; font-weight: 600; color: var(--fg); }
.qb-update-ver { font-size: 11px; color: var(--faint); }
.qb-update-text { margin-top: 3px; font-size: 12px; color: var(--muted); line-height: 1.45; }
.qb-update-actions { display: flex; align-items: center; gap: 10px; margin-top: 11px; }
.qb-update-primary { padding: 6px 11px; font-size: 12px; }
.qb-update-later { font-size: 12px; color: var(--muted); background: transparent; border: none; cursor: pointer; padding: 6px 4px; }
.qb-update-later:hover { color: var(--fg); }
.qb-update-notes { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; font-size: 11px; color: var(--faint); text-decoration: none; }
.qb-update-notes:hover { color: var(--accent); }

.qb-reset { position: absolute; left: 50%; transform: translateX(-50%); bottom: 56px; z-index: 9; display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 8px; font-size: 11px; color: var(--faint); background: var(--surface); border: 1px solid var(--line); cursor: pointer; }
.qb-reset:hover { color: var(--muted); }

@keyframes qb-rise { from { opacity: 0; transform: translateY(10px); } }
`;
