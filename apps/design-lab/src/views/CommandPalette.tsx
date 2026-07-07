import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Dialog, DialogContent } from "../ui/dialog";
import { Kbd, Avatar } from "../primitives";
import Backdrop from "./Backdrop";
import { INBOX } from "../inbox-mock";
import {
  Search, ArrowRight, Check, XCircle, MessageSquarePlus,
  PanelRight, Inbox as InboxIcon, Link2, ExternalLink, Command,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Command palette (⌘K) — the second way in. Built on the Radix dialog for the
 * accessibility floor (focus trap, ESC, scroll lock) with a combobox pattern
 * over it: the input keeps focus and drives an aria-activedescendant listbox,
 * so the whole thing is arrow-key navigable without ever leaving the field.
 * The selected row wears the same iris left-rail as the inbox cursor.
 */

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  keys?: string[];
}

const COMMANDS: Cmd[] = [
  { id: "submit", label: "Submit review", hint: "1 pending", icon: Check, keys: ["s"] },
  { id: "approve", label: "Approve", icon: Check },
  { id: "request", label: "Request changes", icon: XCircle },
  { id: "comment", label: "Add comment on line", icon: MessageSquarePlus, keys: ["c"] },
  { id: "info", label: "Toggle PR info", icon: PanelRight, keys: ["i"] },
  { id: "inbox", label: "Go to inbox", icon: InboxIcon, keys: ["esc"] },
  { id: "copy", label: "Copy PR link", icon: Link2 },
  { id: "open", label: "Open on GitHub", icon: ExternalLink },
];

