import { useEffect, useMemo, useRef, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { Avatar, Kbd, StatePill, ReviewerPill, DiffStat } from "../primitives";
import { relativeTime, formatAbsolute } from "../mock";
import {
  TAB_ORDER,
  TAB_LABELS,
  forTab,
  tabCount,
  PR_DETAIL,
  type InboxTab,
  type InboxPR,
} from "../inbox-mock";
import SearchPane from "./SearchPane";
import {
  MessageSquare, CircleCheck, CircleX, Clock, FileText, GitBranch, CornerDownLeft,
} from "lucide-react";

/**
 * Inbox — the home screen, in the Superhuman two-pane shape: a dense list of
 * minimal rows on the left, a reading pane on the right that expands the
 * selected PR. One row is always selected (starts on the first); ArrowUp/Down or
 * j/k walk it, a click selects it, and the whole row lights with the iris tint —
 * the same "you are here" thread the diff cursor uses. `/` doesn't filter in
 * place; it opens a full search pane (see SearchPane).
 */
export default function Inbox({ onOpenPR }: { onOpenPR?: (pr: InboxPR) => void }) {
  const [tab, setTab] = useState<InboxTab>("requests");
  const [cursor, setCursor] = useState(0);
  const [searchOpen, setSearchOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => forTab(tab), [tab]);
  const selected = rows[Math.min(cursor, rows.length - 1)];

  // Latest "open the selected PR" action, so the keyboard handler stays stable.
  const openRef = useRef<() => void>(() => {});
  openRef.current = () => selected && onOpenPR?.(selected);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [cursor, tab]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      switch (e.key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, rows.length - 1));
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case "/":
          e.preventDefault();
          setSearchOpen(true);
          break;
        case "Enter":
          e.preventDefault();
          openRef.current();
          break;
        default:
          break;
      }
    }
    const el = rootRef.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [rows.length]);

  return (
    <div ref={rootRef} tabIndex={0} className="dir-quiet q-glow qi-root">
      <style>{CSS}</style>

      <div className="qi-toolbar">
        <Tabs value={tab} onValueChange={(v) => setTab(v as InboxTab)}>
          <TabsList aria-label="Inbox sections">
            {TAB_ORDER.map((t) => {
              const count = tabCount(t);
              return (
                <TabsTrigger key={t} value={t}>
                  {TAB_LABELS[t]}
                  {count > 0 && <span className="q-tab-count">{count}</span>}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
      </div>

      <div className="qi-body">
        <div className="qi-list" role="listbox" aria-label={TAB_LABELS[tab]} ref={listRef}>
          {rows.map((pr, i) => (
            <Row
              key={pr.number}
              pr={pr}
              active={i === cursor}
              onHover={() => setCursor(i)}
              onOpen={() => onOpenPR?.(pr)}
            />
          ))}
          {rows.length === 0 && (
            <div className="qi-zero">
              <span className="qi-zero-icon" aria-hidden><FileText size={22} /></span>
              <p className="qi-zero-title">Nothing here</p>
              <p className="qi-zero-sub">
                No {TAB_LABELS[tab].toLowerCase()} right now. Press <Kbd>/</Kbd> to search every PR.
              </p>
            </div>
          )}
        </div>

        {selected ? (
          <Detail pr={selected} onOpen={() => onOpenPR?.(selected)} />
        ) : (
          <aside className="qi-detail qi-detail-empty">
            <p>Select a pull request to see its summary.</p>
          </aside>
        )}
      </div>

      <SearchPane open={searchOpen} onOpenChange={setSearchOpen} />
    </div>
  );
}

function Row({
  pr,
  active,
  onHover,
  onOpen,
}: {
  pr: InboxPR;
  active: boolean;
  onHover: () => void;
  onOpen: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={active}
      data-active={active}
      tabIndex={-1}
      onMouseEnter={onHover}
      onClick={onOpen}
      className={"qi-row" + (active ? " qi-row-active" : "") + (pr.unread ? " qi-row-unread" : "")}
    >
      <span className="qi-row-rail" aria-hidden />
      <span className="qi-row-dot" aria-hidden />
      <span className="qi-row-main">
        <span className="qi-row-title">
          {pr.title}
          {(pr.draft || pr.state === "merged") && <StatePill draft={pr.draft} state={pr.state} />}
        </span>
        <span className="qi-row-meta">
          <span className="qi-num">#{pr.number}</span>
          <span className="q-dot">·</span>
          <Avatar user={pr.author} size={14} />
          <span className="q-muted">{pr.author.name}</span>
          {pr.comments > 0 && (
            <>
              <span className="q-dot">·</span>
              <span className="qi-comments"><MessageSquare size={11} aria-hidden />{pr.comments}</span>
            </>
          )}
          {pr.checks === "failing" && (
            <>
              <span className="q-dot">·</span>
              <span className="qi-checks-fail"><CircleX size={11} aria-hidden />checks</span>
            </>
          )}
        </span>
      </span>
      <span className="qi-row-time q-mono" title={formatAbsolute(pr.updatedAt)}>
        {relativeTime(pr.updatedAt)}
      </span>
    </div>
  );
}

function Detail({ pr, onOpen }: { pr: InboxPR; onOpen: () => void }) {
  const d = PR_DETAIL[pr.number];
  return (
    <aside className="qi-detail" aria-label="Pull request detail">
      <div className="qi-d-scroll">
      <div className="qi-d-top">
        <div className="qi-d-badges">
          <StatePill draft={pr.draft} state={pr.state} />
          <span className="qi-d-num q-mono">#{pr.number}</span>
          {pr.myReview && <ReviewerPill status={pr.myReview} />}
        </div>
        <h2 className="qi-d-title">{pr.title}</h2>
        {d && (
          <div className="qi-d-branch q-mono">
            <GitBranch size={12} aria-hidden />
            main <span className="qi-d-arrow">←</span> {d.branch}
          </div>
        )}
      </div>

      <div className="qi-d-author">
        <Avatar user={pr.author} size={26} />
        <div>
          <div className="qi-d-author-name">{pr.author.name}</div>
          <div className="qi-d-author-when q-mono" title={formatAbsolute(pr.updatedAt)}>
            updated {relativeTime(pr.updatedAt)}
          </div>
        </div>
      </div>

      <div className="qi-d-stats">
        <div className="qi-d-stat">
          <DiffStat additions={pr.additions} deletions={pr.deletions} />
          <span className="qi-d-stat-lbl">changes</span>
        </div>
        <div className="qi-d-stat">
          <span className="qi-d-stat-val q-mono">{pr.changedFiles}</span>
          <span className="qi-d-stat-lbl">files</span>
        </div>
        <div className="qi-d-stat">
          <span className="qi-d-stat-val q-mono">{pr.comments}</span>
          <span className="qi-d-stat-lbl">comments</span>
        </div>
        <div className="qi-d-stat">
          <Checks state={pr.checks} />
          <span className="qi-d-stat-lbl">checks</span>
        </div>
      </div>

      {d && <p className="qi-d-summary">{d.summary}</p>}

      {d && (
        <div className="qi-d-section">
          <span className="q-eyebrow">Reviewers</span>
          <ul className="qi-d-reviewers">
            {d.reviewers.map((rv) => (
              <li key={rv.user.login} className="qi-d-reviewer">
                <Avatar user={rv.user} size={20} />
                <span className="qi-d-reviewer-name">{rv.user.name}</span>
                <ReviewerPill status={rv.status} />
              </li>
            ))}
          </ul>
        </div>
      )}

      </div>

      <div className="qi-d-actions">
        <button type="button" className="q-btn q-btn-primary qi-d-open" onClick={onOpen}>
          <CornerDownLeft size={14} aria-hidden />
          Open review
          <Kbd>↵</Kbd>
        </button>
      </div>
    </aside>
  );
}

function Checks({ state }: { state?: InboxPR["checks"] }) {
  if (state === "failing")
    return <span className="qi-d-checks qi-d-checks-fail"><CircleX size={14} aria-hidden />Failing</span>;
  if (state === "pending")
    return <span className="qi-d-checks qi-d-checks-pending"><Clock size={14} aria-hidden />Pending</span>;
  return <span className="qi-d-checks qi-d-checks-pass"><CircleCheck size={14} aria-hidden />Passing</span>;
}

const CSS = `
.qi-root { display: flex; flex-direction: column; }

/* toolbar (top chrome — tabs only, kept minimal) */
.qi-toolbar { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid var(--line); background: linear-gradient(180deg, var(--surface-2), var(--bg)); }

/* body: list + detail */
.qi-body { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 380px; }
.qi-list { min-height: 0; overflow-y: auto; padding: 6px 0; border-right: 1px solid var(--line); }

.qi-row {
  position: relative; display: grid; grid-template-columns: 14px 1fr auto;
  align-items: center; gap: 0 12px; width: 100%;
  padding: 10px 18px 10px 6px; text-align: left; cursor: pointer;
  border-top: 1px solid transparent; border-bottom: 1px solid transparent;
  transition: background-color 110ms ease;
}
.qi-row:hover { background: var(--surface-2); }
.qi-row-active { background: var(--accent-soft); }
.qi-row-active:hover { background: var(--accent-soft); }
.qi-row-rail { position: absolute; left: 0; top: 6px; bottom: 6px; width: 2px; border-radius: 999px; background: transparent; transition: background-color 110ms ease; }
.qi-row-active .qi-row-rail { background: var(--accent); box-shadow: 0 0 10px 0 var(--accent-line); }
.qi-row-dot { width: 6px; height: 6px; border-radius: 999px; background: transparent; justify-self: center; }
.qi-row-unread .qi-row-dot { background: var(--accent); box-shadow: 0 0 8px -1px var(--accent-line); }

.qi-row-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.qi-row-title { display: flex; align-items: center; gap: 9px; font-size: 13.5px; color: var(--muted); font-weight: 500; min-width: 0; }
.qi-row-title > :first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qi-row-unread .qi-row-title { color: var(--fg); font-weight: 600; }
.qi-row-active .qi-row-title { color: var(--fg); }
.qi-row-meta { display: flex; align-items: center; gap: 7px; font-size: 12px; color: var(--muted); }
.qi-num { font-family: var(--font-mono); color: var(--faint); }
.qi-comments { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-family: var(--font-mono); font-size: 11px; }
.qi-checks-fail { display: inline-flex; align-items: center; gap: 4px; color: var(--del); font-family: var(--font-mono); font-size: 11px; }
.qi-row-time { font-size: 11px; color: var(--faint); white-space: nowrap; }

/* zero-state (empty tab) */
.qi-zero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 6px; padding: 64px 24px; }
.qi-zero-icon { display: grid; place-items: center; width: 52px; height: 52px; margin-bottom: 8px; border-radius: 14px; color: var(--accent); background: var(--accent-soft); box-shadow: inset 0 0 0 1px var(--accent-line); }
.qi-zero-title { font-size: 15px; font-weight: 600; color: var(--fg); }
.qi-zero-sub { font-size: 13px; color: var(--muted); max-width: 320px; line-height: 1.6; }

/* detail pane */
.qi-detail { min-height: 0; display: flex; flex-direction: column; background: var(--surface); }
.qi-d-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 22px; display: flex; flex-direction: column; gap: 20px; }
.qi-detail-empty { align-items: center; justify-content: center; text-align: center; color: var(--faint); font-size: 13px; padding: 22px; }

.qi-d-top { display: flex; flex-direction: column; gap: 10px; }
.qi-d-badges { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.qi-d-num { font-size: 12px; color: var(--faint); }
.qi-d-title { font-size: 17px; font-weight: 700; letter-spacing: -0.01em; line-height: 1.35; color: var(--fg); }
.qi-d-branch { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--muted); }
.qi-d-branch svg { color: var(--faint); }
.qi-d-arrow { color: var(--faint); }

.qi-d-author { display: flex; align-items: center; gap: 11px; padding: 14px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.qi-d-author-name { font-size: 13px; font-weight: 600; color: var(--fg); }
.qi-d-author-when { font-size: 11px; color: var(--faint); margin-top: 2px; }

.qi-d-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.qi-d-stat { display: flex; flex-direction: column; gap: 4px; padding: 11px 13px; border-radius: 10px; background: var(--surface-2); border: 1px solid var(--line); }
.qi-d-stat-val { font-size: 14px; color: var(--fg); }
.qi-d-stat-lbl { font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
.qi-d-checks { display: inline-flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; }
.qi-d-checks-pass { color: var(--add); }
.qi-d-checks-fail { color: var(--del); }
.qi-d-checks-pending { color: var(--warn); }

.qi-d-summary { font-size: 13px; line-height: 1.6; color: #cdcde0; }

.qi-d-section { display: flex; flex-direction: column; gap: 10px; }
.qi-d-reviewers { display: flex; flex-direction: column; gap: 4px; }
.qi-d-reviewer { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.qi-d-reviewer-name { flex: 1; min-width: 0; font-size: 13px; color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qi-d-reviewer .q-pill { flex-shrink: 0; }

.qi-d-actions { padding: 14px 22px; border-top: 1px solid var(--line); background: var(--surface); }
.qi-d-open { width: 100%; padding: 10px 14px; }
.qi-d-open .q-kbd { margin-left: auto; }

@media (max-width: 1000px) { .qi-body { grid-template-columns: 1fr 320px; } }
@media (max-width: 820px) { .qi-body { grid-template-columns: 1fr; } .qi-detail { display: none; } }
`;
