// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { Clock, CornerDownLeft, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { fuzzyMatchFields } from "../../lib/fuzzy.ts";
import { formatRelativeTime } from "../../lib/time.ts";
import { type PullRequest, prKey } from "../../types.ts";
import { Avatar } from "../ui/avatar.tsx";
import { Badge } from "../ui/badge.tsx";
import { HighlightIndices } from "../ui/highlight.tsx";
import { Kbd } from "../ui/kbd.tsx";

interface SearchResult {
  hl: Record<string, number[]>;
  pr: PullRequest;
}

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
      return prs
        .slice(0, 8)
        .map((pr) => ({ hl: {} as Record<string, number[]>, pr }));
    }

    const out: (SearchResult & { score: number })[] = [];
    for (const pr of prs) {
      const m = fuzzyMatchFields(q, {
        author: pr.author,
        number: `#${pr.number}`,
        repo: pr.repo,
        title: pr.title,
      });
      if (m) {
        out.push({ hl: m.indices, pr, score: m.score });
      }
    }
    out.sort((a, b) => b.score - a.score);
    return out;
  }, [query, prs]);

  const close = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const openResult = useCallback(
    (pr: PullRequest) => {
      onOpen(pr);
      onOpenChange(false);
    },
    [onOpen, onOpenChange]
  );

  const onQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value),
    []
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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
          openResult(r.pr);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    },
    [close, openResult, results, sel]
  );

  useEffect(() => setSel(0), []);
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
  }, []);

  if (!open) {
    return null;
  }

  const empty = query.trim().length > 0 && results.length === 0;

  return (
    <>
      <button
        aria-label="Close search"
        className="q-overlay"
        onClick={close}
        type="button"
      />
      <div
        aria-label="Search pull requests"
        aria-modal="true"
        className="q-dialog q-dialog-top qsp-panel"
        role="dialog"
      >
        <div className="qsp-search">
          <Search aria-hidden className="qsp-search-icon" size={17} />
          <input
            aria-expanded
            autoComplete="off"
            className="qsp-input"
            onChange={onQueryChange}
            onKeyDown={onKeyDown}
            placeholder="Search all pull requests…"
            ref={inputRef}
            role="combobox"
            spellCheck={false}
            value={query}
          />
          <Kbd combo="esc" />
        </div>

        <div className="qsp-list" ref={listRef} role="listbox">
          {!query.trim() && results.length > 0 ? (
            <div className="qsp-section">
              <Clock aria-hidden size={12} /> Pull requests
            </div>
          ) : null}
          {results.map(({ pr, hl }, i) => (
            <SearchResultRow
              hl={hl}
              index={i}
              key={prKey(pr)}
              onOpen={openResult}
              onSelect={setSel}
              pr={pr}
              selected={i === sel}
            />
          ))}
          {empty ? (
            <div className="qsp-empty">
              <Search aria-hidden size={20} />
              <p>No pull requests match “{query.trim()}”.</p>
              <span>Try a number, author, or repo.</span>
            </div>
          ) : null}
        </div>

        <div className="qsp-foot">
          <span>
            <Kbd combo="up" />
            <Kbd combo="down" /> navigate
          </span>
          <span>
            <CornerDownLeft aria-hidden size={11} /> open
          </span>
          <span className="qsp-foot-scope">searching all tabs</span>
        </div>
      </div>
    </>
  );
}

function SearchResultRow({
  pr,
  hl,
  index,
  selected,
  onOpen,
  onSelect,
}: {
  pr: PullRequest;
  hl: Record<string, number[]>;
  index: number;
  selected: boolean;
  onOpen: (pr: PullRequest) => void;
  onSelect: (index: number) => void;
}) {
  const handleClick = useCallback(() => {
    onOpen(pr);
  }, [onOpen, pr]);

  const handleMouseMove = useCallback(() => {
    onSelect(index);
  }, [index, onSelect]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen(pr);
      }
    },
    [onOpen, pr]
  );

  return (
    <div
      aria-selected={selected}
      className={cn("qsp-row", selected && "qsp-row-on")}
      data-active={selected}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseMove={handleMouseMove}
      role="option"
      tabIndex={0}
    >
      <span aria-hidden className="qsp-rail" />
      <span className="qsp-num">
        <HighlightIndices indices={hl.number} text={`#${pr.number}`} />
      </span>
      <span className="qsp-main">
        <span className="qsp-title">
          <span>
            <HighlightIndices indices={hl.title} text={pr.title} />
          </span>
          {pr.draft ? <Badge tone="warning">Draft</Badge> : null}
          {pr.merged ? <Badge tone="accent">Merged</Badge> : null}
        </span>
        <span className="qsp-meta">
          <Avatar name={pr.author} size={14} url={pr.authorAvatarUrl} />
          <span>
            <HighlightIndices indices={hl.author} text={pr.author} />
          </span>
          <span className="q-dot">·</span>
          <span>
            <HighlightIndices indices={hl.repo} text={pr.repo} />
          </span>
        </span>
      </span>
      <span className="qsp-time q-mono">
        {formatRelativeTime(pr.updatedAt)}
      </span>
    </div>
  );
}
