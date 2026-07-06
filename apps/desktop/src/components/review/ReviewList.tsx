import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
} from "react";
import {
  GroupedVirtuoso,
  type CalculateViewLocation,
  type GroupedVirtuosoHandle,
  type StateSnapshot,
} from "react-virtuoso";
import { Check } from "lucide-react";
import type { ChangedFile, PendingComment } from "../../types";
import {
  fileAnchorKey,
  fileRenderMeta,
  type ReviewCommentsItem,
  type ReviewItem,
  type ReviewListModel,
  type ReviewRowItem,
} from "../../lib/reviewItems";
import {
  highlightLineWithFind,
  highlightLineWithIntra,
  highlightLineWithOccurrences,
} from "../../lib/highlight";
import { findMatchRangesInLine } from "../../lib/findInDiff";
import { useLatest } from "../../hooks/useLatest";
import { occurrenceRangesInLine } from "../../lib/occurrences";
import type { IntralineRanges } from "../../lib/intraline";
import { cn } from "../../lib/cn";
import { useAppStore } from "../../store/appStore";
import { Avatar } from "../ui/Avatar";
import { Markdown } from "../Markdown";
import { CommentThread, type ReplyRequest } from "./CommentThread";
import { AddCommentBox } from "./AddCommentBox";
import { ImageDiff } from "./ImageDiff";

/**
 * What to mark on every rendered row — the find bar's (mod+f) or the
 * selection-occurrence highlights. At most one is active (find wins while its
 * bar is open). With the list virtualized, only the ~viewport's worth of rows
 * exists, so marks go to every rendered row unconditionally — the per-section
 * and per-row gating the windowed implementation needed is obsolete.
 */
export type MarkSpec =
  | { kind: "find"; query: string; caseSensitive: boolean }
  | { kind: "occurrence"; query: string; wholeWord: boolean; fileIndex: number };

/** The current find match: which file/row, which occurrence within the row. */
export interface FindCurrent {
  fileIndex: number;
  anchor: string;
  /** 0-based occurrence index within the row (multiple hits per line). */
  ordinal: number;
}

export interface ReviewListHandle {
  /** Scroll a file's group header to the top (file navigation). */
  scrollToFileStart(fileIndex: number): void;
  /** Center an item (search/find jumps). */
  centerItem(itemIndex: number): void;
  /** Bring an item into view, clearing the sticky header band (j/k cursor). */
  nudgeItemIntoView(itemIndex: number): void;
  /** The scrolling element (page-scroll, occurrence DOM logic). */
  scroller(): HTMLElement | null;
  /** Snapshot the scroll state for resume. */
  getState(cb: (state: StateSnapshot) => void): void;
  /**
   * Item index of the first row visible below the sticky header, from the
   * rendered DOM (virtuoso's range callbacks include overscan, which would
   * put "what you're looking at" hundreds of px above the viewport).
   */
  firstVisibleRowItem(): number | null;
  /** The topmost rendered row and its offset from the scroller top — the
   *  anchor-exact half of the resume position (see scrollItemTo). */
  firstVisibleRow(): { fileIndex: number; anchor: string; top: number } | null;
  /** Put an item's top exactly `topPx` below the scroller top. Snapshot
   *  restore alone lands wherever the height ESTIMATES say (engines/fonts
   *  drift); this corrects against real geometry. */
  scrollItemTo(itemIndex: number, topPx: number): void;
}

