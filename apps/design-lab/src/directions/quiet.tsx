import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DirectionProps } from "./types";
import {
  parsePatch,
  relativeTime,
  formatAbsolute,
  viewedCount,
  totalComments,
} from "../mock";
import type {
  MockFile,
  MockComment,
  MockUser,
  DiffRow,
  PendingComment,
} from "../mock";
import { Tokens } from "../highlight";
import { Markdown } from "../markdown";

/**
 * "Quiet" — the Superhuman north star, literal.
 *
 * Signature: the FLOW RAIL — a slim vertical column of one segment per changed
 * file, fused into the left edge of the file sidebar. Viewed files fill in the
 * iris accent; the current file's segment is the brightest. It turns
 * "N/M viewed" into an ambient, glanceable progress indicator. The only motion
 * is a <=150ms colour fade as a segment fills.
 */

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function Avatar({ user, size = 22 }: { user: MockUser; size?: number }) {
  return (
    <span
      className="qf-avatar inline-grid shrink-0 place-items-center rounded-full font-medium"
      style={{
        width: size,
        height: size,
        background: user.color,
        fontSize: Math.round(size * 0.42),
      }}
      title={user.name}
      aria-hidden
    >
      {user.initials}
    </span>
  );
}

const STATUS_META: Record<
  MockFile["status"],
  { glyph: string; label: string; cls: string }
> = {
  added: { glyph: "A", label: "added", cls: "qf-st-add" },
  modified: { glyph: "M", label: "modified", cls: "qf-st-mod" },
  removed: { glyph: "D", label: "removed", cls: "qf-st-del" },
  renamed: { glyph: "R", label: "renamed", cls: "qf-st-ren" },
};

const REVIEWER_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "qf-rv-pending" },
  approved: { label: "Approved", cls: "qf-rv-approved" },
  changes: { label: "Changes requested", cls: "qf-rv-changes" },
  commented: { label: "Commented", cls: "qf-rv-commented" },
};

function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}
function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i + 1);
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="qf-kbd">{children}</kbd>;
}

// ---------------------------------------------------------------------------
// Diff row
// ---------------------------------------------------------------------------