export default function CommandPalette() {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const q = query.trim().toLowerCase();

  const cmds = useMemo(
    () => (q ? COMMANDS.filter((c) => c.label.toLowerCase().includes(q)) : COMMANDS),
    [q],
  );
  const prs = useMemo(() => {
    if (!q) return INBOX.slice(0, 4);
    return INBOX.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.author.name.toLowerCase().includes(q) ||
        String(p.number).includes(q),
    ).slice(0, 6);
  }, [q]);

  const flat = useMemo(
    () => [
      ...cmds.map((c) => ({ group: "cmd" as const, id: c.id })),
      ...prs.map((p) => ({ group: "pr" as const, id: String(p.number) })),
    ],
    [cmds, prs],
  );

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const activeId = flat[sel] ? `qc-opt-${flat[sel].group}-${flat[sel].id}` : undefined;
  let idx = -1;

  return (
    <div className="dir-quiet qc-root">
      <style>{CSS}</style>
      <Backdrop />

      {!open && (
        <button type="button" className="qc-reopen q-focus" onClick={() => setOpen(true)}>
          <Command size={14} aria-hidden />
          Open command palette
          <Kbd>⌘K</Kbd>
        </button>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          variant="top"
          className="qc-panel"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
          aria-label="Command palette"
        >
          <DialogPrimitive.Title className="qc-sr">Command palette</DialogPrimitive.Title>

          <div className="qc-search">
            <Search size={16} className="qc-search-icon" aria-hidden />
            <input
              className="qc-input"
              placeholder="Run a command or jump to a PR by number, title, or author…"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSel(0); }}
              onKeyDown={onKeyDown}
              role="combobox"
              aria-expanded
              aria-controls="qc-list"
              aria-activedescendant={activeId}
              autoComplete="off"
              spellCheck={false}
            />
            <Kbd>esc</Kbd>
          </div>

          <div className="qc-list" id="qc-list" role="listbox" ref={listRef} aria-label="Results">
            {cmds.length > 0 && (
              <div className="qc-group" role="group" aria-label="Commands">
                <div className="qc-group-label">Commands</div>
                {cmds.map((c) => {
                  idx++;
                  const active = idx === sel;
                  const Icon = c.icon;
                  return (
                    <div
                      key={c.id}
                      id={`qc-opt-cmd-${c.id}`}
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      className={"qc-opt" + (active ? " qc-opt-on" : "")}
                    >
                      <span className="qc-rail" aria-hidden />
                      <Icon size={15} className="qc-opt-icon" aria-hidden />
                      <span className="qc-opt-label">{c.label}</span>
                      {c.hint && <span className="qc-opt-hint">{c.hint}</span>}
                      {c.keys?.map((k) => <Kbd key={k}>{k}</Kbd>)}
                    </div>
                  );
                })}
              </div>
            )}

            {prs.length > 0 && (
              <div className="qc-group" role="group" aria-label="Jump to PR">
                <div className="qc-group-label">Jump to PR</div>
                {prs.map((p) => {
                  idx++;
                  const active = idx === sel;
                  return (
                    <div
                      key={p.number}
                      id={`qc-opt-pr-${p.number}`}
                      role="option"
                      aria-selected={active}
                      data-active={active}
                      className={"qc-opt qc-opt-pr" + (active ? " qc-opt-on" : "")}
                    >
                      <span className="qc-rail" aria-hidden />
                      <span className="qc-pr-num">#{p.number}</span>
                      <span className="qc-opt-label qc-pr-title">{p.title}</span>
                      <Avatar user={p.author} size={16} />
                      {active && <ArrowRight size={14} className="qc-go" aria-hidden />}
                    </div>
                  );
                })}
              </div>
            )}

            {flat.length === 0 && (
              <div className="qc-empty">
                No commands or PRs match “{query.trim()}”.
              </div>
            )}
          </div>

          <div className="qc-foot">
            <span><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
            <span><Kbd>↵</Kbd> select</span>
            <span><Kbd>esc</Kbd> close</span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const CSS = `
.qc-root { position: relative; }
.qc-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.qc-reopen {
  position: absolute; left: 50%; top: 20vh; transform: translateX(-50%); z-index: 5;
  display: inline-flex; align-items: center; gap: 9px;
  padding: 10px 16px; border-radius: 10px; font-size: 13px; color: var(--fg);
  background: var(--surface); border: 1px solid var(--line-2); cursor: pointer;
  box-shadow: 0 12px 32px -16px rgba(0,0,0,0.7);
}

.qc-panel { padding: 0; }

.qc-search { display: flex; align-items: center; gap: 11px; padding: 15px 18px; border-bottom: 1px solid var(--line); }
.qc-search-icon { color: var(--faint); flex-shrink: 0; }
.qc-input { flex: 1; background: transparent; border: none; outline: none; font-family: var(--font-ui); font-size: 15px; color: var(--fg); }
.qc-input::placeholder { color: var(--faint); }

.qc-list { overflow-y: auto; padding: 8px; flex: 1; }
.qc-group + .qc-group { margin-top: 6px; }
.qc-group-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--faint); padding: 8px 10px 6px; }

.qc-opt {
  position: relative; display: flex; align-items: center; gap: 11px;
  padding: 9px 12px 9px 14px; border-radius: 9px; cursor: pointer;
  color: var(--muted);
}
.qc-rail { position: absolute; left: 3px; top: 8px; bottom: 8px; width: 2px; border-radius: 999px; background: transparent; }
.qc-opt-on { background: var(--accent-soft); color: var(--fg); }
.qc-opt-on .qc-rail { background: var(--accent); box-shadow: 0 0 10px 0 var(--accent-line); }
.qc-opt-icon { color: var(--faint); flex-shrink: 0; }
.qc-opt-on .qc-opt-icon { color: var(--accent); }
.qc-opt-label { flex: 1; font-size: 13.5px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qc-opt-hint { font-family: var(--font-mono); font-size: 11px; color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent-line); border-radius: 999px; padding: 1px 8px; }

.qc-pr-num { font-family: var(--font-mono); font-size: 12px; color: var(--faint); flex-shrink: 0; min-width: 38px; }
.qc-opt-on .qc-pr-num { color: var(--accent); }
.qc-pr-title { font-size: 13px; }
.qc-go { color: var(--accent); flex-shrink: 0; }

.qc-empty { padding: 34px 16px; text-align: center; font-size: 13px; color: var(--faint); }

.qc-foot { display: flex; gap: 18px; padding: 10px 18px; border-top: 1px solid var(--line); background: var(--surface-2); }
.qc-foot span { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--faint); }
`;
