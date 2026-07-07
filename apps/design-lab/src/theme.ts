// ---------------------------------------------------------------------------
// The Quiet design system, extracted from the Review screen (directions/quiet.tsx)
// into a shared base so every other view speaks the same language.
//
// Two rules make this safe to share:
//   1. Tokens live on :root (not .dir-quiet), so Radix portals — which mount on
//      document.body, outside any view root — still resolve var(--accent).
//   2. Shared primitives use a flat `q-` prefix and are unscoped, so they apply
//      to portalled content too. View-specific classes use their own prefixes
//      (qi- inbox, qc- palette, qh- help, qs- submit, qg- gate, qb- chrome).
//
// The palette, type, motion, and focus ring are copied verbatim from Quiet so
// the two are indistinguishable. Quiet keeps its own hermetic copy (it predates
// this file); this is the reference for everything new.
// ---------------------------------------------------------------------------

export const BASE_CSS = `
:root {
  --bg: #0f0f17;
  --surface: #15151f;
  --surface-2: #191924;
  --surface-hi: #1c1c2a;
  --line: #232334;
  --line-2: #2c2c40;
  --fg: #e8e8f3;
  --muted: #9a9ab2;
  --faint: #5f5f78;
  --accent: #8b80ff;
  --accent-soft: rgba(139, 128, 255, 0.16);
  --accent-line: rgba(139, 128, 255, 0.40);
  --accent-ink: #14111f;
  --add: #5fd08a;
  --del: #ff7088;
  --warn: #e7c56a;
  --add-bg: rgba(95, 208, 138, 0.10);
  --del-bg: rgba(255, 112, 136, 0.10);
  --warn-bg: rgba(231, 197, 106, 0.12);
  --font-ui: Inter, system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;
}

/* ---- view root: sets type + the barely-there iris lift ---- */
.dir-quiet {
  position: relative;
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.45;
  letter-spacing: -0.005em;
  -webkit-font-smoothing: antialiased;
  outline: none;
}
.dir-quiet.q-glow::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(1200px 600px at 22% -10%, rgba(139,128,255,0.06), transparent 60%);
  pointer-events: none;
}

/* ---- one focus-ring treatment, everywhere ---- */
.q-focus:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1.5px var(--bg), 0 0 0 3px var(--accent);
  border-radius: 7px;
}

/* ---- text helpers ---- */
.q-add { color: var(--add); }
.q-del { color: var(--del); }
.q-muted { color: var(--muted); }
.q-faint { color: var(--faint); }
.q-dot { color: var(--faint); }
.q-mono { font-family: var(--font-mono); }

/* ---- eyebrow / section micro-label ---- */
.q-eyebrow {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

/* ---- keycap ---- */
.q-kbd {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  color: var(--muted);
  background: var(--surface-hi);
  border: 1px solid var(--line-2);
  border-radius: 4px;
  padding: 3px 5px;
  min-width: 16px;
  text-align: center;
  display: inline-block;
  box-shadow: 0 1px 0 rgba(0,0,0,0.35);
}

/* ---- avatar ---- */
.q-avatar {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  border-radius: 999px;
  font-weight: 600;
  color: #fff;
}

/* ---- status glyph (file / PR change kind) ---- */
.q-glyph {
  display: grid;
  place-items: center;
  width: 17px;
  height: 17px;
  flex-shrink: 0;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
}
.q-glyph-add { color: var(--add); background: var(--add-bg); }
.q-glyph-mod { color: var(--warn); background: var(--warn-bg); }
.q-glyph-del { color: var(--del); background: var(--del-bg); }
.q-glyph-ren { color: var(--accent); background: var(--accent-soft); }

/* ---- state / status pills ---- */
.q-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  white-space: nowrap;
}
.q-pill-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.q-pill-open { color: var(--add); background: var(--add-bg); box-shadow: inset 0 0 0 1px rgba(95,208,138,0.25); }
.q-pill-draft { color: var(--muted); background: var(--surface-hi); box-shadow: inset 0 0 0 1px var(--line-2); }
.q-pill-merged { color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-line); }
.q-pill-approved { color: var(--add); background: var(--add-bg); }
.q-pill-changes { color: var(--del); background: var(--del-bg); }
.q-pill-commented { color: var(--accent); background: var(--accent-soft); }
.q-pill-pending { color: var(--muted); background: var(--surface-hi); box-shadow: inset 0 0 0 1px var(--line-2); }

/* ---- buttons ---- */
.q-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 7px 13px;
  border-radius: 8px;
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, filter 120ms ease;
  white-space: nowrap;
}
.q-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.q-btn-primary { color: var(--accent-ink); background: var(--accent); border-color: var(--accent); }
.q-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
.q-btn-primary .q-kbd { color: var(--accent-ink); background: rgba(20,17,31,0.16); border-color: rgba(20,17,31,0.22); box-shadow: none; }
.q-btn-quiet { color: var(--fg); background: var(--surface); border-color: var(--line); }
.q-btn-quiet:hover:not(:disabled) { background: var(--surface-hi); border-color: var(--line-2); }
.q-btn-ghost { color: var(--muted); background: transparent; }
.q-btn-ghost:hover:not(:disabled) { color: var(--fg); background: var(--surface-2); }
.q-btn-danger { color: var(--del); background: var(--del-bg); border-color: rgba(255,112,136,0.30); }
.q-btn-danger:hover:not(:disabled) { background: rgba(255,112,136,0.16); border-color: var(--del); }

.q-btn-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: var(--accent-ink);
  border-radius: 999px;
  padding: 1px 7px;
  line-height: 1.5;
}

/* ---- inputs ---- */
.q-input {
  width: 100%;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--fg);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 9px 12px;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.q-input::placeholder { color: var(--faint); }
.q-input:focus {
  outline: none;
  border-color: var(--accent-line);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
textarea.q-input { resize: none; line-height: 1.5; }

/* ---- card / surface ---- */
.q-card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 12px;
}

/* =========================================================================
   shadcn primitives, Quiet-themed
   ========================================================================= */

/* Dialog (overlay + content) — used by palette, help, submit */
.q-overlay {
  position: fixed;
  inset: 0;
  background: rgba(6,6,12,0.62);
  backdrop-filter: blur(2px);
  z-index: 50;
  animation: q-fade 120ms ease;
}
.q-dialog {
  position: fixed;
  z-index: 51;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(560px, calc(100vw - 32px));
  max-height: min(78vh, 640px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line-2);
  border-radius: 14px;
  box-shadow: 0 24px 64px -24px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,128,255,0.06);
  overflow: hidden;
  animation: q-pop 130ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
.q-dialog:focus { outline: none; }
.q-dialog-top {
  top: 14vh;
  transform: translate(-50%, 0);
  width: min(620px, calc(100vw - 32px));
  animation: q-pop-top 130ms cubic-bezier(0.2, 0.8, 0.2, 1);
}
@keyframes q-fade { from { opacity: 0; } }
@keyframes q-pop { from { opacity: 0; transform: translate(-50%, -48%) scale(0.98); } }
@keyframes q-pop-top { from { opacity: 0; transform: translate(-50%, -6px) scale(0.99); } }

/* Tabs */
.q-tabs-list {
  display: flex;
  align-items: center;
  gap: 2px;
}
.q-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.q-tab:hover { color: var(--fg); background: var(--surface-2); }
.q-tab[data-state="active"] { color: var(--fg); background: var(--surface-hi); }
.q-tab-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 0 6px;
  line-height: 16px;
  min-width: 20px;
  text-align: center;
}
.q-tab[data-state="active"] .q-tab-count { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); }

/* Tooltip */
.q-tooltip {
  font-family: var(--font-ui);
  font-size: 11.5px;
  color: var(--fg);
  background: var(--surface-hi);
  border: 1px solid var(--line-2);
  border-radius: 7px;
  padding: 5px 9px;
  box-shadow: 0 8px 24px -12px rgba(0,0,0,0.6);
  animation: q-fade 100ms ease;
  z-index: 60;
}
.q-tooltip .q-kbd { margin-left: 5px; }
.q-tooltip-arrow { fill: var(--surface-hi); }

/* =========================================================================
   Markdown + syntax tokens (shared with Quiet)
   ========================================================================= */
.md { font-family: var(--font-ui); color: #d6d6e6; font-size: 13px; line-height: 1.6; }
.md > *:first-child { margin-top: 0; }
.md > *:last-child { margin-bottom: 0; }
.md h2 { font-size: 15px; font-weight: 600; color: var(--fg); margin: 18px 0 8px; }
.md h3 { font-size: 13px; font-weight: 600; color: var(--fg); margin: 16px 0 6px; letter-spacing: 0.02em; }
.md h4 { font-size: 12px; font-weight: 600; color: var(--muted); margin: 12px 0 4px; }
.md p { margin: 8px 0; }
.md ul { margin: 8px 0; padding-left: 18px; list-style: none; }
.md li { position: relative; margin: 4px 0; }
.md li::before { content: ""; position: absolute; left: -14px; top: 9px; width: 4px; height: 4px; border-radius: 999px; background: var(--accent); opacity: 0.7; }
.md a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-line); }
.md a:hover { border-bottom-color: var(--accent); }
.md strong { color: var(--fg); font-weight: 600; }
.md em { color: var(--muted); font-style: italic; }
.md code { font-family: var(--font-mono); font-size: 11.5px; color: #c4b6ff; background: var(--surface-hi); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; }
.md pre { font-family: var(--font-mono); background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 12px; overflow-x: auto; margin: 10px 0; }
.md pre code { border: none; background: none; padding: 0; color: var(--fg); }
.md blockquote { margin: 10px 0; padding: 4px 0 4px 14px; border-left: 2px solid var(--accent-line); color: var(--muted); }

.tk-kw   { color: #c4b6ff; }
.tk-str  { color: #8fe3b0; }
.tk-num  { color: #ffc48a; }
.tk-com  { color: var(--faint); font-style: italic; }
.tk-fn   { color: #7fc8ff; }
.tk-type { color: #ffd9a0; }
.tk-punct{ color: #b6b6cf; }
.tk-plain{ color: var(--fg); }

/* =========================================================================
   Reduced motion
   ========================================================================= */
@media (prefers-reduced-motion: reduce) {
  .dir-quiet *, .dir-quiet *::before, .dir-quiet *::after,
  .q-overlay, .q-dialog, .q-tooltip {
    animation-duration: 0ms !important;
    transition-duration: 0ms !important;
  }
}
`;