export interface ReviewListCallbacks {
  onRowEnter(fileIndex: number, anchor: string, x: number, y: number): void;
  /** startLine present = a multi-line composer (anchor is the range's end). */
  onOpenBox(fileIndex: number, anchor: string, startLine?: number): void;
  onCloseBox(fileIndex: number, anchor: string): void;
  /** Gutter "+" drag — the mouse path to a multi-line range. */
  onPlusDragStart(fileIndex: number, anchor: string): void;
  onPlusDragOver(fileIndex: number, anchor: string): void;
  onPlusDragEnd(): void;
  onToggleHunk(fileIndex: number, hunkIndex: number): void;
  onToggleViewed(fileIndex: number): void;
  onCopyPath(fileIndex: number): void;
  onAddPending(c: {
    path: string;
    line: number;
    side: string;
    body: string;
    startLine?: number;
  }): void;
  onAddComment(a: {
    path: string;
    line: number;
    side: string;
    body: string;
    startLine?: number;
  }): Promise<void>;
  onReply(a: { inReplyTo: number; body: string }): Promise<void>;
  /** Flip a thread's resolved state (optimistic upstream). */
  onResolveThread(a: { threadId: string; resolved: boolean }): void;
  /** The pointer entered (or left, null) a thread — the `r` reply target. */
  onThreadHover(t: { rootId: number; path: string } | null): void;
  onRemovePending(id: string): void;
  onScroll(): void;
  onMouseMove(x: number, y: number): void;
}

interface ReviewListProps {
  model: ReviewListModel;
  files: ReadonlyArray<ChangedFile>;
  /** fileAnchorKey of the cursor/flash row (null = none). */
  cursorKey: string | null;
  /** The multi-line range, normalized to item order (rows in between paint
   *  selected); endItem is the MOVING end, where the traveling "+" paints
   *  during a drag. Null = no range. */
  selection: {
    fileIndex: number;
    fromItem: number;
    toItem: number;
    endItem: number;
  } | null;
  /** A gutter drag is extending the range right now. */
  dragging: boolean;
  flashKey: string | null;
  inputMode: "keyboard" | "mouse";
  marks: MarkSpec | null;
  findCurrent: FindCurrent | null;
  activeIndex: number;
  viewedSet: ReadonlySet<string>;
  changedSinceViewed: ReadonlySet<string>;
  copiedPathIndex: number | null;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
  addPending: boolean;
  /** Resume snapshot, applied on mount. */
  restoreState?: StateSnapshot;
  /** Fallback resume target when no snapshot exists (group start). */
  initialFileIndex?: number;
  /** Open the reply composer on the matching thread (from the `r` key);
   *  each rendered thread checks the rootId itself. */
  replyRequest: (ReplyRequest & { path: string }) | null;
  callbacks: ReviewListCallbacks;
}

interface ListContext {
  props: ReviewListProps;
  /** Measured mono-column width (px), or null before first measurement. */
  colW: number | null;
}

// The sticky group-header band the cursor must clear when moving upward.
// Measured lazily from the rendered header; this is the pre-measure fallback.
const HEADER_FALLBACK_PX = 36;

function glyphFor(status: string): { letter: string; cls: string } {
  switch (status) {
    case "added":
      return { letter: "A", cls: "qf-st-add" };
    case "removed":
      return { letter: "D", cls: "qf-st-del" };
    case "renamed":
      return { letter: "R", cls: "qf-st-ren" };
    case "copied":
      return { letter: "C", cls: "qf-st-ren" };
    default:
      return { letter: "M", cls: "qf-st-mod" };
  }
}

/** One diff line. The React Compiler memoizes it (and the element trees that
 *  feed it), so cursor moves flip `isCursor` on two rows without rebuilding
 *  the other rendered rows' innerHTML — the find-perf spec pins that. */
