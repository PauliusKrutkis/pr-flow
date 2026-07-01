import { Kbd } from "../primitives";
import { ShieldCheck } from "lucide-react";

/** GitHub wordmark glyph — lucide dropped its brand icons, so we carry our own. */
function Github({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false">
      <path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5Z" />
    </svg>
  );
}

/**
 * Token gate — first run, and the only screen that ever blocks on the network.
 * It stays calm about it: one path in (GitHub OAuth), one honest reassurance
 * about where the session lives. The iris mark is the same one the inbox wears,
 * so the app introduces itself in the language it will keep using.
 */
export default function TokenGate() {
  return (
    <div className="dir-quiet q-glow qg-root">
      <style>{CSS}</style>

      <div className="qg-card">
        <div className="qg-brand">
          <span className="qg-mark" aria-hidden />
          <span className="qg-wordmark">PR Flow</span>
        </div>

        <h1 className="qg-thesis">Keyboard-first pull-request review.</h1>
        <p className="qg-sub">
          Sign in once. Your review requests stay cached and ready, so the app opens
          on the diff — never on a spinner.
        </p>

        <div className="qg-panel">
          <button type="button" className="q-btn q-btn-primary qg-primary">
            <Github size={16} />
            Continue with GitHub
            <Kbd>↵</Kbd>
          </button>
          <p className="qg-hint">
            Opens GitHub in your browser and returns on a loopback port. Needs
            access to <span className="qg-scope">repo</span> and{" "}
            <span className="qg-scope">read:org</span>.
          </p>
        </div>

        <div className="qg-note" role="note">
          <ShieldCheck size={14} aria-hidden />
          <span>Your session is stored in the OS keychain and only ever sent to GitHub.</span>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.qg-root { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; padding: 24px; }

.qg-card {
  position: relative;
  width: min(420px, 100%);
  background: linear-gradient(180deg, var(--surface-2), var(--surface));
  border: 1px solid var(--line-2);
  border-radius: 18px;
  padding: 32px 32px 24px;
  box-shadow: 0 32px 80px -40px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.02);
}

.qg-brand { display: flex; align-items: center; gap: 11px; margin-bottom: 26px; }
.qg-mark {
  width: 30px; height: 30px; border-radius: 9px;
  background: linear-gradient(135deg, var(--accent), #6f63e6);
  box-shadow: 0 0 0 1px var(--accent-line), 0 0 22px -4px var(--accent-line);
}
.qg-wordmark { font-size: 16px; font-weight: 700; letter-spacing: -0.01em; }

.qg-thesis { font-size: 21px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; color: var(--fg); }
.qg-sub { margin-top: 10px; margin-bottom: 24px; font-size: 13.5px; line-height: 1.6; color: var(--muted); }

.qg-panel { display: flex; flex-direction: column; }
.qg-primary { width: 100%; padding: 11px 14px; font-size: 14px; }
.qg-primary .q-kbd { margin-left: auto; }

.qg-hint { margin-top: 12px; font-size: 12px; line-height: 1.55; color: var(--faint); }
.qg-hint-inline { margin-top: 0; }
.qg-scope { font-family: var(--font-mono); font-size: 11px; color: var(--muted); background: var(--surface-hi); border: 1px solid var(--line-2); border-radius: 4px; padding: 1px 5px; }

.qg-note {
  display: flex; align-items: center; gap: 9px; margin-top: 24px; padding-top: 18px;
  border-top: 1px solid var(--line);
  font-size: 12px; line-height: 1.5; color: var(--faint);
}
.qg-note svg { color: var(--add); flex-shrink: 0; }
`;
