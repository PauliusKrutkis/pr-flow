/**
 * A static, non-interactive snapshot of the review screen, used behind the
 * overlay views (palette, help, submit) so they read as real moments in the app
 * rather than floating cards. It is aria-hidden and pointer-events:none — the
 * live overlay owns focus and interaction.
 */

import { Avatar, StatePill } from "../primitives";
import { REVIEW } from "../mock";

export default function Backdrop() {
  const { pr, files } = REVIEW;
  return (
    <div className="qbk" aria-hidden>
      <style>{CSS}</style>
      <aside className="qbk-side">
        <div className="qbk-side-head">
          <span className="q-eyebrow">Files</span>
          <span className="q-mono qbk-side-count">2/8 viewed</span>
        </div>
        <div className="qbk-side-list">
          {files.slice(0, 7).map((f, i) => (
            <div key={f.filename} className={"qbk-file" + (i === 0 ? " qbk-file-on" : "")}>
              <span className="qbk-file-name">{f.filename.split("/").pop()}</span>
              <span className="q-mono qbk-file-stat">
                <span className="q-add">+{f.additions}</span>
                <span className="q-del">−{f.deletions}</span>
              </span>
            </div>
          ))}
        </div>
      </aside>
      <main className="qbk-main">
        <header className="qbk-head">
          <div className="qbk-head-title">
            <StatePill state="open" />
            <span className="qbk-pr-title">{pr.title}</span>
          </div>
          <div className="qbk-head-sub">
            <span className="q-mono q-faint">#{pr.number}</span>
            <span className="q-dot">·</span>
            <span className="q-faint">{pr.repo}</span>
            <span className="q-dot">·</span>
            <Avatar user={pr.author} size={15} />
            <span className="q-muted">{pr.author.name}</span>
          </div>
        </header>
        <div className="qbk-diff">
          {["import { useEffect, useRef } from \"react\";",
            "import { useKeyboardContext } from \"./KeyboardProvider\";",
            "export function useHotkeys(scope, bindings, opts = {}) {",
            "  const ctx = useKeyboardContext();",
            "  const ref = useRef(bindings);",
            "  ref.current = bindings;",
            "  useEffect(() => {",
            "    const unregister = ctx.register(scope, ref.current, opts);",
            "    if (opts.activate !== false) ctx.activate(scope);",
            "    return unregister;",
            "  }, [scope, ctx, opts.activate]);",
            "}"].map((line, i) => (
            <div key={i} className={"qbk-line" + (i === 4 ? " qbk-line-add" : "")}>
              <span className="qbk-ln">{i + 1}</span>
              <span className="qbk-code">{line}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

const CSS = `
.qbk {
  position: absolute; inset: 0; display: grid;
  grid-template-columns: 280px 1fr;
  pointer-events: none; user-select: none; filter: saturate(0.9);
}
.qbk-side { border-right: 1px solid var(--line); background: var(--surface); }
.qbk-side-head { display: flex; align-items: baseline; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.qbk-side-count { font-size: 11px; color: var(--faint); }
.qbk-side-list { padding: 6px; }
.qbk-file { display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 7px; font-size: 12.5px; color: var(--muted); }
.qbk-file-on { background: var(--accent-soft); color: var(--fg); box-shadow: inset 0 0 0 1px var(--accent-line); }
.qbk-file-name { font-family: var(--font-mono); font-size: 12px; }
.qbk-file-stat { font-size: 11px; display: flex; gap: 5px; }

.qbk-main { display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
.qbk-head { padding: 14px 22px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, var(--surface-2), var(--bg)); }
.qbk-head-title { display: flex; align-items: center; gap: 10px; }
.qbk-pr-title { font-size: 15px; font-weight: 600; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qbk-head-sub { display: flex; align-items: center; gap: 8px; margin-top: 7px; font-size: 12px; color: var(--muted); }

.qbk-diff { padding: 12px 0; font-family: var(--font-mono); font-size: 12.5px; line-height: 1.7; }
.qbk-line { display: grid; grid-template-columns: 52px 1fr; }
.qbk-line-add { background: var(--add-bg); }
.qbk-ln { text-align: right; padding-right: 16px; color: var(--faint); font-size: 11px; }
.qbk-code { color: var(--fg); white-space: pre; }
`;