function DiffLine({
  item,
  filename,
  stateCls,
  intra,
  guideLvl,
  indentVar,
  markKind,
  markQuery,
  markFlag,
  findOrdinal,
  onEnter,
  onOpenBox,
  onPlusDragStart,
  onPlusDragOver,
  onPlusDragEnd,
}: {
  item: ReviewRowItem;
  filename: string;
  /** The row's cursor/selection/flash classes, pre-joined — ONE string prop
   *  (value-compared) so the compiler's row memoization survives; an object
   *  would be identity-fresh every render and repaint every row. */
  stateCls: string;
  intra: IntralineRanges | null;
  guideLvl: number | null;
  /** The file's indent-guide period (px or ch string) — see --qf-indent. */
  indentVar: string;
  markKind: "find" | "occurrence" | null;
  markQuery: string | null;
  markFlag: boolean;
  findOrdinal: number | null;
  onEnter: (fileIndex: number, anchor: string, x: number, y: number) => void;
  onOpenBox: (fileIndex: number, anchor: string, startLine?: number) => void;
  onPlusDragStart: (fileIndex: number, anchor: string) => void;
  onPlusDragOver: (fileIndex: number, anchor: string) => void;
  onPlusDragEnd: () => void;
}) {
  const { row, anchor, fileIndex, hasAnchored } = item;
  const canComment = item.target != null;
  const marker = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
  return (
    <div
      data-anchor={anchor ?? undefined}
      data-file-index={fileIndex}
      onMouseEnter={
        anchor != null
          ? (e) => onEnter(fileIndex, anchor, e.clientX, e.clientY)
          : undefined
      }
      className={cn(
        "qf-row",
        row.type === "add" && "qf-row-add",
        row.type === "del" && "qf-row-del",
        stateCls,
        hasAnchored && "qf-row-threaded",
      )}
      style={{ "--qf-indent": indentVar } as CSSProperties}
    >
      <span className="qf-gutter qf-gutter-old">
        {row.oldLine ?? ""}
        {canComment && anchor != null && (
          <button
            type="button"
            aria-label="Add comment"
            // Press-and-drag selects a line range (GitLab-style); pointer
            // capture keeps the stream on this button, so drag targets come
            // from hit-testing. A plain press is just a click — drag-end
            // opens the single-line composer. The click handler only serves
            // keyboard activation (detail 0); mouse opens via drag-end,
            // otherwise every drag would ALSO fire a range-killing click.
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              onPlusDragStart(fileIndex, anchor);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 0) return;
              const el = document.elementFromPoint(e.clientX, e.clientY);
              const rowEl = el?.closest?.("[data-anchor]");
              const a = rowEl?.getAttribute("data-anchor");
              const f = rowEl?.getAttribute("data-file-index");
              if (a && f != null) onPlusDragOver(Number(f), a);
            }}
            onPointerUp={onPlusDragEnd}
            onClick={(e) => {
              if (e.detail === 0) onOpenBox(fileIndex, anchor);
            }}
            className="qf-add-btn"
          >
            +
          </button>
        )}
      </span>
      <span className="qf-gutter qf-gutter-new">{row.newLine ?? ""}</span>
      <span className="qf-marker">{marker}</span>
      <code
        className="qf-code"
        style={
          guideLvl != null
            ? ({ "--qf-lvl": guideLvl } as CSSProperties)
            : undefined
        }
      >
        <span
          className="hljs"
          dangerouslySetInnerHTML={{
            // Marks are layered onto the SAME highlighted HTML (by wrapping
            // text nodes), so syntax colours stay intact under them.
            __html:
              markQuery == null
                ? highlightLineWithIntra(row.content, filename, intra)
                : markKind === "find"
                  ? highlightLineWithFind(
                      row.content,
                      filename,
                      markQuery,
                      markFlag,
                      findOrdinal,
                      intra,
                    )
                  : highlightLineWithOccurrences(
                      row.content,
                      filename,
                      markQuery,
                      markFlag,
                      intra,
                    ),
          }}
        />
      </code>
    </div>
  );
}

// The width of one mono column, measured from rendered spaces (the indent
// guides can't use `ch` — see quiet.css). One app-global measurement; only
// cached once fonts have loaded so a fallback-font value can't stick.
let monoColWidthCache: number | null = null;

function measureMonoColWidth(host: HTMLElement): number {
  const probe = document.createElement("span");
  probe.className = "qf-code";
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:pre;pointer-events:none";
  probe.textContent = " ".repeat(100);
  host.appendChild(probe);
  const w = probe.getBoundingClientRect().width / 100;
  probe.remove();
  if (w > 0 && document.fonts?.status === "loaded") monoColWidthCache = w;
  return w;
}

