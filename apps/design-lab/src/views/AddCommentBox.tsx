import { useState } from "react";
import { Tokens } from "../highlight";
import { Kbd, Avatar } from "../primitives";
import { PEOPLE, parsePatch, REVIEW } from "../mock";
import { Layers, Send } from "lucide-react";

/**
 * Add-comment box — the inline composer, shown in context under a diff line
 * (which is where it always appears; a comment is meaningless without its line).
 * The one real choice it offers is batch vs. now: "Add to review" holds the
 * comment with the others until you submit, "Comment now" posts it immediately.
 * A segmented control makes that the explicit mode, and the primary button keeps
 * whichever name the mode chose.
 */
export default function AddCommentBox() {
  const [mode, setMode] = useState<"batch" | "now">("batch");
  const [body, setBody] = useState("nit: name this `bindingsRef` for symmetry with the rest of the file.");

  const file = REVIEW.files[0];
  const rows = parsePatch(file.patch)[0].rows.slice(0, 9);
  // anchor the composer under the first added line
  const anchor = rows.findIndex((r) => r.type === "add");

  return (
    <div className="dir-quiet q-glow qa-root">
      <style>{CSS}</style>

      <div className="qa-frame">
        <div className="qa-filebar">
          <span className="q-glyph q-glyph-mod">M</span>
          <span className="qa-filename">{file.filename}</span>
          <span className="q-mono qa-filestat">
            <span className="q-add">+{file.additions}</span>
            <span className="q-del">−{file.deletions}</span>
          </span>
        </div>

        <div className="qa-diff">
          {rows.map((r, i) => {
            const marker = r.type === "add" ? "+" : r.type === "del" ? "-" : " ";
            return (
              <div key={i}>
                <div className={"qa-line qa-line-" + r.type}>
                  <span className="qa-ln">{r.type === "del" ? r.oldLine : r.newLine ?? ""}</span>
                  <span className="qa-mk">{marker}</span>
                  <code className="qa-code">
                    {r.content === "" ? " " : <Tokens line={r.content} language={file.language} />}
                  </code>
                </div>
                {i === anchor && (
                  <div className="qa-composer" role="form" aria-label="Add a comment on this line">
                    <div className="qa-composer-head">
                      <Avatar user={PEOPLE.you} size={22} />
                      <span className="qa-you">You</span>
                      <span className="qa-on-line">on line {r.newLine}</span>
                    </div>

                    <textarea
                      className="q-input qa-textarea"
                      rows={3}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      aria-label="Comment body"
                      placeholder="Leave a comment…  ⌘↵ to save"
                    />

                    <div className="qa-composer-foot">
                      <div className="qa-seg" role="radiogroup" aria-label="When to post">
                        <button
                          type="button" role="radio" aria-checked={mode === "batch"}
                          className={"qa-seg-btn q-focus" + (mode === "batch" ? " qa-seg-on" : "")}
                          onClick={() => setMode("batch")}
                        >
                          <Layers size={13} aria-hidden />
                          Add to review
                        </button>
                        <button
                          type="button" role="radio" aria-checked={mode === "now"}
                          className={"qa-seg-btn q-focus" + (mode === "now" ? " qa-seg-on" : "")}
                          onClick={() => setMode("now")}
                        >
                          <Send size={13} aria-hidden />
                          Comment now
                        </button>
                      </div>

                      <div className="qa-actions">
                        <button type="button" className="q-btn q-btn-ghost">Cancel <Kbd>esc</Kbd></button>
                        <button type="button" className="q-btn q-btn-primary" disabled={!body.trim()}>
                          {mode === "batch" ? "Add to review" : "Comment now"}
                          <Kbd>⌘↵</Kbd>
                        </button>
                      </div>
                    </div>

                    <p className="qa-explain">
                      {mode === "batch"
                        ? "Held with your other pending comments until you submit the review."
                        : "Posted to the PR immediately, on its own."}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const CSS = `
.qa-root { display: grid; place-items: center; padding: 32px; overflow-y: auto; }
.qa-frame { width: min(760px, 100%); background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; box-shadow: 0 24px 64px -40px rgba(0,0,0,0.7); }

.qa-filebar { display: flex; align-items: center; gap: 10px; padding: 11px 16px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
.qa-filename { font-family: var(--font-mono); font-size: 12px; color: var(--fg); }
.qa-filestat { font-size: 11px; display: flex; gap: 6px; margin-left: auto; }

.qa-diff { font-family: var(--font-mono); font-size: 12.5px; line-height: 1.6; padding: 8px 0; }
.qa-line { display: grid; grid-template-columns: 48px 20px 1fr; padding: 1px 16px 1px 0; }
.qa-line-add { background: var(--add-bg); }
.qa-line-del { background: var(--del-bg); }
.qa-ln { text-align: right; padding-right: 12px; color: var(--faint); font-size: 11px; user-select: none; }
.qa-mk { text-align: center; color: var(--faint); user-select: none; }
.qa-line-add .qa-mk { color: var(--add); }
.qa-line-del .qa-mk { color: var(--del); }
.qa-code { color: var(--fg); white-space: pre-wrap; word-break: break-word; }

.qa-composer { margin: 8px 16px 12px 66px; padding: 13px; border: 1px solid var(--accent-line); border-radius: 11px; background: linear-gradient(0deg, var(--accent-soft), var(--accent-soft)), var(--surface); font-family: var(--font-ui); }
.qa-composer-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.qa-you { font-size: 12.5px; font-weight: 600; color: var(--fg); }
.qa-on-line { font-family: var(--font-mono); font-size: 11px; color: var(--faint); }
.qa-textarea { background: var(--bg); min-height: 64px; }

.qa-composer-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 11px; flex-wrap: wrap; }
.qa-seg { display: inline-flex; padding: 3px; border-radius: 9px; background: var(--bg); border: 1px solid var(--line); }
.qa-seg-btn { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: 7px; font-size: 12.5px; font-weight: 500; color: var(--muted); background: transparent; border: none; cursor: pointer; transition: color 120ms ease, background-color 120ms ease; }
.qa-seg-btn:hover { color: var(--fg); }
.qa-seg-on { color: var(--fg); background: var(--surface-hi); box-shadow: inset 0 0 0 1px var(--line-2); }
.qa-seg-on svg { color: var(--accent); }

.qa-actions { display: flex; align-items: center; gap: 8px; }
.qa-explain { margin-top: 10px; font-size: 11.5px; color: var(--faint); line-height: 1.5; }
`;