function DiffLine({
  row,
  language,
  active,
  hasThread,
  onSelect,
}: {
  row: DiffRow;
  language: string;
  active: boolean;
  hasThread: boolean;
  onSelect: () => void;
}) {
  if (row.type === "hunk") {
    return (
      <div className="qf-row qf-row-hunk">
        <span className="qf-gutter qf-gutter-old" />
        <span className="qf-gutter qf-gutter-new" />
        <span className="qf-marker" />
        <code className="qf-code">{row.content}</code>
      </div>
    );
  }
  const marker = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
  return (
    <div
      className={
        "qf-row qf-row-" +
        row.type +
        (active ? " qf-row-active" : "") +
        (hasThread ? " qf-row-threaded" : "")
      }
      onClick={onSelect}
      role="presentation"
    >
      <span className="qf-gutter qf-gutter-old">{row.oldLine ?? ""}</span>
      <span className="qf-gutter qf-gutter-new">{row.newLine ?? ""}</span>
      <span className="qf-marker">{marker}</span>
      <code className="qf-code">
        {row.content === "" ? " " : <Tokens line={row.content} language={language} />}
      </code>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comment thread (built from file.comments) + pending comments
// ---------------------------------------------------------------------------

function Thread({
  root,
  replies,
}: {
  root: MockComment;
  replies: MockComment[];
}) {
  const renderOne = (c: MockComment, isReply: boolean) => (
    <div key={c.id} className={"qf-comment" + (isReply ? " qf-comment-reply" : "")}>
      <div className="qf-comment-head">
        <Avatar user={c.author} size={20} />
        <span className="qf-comment-author">{c.author.name}</span>
        <span className="qf-comment-time" title={formatAbsolute(c.createdAt)}>
          {relativeTime(c.createdAt)}
        </span>
      </div>
      <div className="qf-comment-body">
        <Markdown>{c.body}</Markdown>
      </div>
    </div>
  );
  return (
    <div className="qf-thread">
      {renderOne(root, false)}
      {replies.map((r) => renderOne(r, true))}
      <button type="button" className="qf-reply-btn qf-focusable">
        Reply
        <Kbd>r</Kbd>
      </button>
    </div>
  );
}

function PendingCard({
  pending,
  onRemove,
}: {
  pending: PendingComment;
  onRemove: () => void;
}) {
  return (
    <div className="qf-thread qf-pending">
      <div className="qf-comment">
        <div className="qf-comment-head">
          <Avatar user={pending.author} size={20} />
          <span className="qf-comment-author">{pending.author.name}</span>
          <span className="qf-pending-tag">Pending</span>
          <button
            type="button"
            className="qf-pending-remove qf-focusable"
            onClick={onRemove}
            title="Discard pending comment"
            aria-label="Discard pending comment"
          >
            Discard
          </button>
        </div>
        <div className="qf-comment-body">
          <Markdown>{pending.body}</Markdown>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function Quiet({ review }: DirectionProps) {
  const { pr, files } = review;

  const [selected, setSelected] = useState(review.initialFileIndex);
  const [viewedState, setViewedState] = useState<boolean[]>(() =>
    files.map((f) => f.viewed),
  );
  // Local copy of pending comments so "Discard" feels live.
  const [pendingByFile, setPendingByFile] = useState<
    Record<number, PendingComment[]>
  >(() => {
    const m: Record<number, PendingComment[]> = {};
    files.forEach((f, i) => {
      m[i] = f.pending;
    });
    return m;
  });
  const [infoOpen, setInfoOpen] = useState(false);
  // Keyboard line-cursor: index into the *selectable* (non-hunk) rows.
  const [cursor, setCursor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const file = files[selected];
  const hunks = useMemo(() => parsePatch(file.patch), [file.patch]);

  // Flat list of selectable rows (skip hunk-header rows) for j/k navigation.
  const selectableRows = useMemo(
    () => hunks.flatMap((h) => h.rows.filter((r) => r.type !== "hunk")),
    [hunks],
  );

  // Threads for the current file: roots (inReplyToId === null) + sorted replies.
  const threadsByLine = useMemo(() => {
    const roots = file.comments.filter((c) => c.inReplyToId === null);
    const byLineSide = new Map<
      string,
      { root: MockComment; replies: MockComment[] }
    >();
    for (const root of roots) {
      const replies = file.comments
        .filter((c) => c.inReplyToId === root.id)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      byLineSide.set(`${root.side}:${root.line}`, { root, replies });
    }
    return byLineSide;
  }, [file.comments]);

  const livePending = pendingByFile[selected] ?? [];
  const pendingByLine = useMemo(() => {
    const m = new Map<string, PendingComment[]>();
    for (const p of livePending) {
      const k = `${p.side}:${p.line}`;
      m.set(k, [...(m.get(k) ?? []), p]);
    }
    return m;
  }, [livePending]);

  const totalPending = useMemo(
    () =>
      Object.values(pendingByFile).reduce((n, arr) => n + arr.length, 0),
    [pendingByFile],
  );

  const viewedNow = viewedState.filter(Boolean).length;
  const baseViewed = viewedCount(review); // honest use of the shared helper
  const comments = totalComments(review);

  // --- selection helpers -------------------------------------------------
  const selectFile = useCallback((i: number) => {
    setSelected(i);
    setCursor(0);
  }, []);

  const markViewedAndNext = useCallback(() => {
    setViewedState((prev) => {
      const next = prev.slice();
      next[selected] = true;
      return next;
    });
    setSelected((i) => Math.min(i + 1, files.length - 1));
    setCursor(0);
  }, [selected, files.length]);

  const removePending = useCallback(
    (fileIdx: number, id: string) => {
      setPendingByFile((prev) => ({
        ...prev,
        [fileIdx]: (prev[fileIdx] ?? []).filter((p) => p.id !== id),
      }));
    },
    [],
  );

  // --- keyboard handlers (scope-aware, quiet) ----------------------------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // Let the lab chrome own 1–5 and ←/→; we take the review keys.
      switch (e.key) {
        case "n":
          e.preventDefault();
          selectFile(Math.min(selected + 1, files.length - 1));
          break;
        case "p":
          e.preventDefault();
          selectFile(Math.max(selected - 1, 0));
          break;
        case "j":
          e.preventDefault();
          setCursor((c) => Math.min(c + 1, Math.max(selectableRows.length - 1, 0)));
          break;
        case "k":
          e.preventDefault();
          setCursor((c) => Math.max(c - 1, 0));
          break;
        case "e":
          e.preventDefault();
          markViewedAndNext();
          break;
        case "v":
          e.preventDefault();
          setViewedState((prev) => {
            const next = prev.slice();
            next[selected] = !next[selected];
            return next;
          });
          break;
        case "i":
          e.preventDefault();
          setInfoOpen((o) => !o);
          break;
        case "Escape":
          if (infoOpen) {
            e.preventDefault();
            setInfoOpen(false);
          }
          break;
        default:
          break;
      }
    }
    const el = rootRef.current;
    el?.addEventListener("keydown", onKey);
    return () => el?.removeEventListener("keydown", onKey);
  }, [
    selected,
    files.length,
    selectableRows.length,
    infoOpen,
    selectFile,
    markViewedAndNext,
  ]);

  // The keyboard cursor maps onto the absolute row position so the
  // highlight tracks the same row the diff renders.
  const cursorRowKey = useMemo(() => {
    let count = 0;
    for (let hi = 0; hi < hunks.length; hi++) {
      const rows = hunks[hi].rows;
      for (let ri = 0; ri < rows.length; ri++) {
        if (rows[ri].type === "hunk") continue;
        if (count === cursor) return `${hi}:${ri}`;
        count++;
      }
    }
    return "";
  }, [hunks, cursor]);

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      className="dir-quiet relative flex h-full w-full overflow-hidden bg-[var(--bg)] text-[var(--fg)] outline-none"
    >
      <style>{CSS}</style>

      {/* ============ LEFT: flow rail + file sidebar ============ */}
      <aside className="qf-sidebar flex h-full shrink-0 flex-col border-r border-[var(--line)]">
        {/* sidebar header */}
        <div className="qf-side-head flex items-center justify-between px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="qf-side-title">Files</span>
            <span className="qf-side-count">
              {viewedNow}/{files.length} viewed
            </span>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* THE SIGNATURE: flow rail — one segment per changed file */}
          <div className="qf-rail" aria-hidden>
            {files.map((f, i) => {
              const isViewed = viewedState[i];
              const isCurrent = i === selected;
              return (
                <div
                  key={f.filename}
                  className={
                    "qf-rail-seg" +
                    (isViewed ? " qf-rail-viewed" : "") +
                    (isCurrent ? " qf-rail-current" : "")
                  }
                />
              );
            })}
          </div>

          {/* file list */}
          <nav className="qf-filelist min-h-0 flex-1 overflow-y-auto py-1">
            {files.map((f, i) => {
              const meta = STATUS_META[f.status];
              const on = i === selected;
              const isViewed = viewedState[i];
              const fileComments = f.comments.filter(
                (c) => c.inReplyToId === null,
              ).length;
              const filePending = (pendingByFile[i] ?? []).length;
              return (
                <button
                  key={f.filename}
                  type="button"
                  onClick={() => selectFile(i)}
                  aria-current={on}
                  className={
                    "qf-file qf-focusable" +
                    (on ? " qf-file-active" : "") +
                    (isViewed ? " qf-file-viewed" : "")
                  }
                >
                  <span className={"qf-file-glyph " + meta.cls} title={meta.label}>
                    {meta.glyph}
                  </span>
                  <span className="qf-file-name">
                    <span className="qf-file-dir">{dirname(f.filename)}</span>
                    <span className="qf-file-base">{basename(f.filename)}</span>
                  </span>
                  <span className="qf-file-meta">
                    {fileComments > 0 && (
                      <span className="qf-file-badge qf-file-badge-comment" title={`${fileComments} thread${fileComments > 1 ? "s" : ""}`}>
                        {fileComments}
                      </span>
                    )}
                    {filePending > 0 && (
                      <span className="qf-file-badge qf-file-badge-pending" title={`${filePending} pending`}>
                        {filePending}
                      </span>
                    )}
                    <span className="qf-file-stat">
                      <span className="qf-add">+{f.additions}</span>
                      <span className="qf-del">-{f.deletions}</span>
                    </span>
                  </span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* sidebar footer: scope-aware keyboard legend */}
        <div className="qf-legend">
          <div className="qf-legend-row">
            <span className="qf-legend-scope">review</span>
            <span className="qf-legend-keys">
              <Kbd>n</Kbd><Kbd>p</Kbd><span className="qf-legend-lbl">files</span>
              <Kbd>j</Kbd><Kbd>k</Kbd><span className="qf-legend-lbl">line</span>
              <Kbd>c</Kbd><span className="qf-legend-lbl">comment</span>
            </span>
          </div>
          <div className="qf-legend-row">
            <span className="qf-legend-scope qf-legend-scope-ghost">·</span>
            <span className="qf-legend-keys">
              <Kbd>e</Kbd><span className="qf-legend-lbl">viewed+next</span>
              <Kbd>s</Kbd><span className="qf-legend-lbl">submit</span>
              <Kbd>]c</Kbd><Kbd>[c</Kbd><span className="qf-legend-lbl">threads</span>
            </span>
          </div>
          <div className="qf-legend-row">
            <span className="qf-legend-scope qf-legend-scope-ghost">·</span>
            <span className="qf-legend-keys">
              <Kbd>i</Kbd><span className="qf-legend-lbl">info</span>
              <Kbd>esc</Kbd><span className="qf-legend-lbl">back</span>
              <span className="qf-legend-sep" />
              <Kbd>⌘K</Kbd><Kbd>?</Kbd><span className="qf-legend-lbl">global</span>
            </span>
          </div>
        </div>
      </aside>

      {/* ============ CENTER: header + diff ============ */}
      <main className="qf-main flex h-full min-w-0 flex-1 flex-col">
        {/* whisper-quiet header */}
        <header className="qf-header flex shrink-0 items-center gap-4 px-6 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={"qf-state " + (pr.draft ? "qf-state-draft" : "qf-state-open")}>
                <span className="qf-state-dot" />
                {pr.draft ? "Draft" : "Open"}
              </span>
              <h1 className="qf-pr-title truncate">{pr.title}</h1>
            </div>
            <div className="qf-pr-sub mt-1 flex items-center gap-2">
              <span className="qf-pr-num">#{pr.number}</span>
              <span className="qf-dot">·</span>
              <span>{pr.repo}</span>
              <span className="qf-dot">·</span>
              <Avatar user={pr.author} size={15} />
              <span className="qf-muted">{pr.author.name}</span>
              <span className="qf-dot">·</span>
              <span className="qf-branch">
                {pr.baseRef} <span className="qf-arrow">←</span> {pr.headRef}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <div className="qf-stat-group">
              <span className="qf-add">+{pr.additions}</span>
              <span className="qf-del">-{pr.deletions}</span>
            </div>
            <div className="qf-viewed-pill" title={`${baseViewed} viewed at load`}>
              <span className="qf-viewed-num">{viewedNow}</span>
              <span className="qf-viewed-of">/{files.length}</span>
              <span className="qf-viewed-lbl">viewed</span>
            </div>
            <button
              type="button"
              className="qf-info-btn qf-focusable"
              onClick={() => setInfoOpen((o) => !o)}
              aria-pressed={infoOpen}
              title="PR description & reviewers (i)"
            >
              i
            </button>
            <button type="button" className="qf-submit qf-focusable">
              {totalPending > 0 ? "Submit review" : "Review"}
              {totalPending > 0 && (
                <span className="qf-submit-badge">{totalPending}</span>
              )}
              <Kbd>s</Kbd>
            </button>
          </div>
        </header>

        {/* file path strip */}
        <div className="qf-filebar flex shrink-0 items-center gap-3 px-6 py-2">
          <span className={"qf-file-glyph " + STATUS_META[file.status].cls}>
            {STATUS_META[file.status].glyph}
          </span>
          <span className="qf-filebar-name">
            {file.previousFilename && file.status === "renamed" && (
              <span className="qf-filebar-prev">{file.previousFilename} → </span>
            )}
            {file.filename}
          </span>
          <span className="qf-filebar-stat">
            <span className="qf-add">+{file.additions}</span>
            <span className="qf-del">-{file.deletions}</span>
          </span>
          <span className="qf-filebar-lang">{file.language}</span>
          <span className="ml-auto qf-muted text-xs">
            {comments} comment{comments === 1 ? "" : "s"} in PR
          </span>
        </div>

        {/* the diff dominates */}
        <div className="qf-diff min-h-0 flex-1 overflow-y-auto">
          {hunks.map((hunk, hi) => (
            <div key={hi} className="qf-hunk">
              {hunk.rows.map((row, ri) => {
                const key = `${hi}:${ri}`;
                const isActive = key === cursorRowKey;
                const ln = row.type === "del" ? row.oldLine : row.newLine;
                const side: "LEFT" | "RIGHT" =
                  row.type === "del" ? "LEFT" : "RIGHT";
                const threadKey = ln != null ? `${side}:${ln}` : "";
                const thread =
                  ln != null ? threadsByLine.get(threadKey) : undefined;
                const pend =
                  ln != null ? pendingByLine.get(threadKey) : undefined;
                const hasAnchored =
                  row.type !== "hunk" && (!!thread || !!pend);
                return (
                  <div key={key}>
                    <DiffLine
                      row={row}
                      language={file.language}
                      active={isActive}
                      hasThread={hasAnchored}
                      onSelect={() => {
                        // map this row back into the cursor index
                        let count = 0;
                        for (let h = 0; h < hunks.length; h++) {
                          for (let r = 0; r < hunks[h].rows.length; r++) {
                            if (hunks[h].rows[r].type === "hunk") continue;
                            if (h === hi && r === ri) {
                              setCursor(count);
                              return;
                            }
                            count++;
                          }
                        }
                      }}
                    />
                    {thread && (
                      <Thread root={thread.root} replies={thread.replies} />
                    )}
                    {pend &&
                      pend.map((p) => (
                        <PendingCard
                          key={p.id}
                          pending={p}
                          onRemove={() => removePending(selected, p.id)}
                        />
                      ))}
                  </div>
                );
              })}
            </div>
          ))}
          {hunks.length === 0 && (
            <div className="qf-empty">No textual diff for this file.</div>
          )}
        </div>
      </main>

      {/* ============ INFO DRAWER: description + reviewers ============ */}
      <div
        className={"qf-drawer-scrim" + (infoOpen ? " qf-drawer-open" : "")}
        onClick={() => setInfoOpen(false)}
        role="presentation"
      />
      <aside
        className={"qf-drawer" + (infoOpen ? " qf-drawer-open" : "")}
        aria-hidden={!infoOpen}
      >
        <div className="qf-drawer-head">
          <span className="qf-drawer-title">Pull request</span>
          <button
            type="button"
            className="qf-drawer-close qf-focusable"
            onClick={() => setInfoOpen(false)}
            title="Close (esc)"
            aria-label="Close"
          >
            esc
          </button>
        </div>
        <div className="qf-drawer-body">
          <section className="qf-drawer-section">
            <div className="qf-drawer-pr">
              <span className="qf-pr-num">#{pr.number}</span>
              <span className="qf-drawer-pr-title">{pr.title}</span>
            </div>
            <div className="qf-drawer-meta">
              <span>{pr.commits} commits</span>
              <span className="qf-dot">·</span>
              <span>{pr.changedFiles} files</span>
              <span className="qf-dot">·</span>
              <span className="qf-add">+{pr.additions}</span>
              <span className="qf-del">-{pr.deletions}</span>
              <span className="qf-dot">·</span>
              <span className="qf-muted" title={formatAbsolute(pr.updatedAt)}>
                updated {relativeTime(pr.updatedAt)}
              </span>
            </div>
          </section>

          <section className="qf-drawer-section">
            <h3 className="qf-drawer-h">Reviewers</h3>
            <ul className="qf-reviewers">
              {pr.reviewers.map((rv) => {
                const meta = REVIEWER_META[rv.status];
                return (
                  <li key={rv.user.login} className="qf-reviewer">
                    <Avatar user={rv.user} size={22} />
                    <span className="qf-reviewer-name">{rv.user.name}</span>
                    <span className={"qf-reviewer-status " + meta.cls}>
                      {meta.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="qf-drawer-section">
            <h3 className="qf-drawer-h">Description</h3>
            <Markdown>{pr.body}</Markdown>
          </section>
        </div>
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scoped, hermetic stylesheet — every rule under .dir-quiet
// ---------------------------------------------------------------------------

const CSS = `
.dir-quiet {
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
  --add: #5fd08a;
  --del: #ff7088;
  --add-bg: rgba(95, 208, 138, 0.08);
  --del-bg: rgba(255, 112, 136, 0.08);
  --add-num: rgba(95, 208, 138, 0.55);
  --del-num: rgba(255, 112, 136, 0.55);
  --font-ui: Inter, system-ui, sans-serif;
  --font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;

  font-family: var(--font-ui);
  font-size: 14px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.005em;
}

/* faint radial lift behind the whole canvas — barely there */
.dir-quiet::before {
  content: "";
  position: absolute;
  inset: 0;
  background:
    radial-gradient(1200px 600px at 22% -10%, rgba(139,128,255,0.06), transparent 60%);
  pointer-events: none;
}

/* ---- focus ring (single, consistent treatment) ---- */
.dir-quiet .qf-focusable:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1.5px var(--bg), 0 0 0 3px var(--accent);
  border-radius: 7px;
}
.dir-quiet:focus-visible {
  outline: none;
  box-shadow: inset 0 0 0 1px var(--accent-line);
}

/* ============ SIDEBAR ============ */
.dir-quiet .qf-sidebar {
  width: 320px;
  background: var(--surface);
}
.dir-quiet .qf-side-head {
  border-bottom: 1px solid var(--line);
}
.dir-quiet .qf-side-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.dir-quiet .qf-side-count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--faint);
}

/* THE FLOW RAIL — the signature */
.dir-quiet .qf-rail {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 4px;
  box-sizing: content-box;
  padding: 10px 7px;
  flex-shrink: 0;
}
.dir-quiet .qf-rail-seg {
  flex: 1 1 0;
  min-height: 10px;
  border-radius: 999px;
  background: var(--line-2);
  transition: background-color 150ms ease, box-shadow 150ms ease, opacity 150ms ease;
}
.dir-quiet .qf-rail-viewed {
  background: var(--accent);
  opacity: 0.5;
}
.dir-quiet .qf-rail-current {
  background: var(--accent);
  opacity: 1;
  box-shadow: 0 0 0 1px var(--accent-soft), 0 0 10px 1px var(--accent-line);
}

/* file list */
.dir-quiet .qf-filelist {
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.dir-quiet .qf-file {
  display: flex;
  align-items: center;
  gap: 9px;
  width: calc(100% - 12px);
  margin: 1px 6px;
  padding: 6px 8px 6px 6px;
  border-radius: 7px;
  text-align: left;
  color: var(--muted);
  transition: background-color 120ms ease, color 120ms ease;
  cursor: pointer;
}
.dir-quiet .qf-file:hover {
  background: var(--surface-2);
  color: var(--fg);
}
.dir-quiet .qf-file-active {
  background: var(--accent-soft);
  color: var(--fg);
  box-shadow: inset 0 0 0 1px var(--accent-line);
}
.dir-quiet .qf-file-viewed:not(.qf-file-active) {
  opacity: 0.62;
}
.dir-quiet .qf-file-glyph {
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
.dir-quiet .qf-st-add { color: var(--add); background: var(--add-bg); }
.dir-quiet .qf-st-mod { color: #d9c46a; background: rgba(217,196,106,0.10); }
.dir-quiet .qf-st-del { color: var(--del); background: var(--del-bg); }
.dir-quiet .qf-st-ren { color: var(--accent); background: var(--accent-soft); }
.dir-quiet .qf-file-name {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: baseline;
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
}
.dir-quiet .qf-file-dir {
  color: var(--faint);
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
}
.dir-quiet .qf-file-base {
  color: inherit;
  font-weight: 500;
  flex-shrink: 0;
}
.dir-quiet .qf-file-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.dir-quiet .qf-file-badge {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 999px;
}
.dir-quiet .qf-file-badge-comment {
  color: var(--muted);
  background: var(--surface-hi);
  border: 1px solid var(--line-2);
}
.dir-quiet .qf-file-badge-pending {
  color: var(--accent);
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
}
.dir-quiet .qf-file-stat {
  font-family: var(--font-mono);
  font-size: 11px;
  display: flex;
  gap: 5px;
}
.dir-quiet .qf-add { color: var(--add); }
.dir-quiet .qf-del { color: var(--del); }

/* legend */
.dir-quiet .qf-legend {
  border-top: 1px solid var(--line);
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: var(--surface);
}
.dir-quiet .qf-legend-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dir-quiet .qf-legend-scope {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: var(--accent);
  width: 40px;
  flex-shrink: 0;
}
.dir-quiet .qf-legend-scope-ghost { color: transparent; }
.dir-quiet .qf-legend-keys {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px 5px;
}
.dir-quiet .qf-legend-lbl {
  font-size: 11px;
  color: var(--faint);
  margin-right: 4px;
}
.dir-quiet .qf-legend-sep {
  width: 1px;
  height: 11px;
  background: var(--line-2);
  margin: 0 3px;
}

/* keycaps */
.dir-quiet .qf-kbd {
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
  box-shadow: 0 1px 0 rgba(0,0,0,0.35);
}

/* ============ MAIN ============ */
.dir-quiet .qf-main { background: var(--bg); }

.dir-quiet .qf-header {
  border-bottom: 1px solid var(--line);
  background: linear-gradient(180deg, var(--surface-2), var(--bg));
}
.dir-quiet .qf-pr-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
  letter-spacing: -0.01em;
}
.dir-quiet .qf-pr-sub {
  font-size: 12px;
  color: var(--muted);
}
.dir-quiet .qf-pr-num {
  font-family: var(--font-mono);
  color: var(--faint);
}
.dir-quiet .qf-muted { color: var(--muted); }
.dir-quiet .qf-dot { color: var(--faint); }
.dir-quiet .qf-branch {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
.dir-quiet .qf-arrow { color: var(--faint); }

.dir-quiet .qf-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px 2px 7px;
  border-radius: 999px;
  letter-spacing: 0.01em;
}
.dir-quiet .qf-state-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
}
.dir-quiet .qf-state-open {
  color: var(--add);
  background: var(--add-bg);
  box-shadow: inset 0 0 0 1px rgba(95,208,138,0.25);
}
.dir-quiet .qf-state-draft {
  color: var(--muted);
  background: var(--surface-hi);
  box-shadow: inset 0 0 0 1px var(--line-2);
}

.dir-quiet .qf-stat-group {
  font-family: var(--font-mono);
  font-size: 12px;
  display: flex;
  gap: 7px;
}
.dir-quiet .qf-viewed-pill {
  display: flex;
  align-items: baseline;
  gap: 3px;
  font-family: var(--font-mono);
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 7px;
  background: var(--surface);
  border: 1px solid var(--line);
}
.dir-quiet .qf-viewed-num { color: var(--fg); font-weight: 600; }
.dir-quiet .qf-viewed-of { color: var(--faint); }
.dir-quiet .qf-viewed-lbl {
  font-family: var(--font-ui);
  font-size: 11px;
  color: var(--muted);
  margin-left: 2px;
}

.dir-quiet .qf-info-btn {
  width: 28px;
  height: 28px;
  border-radius: 7px;
  font-family: var(--font-mono);
  font-style: italic;
  font-size: 13px;
  color: var(--muted);
  background: var(--surface);
  border: 1px solid var(--line);
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease;
}
.dir-quiet .qf-info-btn:hover,
.dir-quiet .qf-info-btn[aria-pressed="true"] {
  color: var(--accent);
  border-color: var(--accent-line);
  background: var(--accent-soft);
}

.dir-quiet .qf-submit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px 6px 13px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  color: #14111f;
  background: var(--accent);
  border: 1px solid var(--accent);
  cursor: pointer;
  transition: filter 120ms ease;
}
.dir-quiet .qf-submit:hover { filter: brightness(1.08); }
.dir-quiet .qf-submit .qf-kbd {
  color: #14111f;
  background: rgba(20,17,31,0.16);
  border-color: rgba(20,17,31,0.22);
  box-shadow: none;
}
.dir-quiet .qf-submit-badge {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  color: var(--accent);
  background: #14111f;
  border-radius: 999px;
  padding: 1px 7px;
  line-height: 1.5;
}

/* file path strip */
.dir-quiet .qf-filebar {
  border-bottom: 1px solid var(--line);
  background: var(--bg);
}
.dir-quiet .qf-filebar-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg);
}
.dir-quiet .qf-filebar-prev { color: var(--faint); }
.dir-quiet .qf-filebar-stat {
  font-family: var(--font-mono);
  font-size: 11px;
  display: flex;
  gap: 6px;
}
.dir-quiet .qf-filebar-lang {
  font-family: var(--font-mono);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--faint);
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
}

/* ============ DIFF ============ */
.dir-quiet .qf-diff {
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.55;
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.dir-quiet .qf-row {
  display: grid;
  grid-template-columns: 52px 52px 22px 1fr;
  align-items: baseline;
  padding: 1px 16px 1px 0;
  border-left: 2px solid transparent;
}
.dir-quiet .qf-row-hunk {
  background: var(--surface);
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding-top: 4px;
  padding-bottom: 4px;
  margin: 4px 0;
}
.dir-quiet .qf-row-hunk .qf-code {
  color: var(--accent);
  opacity: 0.85;
  font-size: 11px;
}
.dir-quiet .qf-row-add { background: var(--add-bg); }
.dir-quiet .qf-row-del { background: var(--del-bg); }
.dir-quiet .qf-row-add .qf-marker { color: var(--add); }
.dir-quiet .qf-row-del .qf-marker { color: var(--del); }
.dir-quiet .qf-row-add .qf-gutter-new { color: var(--add-num); }
.dir-quiet .qf-row-del .qf-gutter-old { color: var(--del-num); }

.dir-quiet .qf-row:not(.qf-row-hunk) { cursor: text; }
.dir-quiet .qf-row-active {
  border-left-color: var(--accent);
  background: var(--accent-soft);
}
.dir-quiet .qf-row-active .qf-gutter { color: var(--fg); }
.dir-quiet .qf-row-threaded .qf-marker {
  color: var(--accent);
  opacity: 0.9;
}

.dir-quiet .qf-gutter {
  text-align: right;
  padding-right: 12px;
  color: var(--faint);
  font-size: 11px;
  user-select: none;
  -webkit-user-select: none;
}
.dir-quiet .qf-marker {
  text-align: center;
  color: var(--faint);
  user-select: none;
  -webkit-user-select: none;
}
.dir-quiet .qf-code {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg);
}

/* syntax theming */
.dir-quiet .tk-kw   { color: #c4b6ff; }
.dir-quiet .tk-str  { color: #8fe3b0; }
.dir-quiet .tk-num  { color: #ffc48a; }
.dir-quiet .tk-com  { color: var(--faint); font-style: italic; }
.dir-quiet .tk-fn   { color: #7fc8ff; }
.dir-quiet .tk-type { color: #ffd9a0; }
.dir-quiet .tk-punct{ color: #b6b6cf; }
.dir-quiet .tk-plain{ color: var(--fg); }

.dir-quiet .qf-empty {
  padding: 40px;
  text-align: center;
  color: var(--faint);
  font-family: var(--font-ui);
}

/* ============ COMMENT THREADS ============ */
.dir-quiet .qf-thread {
  margin: 6px 16px 10px 70px;
  border: 1px solid var(--line-2);
  border-radius: 10px;
  background: var(--surface);
  overflow: hidden;
  font-family: var(--font-ui);
}
.dir-quiet .qf-comment {
  padding: 11px 14px;
}
.dir-quiet .qf-comment-reply {
  border-top: 1px solid var(--line);
  background: var(--surface-2);
}
.dir-quiet .qf-comment-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.dir-quiet .qf-comment-author {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--fg);
}
.dir-quiet .qf-comment-time {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--faint);
}
.dir-quiet .qf-comment-body { font-size: 13px; color: #d6d6e6; }

.dir-quiet .qf-reply-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 8px 14px;
  border-top: 1px solid var(--line);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: color 120ms ease, background-color 120ms ease;
}
.dir-quiet .qf-reply-btn:hover { color: var(--fg); background: var(--surface-2); }

/* pending */
.dir-quiet .qf-pending {
  border-color: var(--accent-line);
  border-style: dashed;
  background: linear-gradient(0deg, var(--accent-soft), var(--accent-soft)), var(--surface);
}
.dir-quiet .qf-pending-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--accent);
  background: var(--bg);
  border: 1px solid var(--accent-line);
  border-radius: 999px;
  padding: 2px 7px;
}
.dir-quiet .qf-pending-remove {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
  background: transparent;
  border: 1px solid var(--line-2);
  border-radius: 6px;
  padding: 3px 9px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}
.dir-quiet .qf-pending-remove:hover { color: var(--del); border-color: var(--del); }

/* ============ INFO DRAWER ============ */
.dir-quiet .qf-drawer-scrim {
  position: absolute;
  inset: 0;
  background: rgba(8,8,14,0.5);
  opacity: 0;
  pointer-events: none;
  transition: opacity 150ms ease;
  z-index: 20;
}
.dir-quiet .qf-drawer-scrim.qf-drawer-open {
  opacity: 1;
  pointer-events: auto;
}
.dir-quiet .qf-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  width: 420px;
  max-width: 86vw;
  background: var(--surface);
  border-left: 1px solid var(--line-2);
  box-shadow: -24px 0 48px -24px rgba(0,0,0,0.6);
  transform: translateX(100%);
  transition: transform 150ms ease;
  z-index: 21;
  display: flex;
  flex-direction: column;
}
.dir-quiet .qf-drawer.qf-drawer-open { transform: translateX(0); }
.dir-quiet .qf-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}
.dir-quiet .qf-drawer-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.dir-quiet .qf-drawer-close {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
  background: var(--surface-hi);
  border: 1px solid var(--line-2);
  border-radius: 6px;
  padding: 3px 8px;
  cursor: pointer;
}
.dir-quiet .qf-drawer-close:hover { color: var(--fg); }
.dir-quiet .qf-drawer-body {
  padding: 18px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--line-2) transparent;
}
.dir-quiet .qf-drawer-section { margin-bottom: 24px; }
.dir-quiet .qf-drawer-pr {
  display: flex;
  gap: 8px;
  align-items: baseline;
  margin-bottom: 6px;
}
.dir-quiet .qf-drawer-pr-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--fg);
}
.dir-quiet .qf-drawer-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
.dir-quiet .qf-drawer-h {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--faint);
  margin-bottom: 10px;
}
.dir-quiet .qf-reviewers { display: flex; flex-direction: column; gap: 4px; }
.dir-quiet .qf-reviewer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 8px;
  border-radius: 8px;
}
.dir-quiet .qf-reviewer:hover { background: var(--surface-2); }
.dir-quiet .qf-reviewer-name { flex: 1; font-size: 13px; color: var(--fg); }
.dir-quiet .qf-reviewer-status {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 999px;
}
.dir-quiet .qf-rv-pending { color: var(--muted); background: var(--surface-hi); border: 1px solid var(--line-2); }
.dir-quiet .qf-rv-approved { color: var(--add); background: var(--add-bg); }
.dir-quiet .qf-rv-changes { color: var(--del); background: var(--del-bg); }
.dir-quiet .qf-rv-commented { color: var(--accent); background: var(--accent-soft); }

/* ============ MARKDOWN ============ */
.dir-quiet .md { font-family: var(--font-ui); color: #d6d6e6; font-size: 13px; line-height: 1.6; }
.dir-quiet .md > *:first-child { margin-top: 0; }
.dir-quiet .md > *:last-child { margin-bottom: 0; }
.dir-quiet .md h2 { font-size: 15px; font-weight: 600; color: var(--fg); margin: 18px 0 8px; }
.dir-quiet .md h3 { font-size: 13px; font-weight: 600; color: var(--fg); margin: 16px 0 6px; letter-spacing: 0.02em; }
.dir-quiet .md h4 { font-size: 12px; font-weight: 600; color: var(--muted); margin: 12px 0 4px; }
.dir-quiet .md p { margin: 8px 0; }
.dir-quiet .md ul { margin: 8px 0; padding-left: 18px; list-style: none; }
.dir-quiet .md li { position: relative; margin: 4px 0; }
.dir-quiet .md li::before {
  content: "";
  position: absolute;
  left: -14px;
  top: 9px;
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--accent);
  opacity: 0.7;
}
.dir-quiet .md a { color: var(--accent); text-decoration: none; border-bottom: 1px solid var(--accent-line); }
.dir-quiet .md a:hover { border-bottom-color: var(--accent); }
.dir-quiet .md strong { color: var(--fg); font-weight: 600; }
.dir-quiet .md em { color: var(--muted); font-style: italic; }
.dir-quiet .md code {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: #c4b6ff;
  background: var(--surface-hi);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 5px;
}
.dir-quiet .md pre {
  font-family: var(--font-mono);
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 12px;
  overflow-x: auto;
  margin: 10px 0;
}
.dir-quiet .md pre code { border: none; background: none; padding: 0; color: var(--fg); }
.dir-quiet .md blockquote {
  margin: 10px 0;
  padding: 4px 0 4px 14px;
  border-left: 2px solid var(--accent-line);
  color: var(--muted);
}

/* ============ RESPONSIVE (~1100px) ============ */
@media (max-width: 1100px) {
  .dir-quiet .qf-sidebar { width: 260px; }
  .dir-quiet .qf-viewed-lbl { display: none; }
  .dir-quiet .qf-branch { display: none; }
}

/* ============ REDUCED MOTION ============ */
@media (prefers-reduced-motion: reduce) {
  .dir-quiet *, .dir-quiet *::before, .dir-quiet *::after {
    transition-duration: 0ms !important;
  }
}
`;