function CommentsBlock({
  item,
  filename,
  addPending,
  replyRequest,
  callbacks,
}: {
  item: ReviewCommentsItem;
  filename: string;
  addPending: boolean;
  replyRequest: ReplyRequest | null;
  callbacks: ReviewListCallbacks;
}) {
  const activeAccount = useAppStore((s) =>
    s.accounts.find((a) => a.id === s.activeAccountId),
  );
  const target = item.target;
  return (
    <div className="js-comment qf-comment-wrap" data-file-index={item.fileIndex}>
      {item.threads.map((thread) => (
        <CommentThread
          key={thread[0].id}
          comments={thread}
          onReply={callbacks.onReply}
          replyPending={addPending}
          onResolve={callbacks.onResolveThread}
          onHoverChange={(hovering) =>
            callbacks.onThreadHover(
              hovering ? { rootId: thread[0].id, path: filename } : null,
            )
          }
          replyRequest={replyRequest}
        />
      ))}
      {item.pending.map((p: PendingComment) => (
        <div key={p.id} className="qf-thread qf-pending">
          <div className="qf-comment">
            <div className="qf-comment-head">
              <Avatar
                url={activeAccount?.avatarUrl ?? ""}
                name={activeAccount?.login ?? "you"}
                size={20}
              />
              <span className="qf-comment-author">
                {activeAccount?.login ?? "You"}
              </span>
              <span className="qf-pending-tag">Pending</span>
              {p.startLine != null && (
                <span className="qf-range-tag">
                  Lines {p.startLine}–{p.line}
                </span>
              )}
              <button
                type="button"
                onClick={() => callbacks.onRemovePending(p.id)}
                className="qf-pending-remove qf-focusable"
              >
                Discard
              </button>
            </div>
            {/* The composer writes markdown — the pending card must render
                it, or bold comes back as asterisks the moment you save. */}
            <div className="qf-comment-body">
              <Markdown>{p.body}</Markdown>
            </div>
          </div>
        </div>
      ))}
      {item.boxOpen && target != null && (
        <div className="qf-thread">
          <div className="qf-comment">
            {item.boxStartLine != null && (
              <div className="qf-range-head">
                Lines {item.boxStartLine}–{target.line}
              </div>
            )}
            <AddCommentBox
              pending={addPending}
              autoFocus
              placeholder="Add a review comment…"
              submitLabel="Add to review"
              secondaryLabel="Comment now"
              // ```suggestion blocks replace the range as it exists on the
              // head side, so only RIGHT-side rows offer the insert; a
              // multi-line composer prefills every selected row.
              suggestionText={
                target.side === "RIGHT"
                  ? (item.rangeContent ?? item.rowContent ?? undefined)
                  : undefined
              }
              onCancel={() => callbacks.onCloseBox(item.fileIndex, item.anchor)}
              onSubmit={(body) => {
                callbacks.onAddPending({
                  path: filename,
                  line: target.line,
                  side: target.side,
                  body,
                  startLine: item.boxStartLine ?? undefined,
                });
                callbacks.onCloseBox(item.fileIndex, item.anchor);
              }}
              onSecondary={(body) => {
                // Optimistic — the comment is already in the cache; close
                // immediately, the network settles behind.
                void callbacks.onAddComment({
                  path: filename,
                  line: target.line,
                  side: target.side,
                  body,
                  startLine: item.boxStartLine ?? undefined,
                });
                callbacks.onCloseBox(item.fileIndex, item.anchor);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function GroupHeader({ ctx, groupIndex }: { ctx: ListContext; groupIndex: number }) {
  const { files, activeIndex, viewedSet, changedSinceViewed, copiedPathIndex, callbacks } =
    ctx.props;
  const file = files[groupIndex];
  if (!file) return <div className="qf-fsec-head" />;
  const glyph = glyphFor(file.status);
  const slash = file.filename.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.filename.slice(0, slash + 1);
  const basename = slash === -1 ? file.filename : file.filename.slice(slash + 1);
  const viewed = viewedSet.has(file.filename);
  const copied = copiedPathIndex === groupIndex;
  return (
    <header
      className={cn(
        "qf-fsec-head",
        groupIndex === activeIndex && "qf-fsec-active",
      )}
      data-file-index={groupIndex}
    >
      <span className={cn("qf-file-glyph", glyph.cls)}>{glyph.letter}</span>
      <button
        type="button"
        className="qf-fsec-name qf-fsec-copy"
        title={copied ? "Copied" : `${file.filename} — click to copy path`}
        onClick={() => callbacks.onCopyPath(groupIndex)}
      >
        {file.previousFilename && file.status === "renamed" && (
          <span className="qf-filebar-prev">{file.previousFilename} → </span>
        )}
        <span className="qf-file-dir">{dir}</span>
        <span className="qf-fsec-base">{basename}</span>
        {copied && (
          <span className="qf-fsec-copied" aria-live="polite">
            <Check size={11} aria-hidden /> copied
          </span>
        )}
      </button>
      {changedSinceViewed.has(file.filename) && (
        <span className="qf-updated-chip" title="Changed since you marked it viewed">
          updated
        </span>
      )}
      <span className="qf-filebar-stat">
        <span className="qf-add">+{file.additions}</span>
        <span className="qf-del">−{file.deletions}</span>
      </span>
      <button
        type="button"
        className={cn("qf-viewed-btn", viewed && "qf-viewed-on")}
        onClick={() => callbacks.onToggleViewed(groupIndex)}
        title={viewed ? "Viewed — click to unmark (v)" : "Mark as viewed (v)"}
        aria-pressed={viewed}
      >
        <Check size={12} aria-hidden />
        Viewed
      </button>
    </header>
  );
}

function renderItem(ctx: ListContext, index: number, item: ReviewItem) {
  const p = ctx.props;
  const file = p.files[item.fileIndex];
  if (!file) return <div style={{ height: 1 }} />;

  switch (item.kind) {
    case "image":
      return (
        <div data-file-index={item.fileIndex}>
          <ImageDiff
            file={file}
            owner={p.owner}
            repo={p.repo}
            baseSha={p.baseSha}
            headSha={p.headSha}
          />
        </div>
      );
    case "note":
      return (
        <div className="qf-empty" data-file-index={item.fileIndex}>
          {item.text}
        </div>
      );
    case "hunk":
      return (
        <button
          type="button"
          onClick={() => p.callbacks.onToggleHunk(item.fileIndex, item.hunkIndex)}
          className="qf-row qf-row-hunk"
          data-file-index={item.fileIndex}
        >
          <span className="qf-gutter qf-gutter-old" />
          <span className="qf-gutter qf-gutter-new" />
          <span className="qf-marker">{item.collapsed ? "▸" : ""}</span>
          <code className="qf-code">{item.header}</code>
        </button>
      );
    case "comments":
      return (
        <CommentsBlock
          item={item}
          filename={file.filename}
          addPending={p.addPending}
          replyRequest={
            p.replyRequest && p.replyRequest.path === file.filename
              ? p.replyRequest
              : null
          }
          callbacks={p.callbacks}
        />
      );
    case "row": {
      const meta = fileRenderMeta(file.patch!);
      const key =
        item.anchor != null ? fileAnchorKey(item.fileIndex, item.anchor) : null;
      const marks = p.marks;
      // Mark props flow only to rows that actually match — one indexOf over
      // each RENDERED row's text (a viewport-sized set) keeps the memoized
      // non-matching rows from rebuilding their innerHTML on every keystroke.
      // Occurrence marks additionally stay scoped to their own file (editor
      // convention — the click asks "where else HERE?").
      const marked =
        marks != null &&
        (marks.kind === "find"
          ? findMatchRangesInLine(
              item.row.content,
              marks.query,
              marks.caseSensitive,
            ).length > 0
          : marks.fileIndex === item.fileIndex &&
            occurrenceRangesInLine(item.row.content, {
              query: marks.query,
              wholeWord: marks.wholeWord,
            }).length > 0);
      const findOrdinal =
        marks?.kind === "find" &&
        p.findCurrent &&
        p.findCurrent.fileIndex === item.fileIndex &&
        item.anchor === p.findCurrent.anchor
          ? p.findCurrent.ordinal
          : null;
      const indentVar =
        ctx.colW != null
          ? `${(meta.indentUnit.ch * ctx.colW).toFixed(3)}px`
          : `${meta.indentUnit.ch}ch`;
      const sel = p.selection;
      const inSel =
        sel != null &&
        sel.fileIndex === item.fileIndex &&
        index >= sel.fromItem &&
        index <= sel.toItem;
      return (
        <DiffLine
          item={item}
          filename={file.filename}
          stateCls={cn(
            key != null && key === p.cursorKey && "qf-row-active",
            inSel && "qf-row-selected",
            inSel && index === sel.endItem && "qf-row-sel-end",
            key != null && key === p.flashKey && "qf-row-flash",
          )}
          intra={meta.intraByRow.get(item.row) ?? null}
          guideLvl={meta.guideByRow.get(item.row) ?? null}
          indentVar={indentVar}
          markKind={marked ? marks.kind : null}
          markQuery={marked ? marks.query : null}
          markFlag={
            marked
              ? marks.kind === "find"
                ? marks.caseSensitive
                : marks.wholeWord
              : false
          }
          findOrdinal={findOrdinal}
          onEnter={p.callbacks.onRowEnter}
          onOpenBox={p.callbacks.onOpenBox}
          onPlusDragStart={p.callbacks.onPlusDragStart}
          onPlusDragOver={p.callbacks.onPlusDragOver}
          onPlusDragEnd={p.callbacks.onPlusDragEnd}
        />
      );
    }
  }
}

// Custom scroller so the scroll element carries the app's classes (CSS hooks,
// e2e selectors) — virtuoso owns the element, we own its identity.
function Scroller({
  className: _cn,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      {...props}
      // Programmatically focusable so the info drawer can hand focus back
      // here on close (never in the Tab order — Tab cycles files).
      tabIndex={-1}
      className="qf-scrollhost min-w-0 flex-1"
      data-testid="review-scroller"
    />
  );
}

export function ReviewList({
  ref,
  ...props
}: ReviewListProps & { ref?: Ref<ReviewListHandle> }) {
  const vRef = useRef<GroupedVirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const { model } = props;
  // Event-time model access for the imperative handle (written in an
  // insertion effect — never during render; render paths read ctx.props).
  const modelRef = useLatest(model);

    // The measured mono-column width, held in STATE so rows re-render with
    // it (a module cache alone re-renders nothing). Measured after first
    // paint; if fonts hadn't loaded yet the value is provisional (fallback
    // font metrics) and re-measured once they land.
    const [colW, setColW] = useState<number | null>(monoColWidthCache);
    useEffect(() => {
      if (monoColWidthCache != null) return;
      const host = scrollerRef.current;
      if (!host) return;
      let cancelled = false;
      const raf = requestAnimationFrame(() => {
        const w = measureMonoColWidth(host);
        if (!cancelled && w > 0) setColW(w);
      });
      if (document.fonts?.status !== "loaded") {
        void document.fonts?.ready.then(() => {
          if (cancelled || !scrollerRef.current) return;
          const w = measureMonoColWidth(scrollerRef.current);
          if (w > 0) setColW(w);
        });
      }
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    }, []);

    function stickyHeaderPx(): number {
      const el = scrollerRef.current?.querySelector<HTMLElement>(".qf-fsec-head");
      return el?.offsetHeight ?? HEADER_FALLBACK_PX;
    }

    // Keep the cursor clear of the sticky header band when moving upward.
    const cursorViewLocation: CalculateViewLocation = ({
      itemTop,
      itemBottom,
      viewportTop,
      viewportBottom,
      locationParams: { behavior, align: _align, ...rest },
    }) => {
      const headerPx = stickyHeaderPx() + 4;
      if (itemTop < viewportTop + headerPx) {
        return { ...rest, behavior, align: "start", offset: -headerPx };
      }
      if (itemBottom > viewportBottom - 4) {
        return { ...rest, behavior, align: "end", offset: 4 };
      }
      return null;
    };

    useImperativeHandle(ref, (): ReviewListHandle => {
      return {
        scrollToFileStart(fileIndex) {
          const first = modelRef.current.groupFirstItem[fileIndex];
          if (first == null) return;
          // Plain align-start, NO offset and NO manual settling: virtuoso
          // self-converges within a couple of frames to the group boundary
          // with the target's header pinned. A per-frame corrective loop
          // here FOUGHT that convergence (visible wobble + header flicker),
          // and an offset landed a header-height short of the boundary,
          // pinning the previous file's header. The one thing this trades
          // away is the first hunk's @@ line sliding under the pinned
          // header — same as the sticky-header behavior everywhere else.
          vRef.current?.scrollToIndex({ index: first, align: "start" });
        },
        centerItem(itemIndex) {
          vRef.current?.scrollToIndex({ index: itemIndex, align: "center" });
        },
        nudgeItemIntoView(itemIndex) {
          vRef.current?.scrollIntoView({
            index: itemIndex,
            calculateViewLocation: cursorViewLocation,
          });
        },
        scroller() {
          return scrollerRef.current;
        },
        getState(cb) {
          vRef.current?.getState(cb);
        },
        firstVisibleRow() {
          const scroller = scrollerRef.current;
          if (!scroller) return null;
          const top = scroller.getBoundingClientRect().top;
          const rows = scroller.querySelectorAll<HTMLElement>("[data-anchor]");
          for (const el of rows) {
            const rect = el.getBoundingClientRect();
            if (rect.bottom <= top + 1) continue;
            const anchor = el.dataset.anchor;
            const fi = Number(el.dataset.fileIndex);
            if (anchor == null || !Number.isFinite(fi)) continue;
            return { fileIndex: fi, anchor, top: rect.top - top };
          }
          return null;
        },
        scrollItemTo(itemIndex, topPx) {
          vRef.current?.scrollToIndex({
            index: itemIndex,
            align: "start",
            offset: -topPx,
          });
        },
        firstVisibleRowItem() {
          const scroller = scrollerRef.current;
          if (!scroller) return null;
          const top = scroller.getBoundingClientRect().top + stickyHeaderPx();
          const rows = scroller.querySelectorAll<HTMLElement>("[data-anchor]");
          for (const el of rows) {
            if (el.getBoundingClientRect().bottom <= top + 4) continue;
            const anchor = el.dataset.anchor;
            const fi = Number(el.dataset.fileIndex);
            if (anchor == null || !Number.isFinite(fi)) continue;
            const idx = modelRef.current.anchorItem.get(
              fileAnchorKey(fi, anchor),
            );
            if (idx != null) return idx;
          }
          return null;
        },
      };
    });

    return (
      <div
        className="qf-diff qf-review-list min-h-0 min-w-0 flex-1"
        data-mode={props.inputMode}
        // Present only while a drag has actually formed a range — a plain
        // press must not blink the button under the pointer.
        data-dragging={props.dragging && props.selection ? "" : undefined}
        onMouseMove={(e) => props.callbacks.onMouseMove(e.clientX, e.clientY)}
      >
        <GroupedVirtuoso<unknown, ListContext>
          ref={vRef}
          context={{ props, colW }}
          groupCounts={model.groupCounts}
          groupContent={(groupIndex, ctx) => (
            <GroupHeader ctx={ctx} groupIndex={groupIndex} />
          )}
          itemContent={(index, _group, _data, ctx) =>
            renderItem(ctx, index, ctx.props.model.items[index])
          }
          computeItemKey={(index, _group, ctx) => {
            const it = ctx.props.model.items[index];
            if (!it) return `i${index}`;
            switch (it.kind) {
              case "row":
                return it.anchor != null
                  ? `r:${it.fileIndex}:${it.anchor}`
                  : `r:${it.fileIndex}:${it.hunkIndex}:${index}`;
              case "hunk":
                return `h:${it.fileIndex}:${it.hunkIndex}`;
              case "comments":
                return `c:${it.fileIndex}:${it.anchor}`;
              default:
                return `f:${it.fileIndex}:${it.kind}`;
            }
          }}
          increaseViewportBy={{ top: 400, bottom: 600 }}
          defaultItemHeight={26}
          scrollerRef={(el) => {
            scrollerRef.current = (el as HTMLElement) ?? null;
          }}
          onScroll={props.callbacks.onScroll}
          restoreStateFrom={props.restoreState}
          {...(props.restoreState == null && (props.initialFileIndex ?? 0) > 0
            ? {
                initialTopMostItemIndex:
                  model.groupFirstItem[props.initialFileIndex!] ?? 0,
              }
            : {})}
          components={{ Scroller }}
        />
      </div>
    );
}
