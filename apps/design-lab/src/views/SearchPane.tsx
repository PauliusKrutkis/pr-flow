import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogContent } from "../ui/dialog";
import { Avatar, Kbd, StatePill } from "../primitives";
import { relativeTime } from "../mock";
import { RECENT_PRS, searchPRs, type InboxPR } from "../inbox-mock";
import { Search, Clock, CornerDownLeft } from "lucide-react";

/**
 * Search pane — the Superhuman move: `/` doesn't drop a filter field into the
 * list, it takes over with a full pane. Empty, it offers your recently opened
 * PRs so the fastest path (reopen the thing you just closed) is one keystroke
 * away. As you type it searches every tab by number, title, author, or repo.
 * Arrow keys walk results, Enter opens, Esc closes.
 */
export default function SearchPane({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => searchPRs(query), [query]);
  const showing = query.trim() ? results : RECENT_PRS;

  // Reset selection whenever the query changes; keep it in range.
  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [sel]);
  // Fresh query each time the pane opens.
  useEffect(() => {
    if (open) { setQuery(""); setSel(0); }
  }, [open]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, showing.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      onOpenChange(false);
    }
  }

  const empty = query.trim().length > 0 && results.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="top"
        className="qsp-panel"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).querySelector("input")?.focus();
        }}
        aria-label="Search pull requests"
      >
        <DialogPrimitive.Title className="qsp-sr">Search pull requests</DialogPrimitive.Title>

        <div className="qsp-search">
          <Search size={17} className="qsp-search-icon" aria-hidden />
          <input
            className="qsp-input"
            placeholder="Search all pull requests…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            aria-controls="qsp-list"
            aria-activedescendant={showing[sel] ? `qsp-r-${showing[sel].number}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <Kbd>esc</Kbd>
        </div>

        <div className="qsp-list" id="qsp-list" role="listbox" ref={listRef} aria-label="Results">
          {!query.trim() && (
            <div className="qsp-section">
              <Clock size={12} aria-hidden /> Recently opened
            </div>
          )}
          {showing.map((pr, i) => (
            <ResultRow key={pr.number} pr={pr} active={i === sel} onSelect={() => setSel(i)} />
          ))}
          {empty && (
            <div className="qsp-empty">
              <Search size={20} aria-hidden />
              <p>No pull requests match “{query.trim()}”.</p>
              <span>Try a number, author, or repo.</span>
            </div>
          )}
        </div>

        <div className="qsp-foot">
          <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span><CornerDownLeft size={11} aria-hidden /> open</span>
          <span className="qsp-foot-scope">searching all tabs</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResultRow({ pr, active, onSelect }: { pr: InboxPR; active: boolean; onSelect: () => void }) {
  return (
    <div
      id={`qsp-r-${pr.number}`}
      role="option"
      aria-selected={active}
      data-active={active}
      className={"qsp-row" + (active ? " qsp-row-on" : "")}
      onMouseMove={onSelect}
    >
      <span className="qsp-rail" aria-hidden />
      <span className="qsp-num">#{pr.number}</span>
      <span className="qsp-main">
        <span className="qsp-title">
          {pr.title}
          {(pr.draft || pr.state === "merged") && <StatePill draft={pr.draft} state={pr.state} />}
        </span>
        <span className="qsp-meta">
          <Avatar user={pr.author} size={14} />
          {pr.author.name}
          <span className="q-dot">·</span>
          {pr.repo}
        </span>
      </span>
      <span className="qsp-time q-mono">{relativeTime(pr.updatedAt)}</span>
    </div>
  );
}

const CSS = `
.qsp-panel { width: min(680px, calc(100vw - 32px)); max-height: 70vh; padding: 0; }
.qsp-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.qsp-search { display: flex; align-items: center; gap: 12px; padding: 17px 20px; border-bottom: 1px solid var(--line); }
.qsp-search-icon { color: var(--faint); flex-shrink: 0; }
.qsp-input { flex: 1; background: transparent; border: none; outline: none; font-family: var(--font-ui); font-size: 16px; color: var(--fg); }
.qsp-input::placeholder { color: var(--faint); }

.qsp-list { overflow-y: auto; padding: 8px; flex: 1; }
.qsp-section { display: flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); padding: 8px 10px 6px; }

.qsp-row {
  position: relative; display: flex; align-items: center; gap: 12px;
  padding: 10px 12px 10px 14px; border-radius: 10px; cursor: pointer; color: var(--muted);
}
.qsp-rail { position: absolute; left: 3px; top: 9px; bottom: 9px; width: 2px; border-radius: 999px; background: transparent; }
.qsp-row-on { background: var(--accent-soft); color: var(--fg); }
.qsp-row-on .qsp-rail { background: var(--accent); box-shadow: 0 0 10px 0 var(--accent-line); }
.qsp-num { font-family: var(--font-mono); font-size: 12px; color: var(--faint); flex-shrink: 0; min-width: 40px; }
.qsp-row-on .qsp-num { color: var(--accent); }
.qsp-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.qsp-title { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--fg); font-weight: 500; }
.qsp-title > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qsp-meta { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); }
.qsp-time { font-size: 11px; color: var(--faint); flex-shrink: 0; }

.qsp-empty { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 44px 16px; text-align: center; color: var(--faint); }
.qsp-empty svg { color: var(--accent); opacity: 0.8; margin-bottom: 4px; }
.qsp-empty p { font-size: 14px; color: var(--fg); }
.qsp-empty span { font-size: 12px; }

.qsp-foot { display: flex; align-items: center; gap: 18px; padding: 10px 20px; border-top: 1px solid var(--line); background: var(--surface-2); }
.qsp-foot span { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--faint); }
.qsp-foot-scope { margin-left: auto; font-family: var(--font-mono); }
`;

// The pane styles are global (portalled content lives outside .dir-quiet); inject once.
if (typeof document !== "undefined" && !document.getElementById("qsp-style")) {
  const el = document.createElement("style");
  el.id = "qsp-style";
  el.textContent = CSS;
  document.head.appendChild(el);
}
