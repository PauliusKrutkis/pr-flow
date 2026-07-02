import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Clock, CornerDownLeft } from "lucide-react";
import type { PullRequest } from "../../types";
import { formatRelativeTime } from "../../lib/time";
import { Avatar } from "../ui/Avatar";
import { Kbd } from "../ui/Kbd";
import { Badge } from "../ui/Badge";
import { HighlightIndices } from "../ui/Highlight";
import { fuzzyMatchFields } from "../../lib/fuzzy";

/**
 * Search pane — the Superhuman move: `/` doesn't drop a filter field into the
 * list, it takes over with a full pane searching every tab by number, title,
 * author, or repo. Empty, it offers the current PRs so reopening is one
 * keystroke away. Arrows walk results, Enter opens, Esc closes.
 */
export function SearchPane({
  open,
  onOpenChange,
  prs,
  onOpen,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  prs: PullRequest[];
  onOpen: (pr: PullRequest) => void;
}) {
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) {
      return prs.slice(0, 8).map((pr) => ({ pr, hl: {} as Record<string, number[]> }));
    }
    // Fuzzy across every visible field; rank by the best-matching field.
    const out: { pr: PullRequest; hl: Record<string, number[]>; score: number }[] = [];
    for (const pr of prs) {
      const m = fuzzyMatchFields(q, {
        title: pr.title,
        number: `#${pr.number}`,
        author: pr.author,
        repo: pr.repo,
      });
      if (m) out.push({ pr, hl: m.indices, score: m.score });
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }, [query, prs]);

  useEffect(() => setSel(0), [query]);
  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const empty = query.trim().length > 0 && results.length === 0;

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const r = results[sel];
      if (r) {
        onOpen(r.pr);
        onOpenChange(false);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
    }
  }

  return (
    <div
      className="q-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="q-dialog q-dialog-top qsp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search pull requests"
      >
        <div className="qsp-search">
          <Search size={17} className="qsp-search-icon" aria-hidden />
          <input
            ref={inputRef}
            className="qsp-input"
            placeholder="Search all pull requests…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded
            autoComplete="off"
            spellCheck={false}
          />
          <Kbd combo="esc" />
        </div>

        <div className="qsp-list" role="listbox" ref={listRef}>
          {!query.trim() && results.length > 0 && (
            <div className="qsp-section">
              <Clock size={12} aria-hidden /> Pull requests
            </div>
          )}
          {results.map(({ pr, hl }, i) => (
            <div
              key={pr.id}
              role="option"
              aria-selected={i === sel}
              data-active={i === sel}
              className={"qsp-row" + (i === sel ? " qsp-row-on" : "")}
              onMouseMove={() => setSel(i)}
              onClick={() => {
                onOpen(pr);
                onOpenChange(false);
              }}
            >
              <span className="qsp-rail" aria-hidden />
              <span className="qsp-num">
                <HighlightIndices text={`#${pr.number}`} indices={hl.number ?? []} />
              </span>
              <span className="qsp-main">
                <span className="qsp-title">
                  <span>
                    <HighlightIndices text={pr.title} indices={hl.title ?? []} />
                  </span>
                  {pr.draft && <Badge tone="warning">Draft</Badge>}
                  {pr.merged && <Badge tone="accent">Merged</Badge>}
                </span>
                {/* Each field is wrapped in its own span: the meta row is a flex
                    container, and bare highlight fragments would become flex
                    items — the gap would split the word around the mark. */}
                <span className="qsp-meta">
                  <Avatar url={pr.authorAvatarUrl} name={pr.author} size={14} />
                  <span>
                    <HighlightIndices text={pr.author} indices={hl.author ?? []} />
                  </span>
                  <span className="q-dot">·</span>
                  <span>
                    <HighlightIndices text={pr.repo} indices={hl.repo ?? []} />
                  </span>
                </span>
              </span>
              <span className="qsp-time q-mono">
                {formatRelativeTime(pr.updatedAt)}
              </span>
            </div>
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
          <span>
            <Kbd combo="up" />
            <Kbd combo="down" /> navigate
          </span>
          <span>
            <CornerDownLeft size={11} aria-hidden /> open
          </span>
          <span className="qsp-foot-scope">searching all tabs</span>
        </div>
      </div>
    </div>
  );
}
