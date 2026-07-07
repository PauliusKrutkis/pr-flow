import { Check } from "lucide-react";
import {
  type CSSProperties,
  type HTMLAttributes,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import {
  type CalculateViewLocation,
  GroupedVirtuoso,
  type GroupedVirtuosoHandle,
  type StateSnapshot,
} from "react-virtuoso";
import { useLatest } from "../../hooks/useLatest.ts";
import { cn } from "../../lib/cn.ts";
import { findMatchRangesInLine } from "../../lib/findInDiff.ts";
import {
  highlightLineWithFind,
  highlightLineWithIntra,
  highlightLineWithOccurrences,
} from "../../lib/highlight.ts";
import type { IntralineRanges } from "../../lib/intraline.ts";
import { occurrenceRangesInLine } from "../../lib/occurrences.ts";
import {
  fileAnchorKey,
  fileRenderMeta,
  type ReviewCommentsItem,
  type ReviewItem,
  type ReviewListModel,
  type ReviewRowItem,
} from "../../lib/reviewItems.ts";
import { useAppStore } from "../../store/appStore.ts";
import type { ChangedFile, PendingComment } from "../../types.ts";
import { Markdown } from "../Markdown.tsx";
import { Avatar } from "../ui/Avatar.tsx";
import { AddCommentBox } from "./AddCommentBox.tsx";
import { CommentThread, type ReplyRequest } from "./CommentThread.tsx";
import { ImageDiff } from "./ImageDiff.tsx";

/**
 * What to mark on every rendered row — the find bar's (mod+f) or the
 * selection-occurrence highlights. At most one is active (find wins while its
 * bar is open). With the list virtualized, only the ~viewport's worth of rows
 * exists, so marks go to every rendered row unconditionally — the per-section
 * and per-row gating the windowed implementation needed is obsolete.
 */
export type MarkSpec =
  | { kind: "find"; query: string; caseSensitive: boolean }
  | {
      kind: "occurrence";
      query: string;
      wholeWord: boolean;
      fileIndex: number;
    };

/** The current find match: which file/row, which occurrence within the row. */
export interface FindCurrent {
  anchor: string;
  fileIndex: number;
  ordinal: number;
}

export interface ReviewListHandle {
  centerItem(itemIndex: number): void;
  firstVisibleRow(): { fileIndex: number; anchor: string; top: number } | null;
  firstVisibleRowItem(): number | null;
  getState(cb: (state: StateSnapshot) => void): void;
  nudgeItemIntoView(itemIndex: number): void;
  scroller(): HTMLElement | null;
  scrollItemTo(itemIndex: number, topPx: number): void;
  scrollToFileStart(fileIndex: number): void;
}

export interface ReviewListCallbacks {
  onAddComment(a: {
    path: string;
    line: number;
    side: string;
    body: string;
    startLine?: number;
  }): Promise<void>;
  onAddPending(c: {
    path: string;
    line: number;
    side: string;
    body: string;
    startLine?: number;
  }): void;
  onCloseBox(fileIndex: number, anchor: string): void;
  onCopyPath(fileIndex: number): void;
  onMouseMove(x: number, y: number): void;
  onOpenBox(fileIndex: number, anchor: string, startLine?: number): void;
  onPlusDragEnd(): void;
  onPlusDragOver(fileIndex: number, anchor: string): void;
  onPlusDragStart(fileIndex: number, anchor: string): void;
  onRemovePending(id: string): void;
  onReply(a: { inReplyTo: number; body: string }): Promise<void>;
  onResolveThread(a: { threadId: string; resolved: boolean }): void;
  onRowEnter(fileIndex: number, anchor: string, x: number, y: number): void;
  onScroll(): void;
  onThreadHover(t: { rootId: number; path: string } | null): void;
  onToggleHunk(fileIndex: number, hunkIndex: number): void;
  onToggleViewed(fileIndex: number): void;
}

interface ReviewListProps {
  activeIndex: number;
  addPending: boolean;
  baseSha: string;
  callbacks: ReviewListCallbacks;
  changedSinceViewed: ReadonlySet<string>;
  copiedPathIndex: number | null;
  cursorKey: string | null;
  dragging: boolean;
  files: ReadonlyArray<ChangedFile>;
  findCurrent: FindCurrent | null;
  flashKey: string | null;
  headSha: string;
  initialFileIndex?: number;
  inputMode: "keyboard" | "mouse";
  marks: MarkSpec | null;
  model: ReviewListModel;
  owner: string;
  replyRequest: (ReplyRequest & { path: string }) | null;
  repo: string;
  restoreState?: StateSnapshot;
  selection: {
    fileIndex: number;
    fromItem: number;
    toItem: number;
    endItem: number;
  } | null;
  viewedSet: ReadonlySet<string>;
}

interface ListContext {
  colW: number | null;
  props: ReviewListProps;
}

/**
 * The sticky group-header band the cursor must clear when moving upward.
 * Measured lazily from the rendered header; this is the pre-measure fallback.
 */
const HEADER_FALLBACK_PX = 36;

function glyphFor(status: string): { letter: string; cls: string } {
  switch (status) {
    case "added":
      return { cls: "qf-st-add", letter: "A" };
    case "removed":
      return { cls: "qf-st-del", letter: "D" };
    case "renamed":
      return { cls: "qf-st-ren", letter: "R" };
    case "copied":
      return { cls: "qf-st-ren", letter: "C" };
    default:
      return { cls: "qf-st-mod", letter: "M" };
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
  stateCls: string;
  intra: IntralineRanges | null;
  guideLvl: number | null;
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
      className={cn(
        "qf-row",
        row.type === "add" && "qf-row-add",
        row.type === "del" && "qf-row-del",
        stateCls,
        hasAnchored && "qf-row-threaded"
      )}
      data-anchor={anchor ?? undefined}
      data-file-index={fileIndex}
      onMouseEnter={
        anchor == null
          ? undefined
          : (e) => onEnter(fileIndex, anchor, e.clientX, e.clientY)
      }
      style={{ "--qf-indent": indentVar } as CSSProperties}
    >
      <span className="qf-gutter qf-gutter-old">
        {row.oldLine ?? ""}
        {canComment && anchor != null && (
          <button
            aria-label="Add comment"
            className="qf-add-btn"
            onClick={(e) => {
              if (e.detail === 0) {
                onOpenBox(fileIndex, anchor);
              }
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              onPlusDragStart(fileIndex, anchor);
            }}
            onPointerMove={(e) => {
              if (e.buttons === 0) {
                return;
              }
              const el = document.elementFromPoint(e.clientX, e.clientY);
              const rowEl = el?.closest?.("[data-anchor]");
              const a = rowEl?.getAttribute("data-anchor");
              const f = rowEl?.getAttribute("data-file-index");
              if (a && f != null) {
                onPlusDragOver(Number(f), a);
              }
            }}
            onPointerUp={onPlusDragEnd}
            type="button"
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
          guideLvl == null
            ? undefined
            : ({ "--qf-lvl": guideLvl } as CSSProperties)
        }
      >
        <span
          className="hljs"
          dangerouslySetInnerHTML={{
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
                      intra
                    )
                  : highlightLineWithOccurrences(
                      row.content,
                      filename,
                      markQuery,
                      markFlag,
                      intra
                    ),
          }}
        />
      </code>
    </div>
  );
}

/**
 * The width of one mono column, measured from rendered spaces (the indent
 * guides can't use `ch` — see quiet.css). One app-global measurement; only
 * cached once fonts have loaded so a fallback-font value can't stick.
 */
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
  if (w > 0 && document.fonts?.status === "loaded") {
    monoColWidthCache = w;
  }
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
    s.accounts.find((a) => a.id === s.activeAccountId)
  );
  const target = item.target;
  return (
    <div
      className="js-comment qf-comment-wrap"
      data-file-index={item.fileIndex}
    >
      {item.threads.map((thread) => (
        <CommentThread
          comments={thread}
          key={thread[0].id}
          onHoverChange={(hovering) =>
            callbacks.onThreadHover(
              hovering ? { path: filename, rootId: thread[0].id } : null
            )
          }
          onReply={callbacks.onReply}
          onResolve={callbacks.onResolveThread}
          replyPending={addPending}
          replyRequest={replyRequest}
        />
      ))}
      {item.pending.map((p: PendingComment) => (
        <div className="qf-thread qf-pending" key={p.id}>
          <div className="qf-comment">
            <div className="qf-comment-head">
              <Avatar
                name={activeAccount?.login ?? "you"}
                size={20}
                url={activeAccount?.avatarUrl ?? ""}
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
                className="qf-pending-remove qf-focusable"
                onClick={() => callbacks.onRemovePending(p.id)}
                type="button"
              >
                Discard
              </button>
            </div>
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
              autoFocus
              onCancel={() => callbacks.onCloseBox(item.fileIndex, item.anchor)}
              onSecondary={(body) => {
                void callbacks.onAddComment({
                  body,
                  line: target.line,
                  path: filename,
                  side: target.side,
                  startLine: item.boxStartLine ?? undefined,
                });
                callbacks.onCloseBox(item.fileIndex, item.anchor);
              }}
              onSubmit={(body) => {
                callbacks.onAddPending({
                  body,
                  line: target.line,
                  path: filename,
                  side: target.side,
                  startLine: item.boxStartLine ?? undefined,
                });
                callbacks.onCloseBox(item.fileIndex, item.anchor);
              }}
              pending={addPending}
              placeholder="Add a review comment…"
              secondaryLabel="Comment now"
              submitLabel="Add to review"
              suggestionText={
                target.side === "RIGHT"
                  ? (item.rangeContent ?? item.rowContent ?? undefined)
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function GroupHeader({
  ctx,
  groupIndex,
}: {
  ctx: ListContext;
  groupIndex: number;
}) {
  const {
    files,
    activeIndex,
    viewedSet,
    changedSinceViewed,
    copiedPathIndex,
    callbacks,
  } = ctx.props;
  const file = files[groupIndex];
  if (!file) {
    return <div className="qf-fsec-head" />;
  }
  const glyph = glyphFor(file.status);
  const slash = file.filename.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.filename.slice(0, slash + 1);
  const basename =
    slash === -1 ? file.filename : file.filename.slice(slash + 1);
  const viewed = viewedSet.has(file.filename);
  const copied = copiedPathIndex === groupIndex;
  return (
    <header
      className={cn(
        "qf-fsec-head",
        groupIndex === activeIndex && "qf-fsec-active"
      )}
      data-file-index={groupIndex}
    >
      <span className={cn("qf-file-glyph", glyph.cls)}>{glyph.letter}</span>
      <button
        className="qf-fsec-name qf-fsec-copy"
        onClick={() => callbacks.onCopyPath(groupIndex)}
        title={copied ? "Copied" : `${file.filename} — click to copy path`}
        type="button"
      >
        {file.previousFilename && file.status === "renamed" && (
          <span className="qf-filebar-prev">{file.previousFilename} → </span>
        )}
        <span className="qf-file-dir">{dir}</span>
        <span className="qf-fsec-base">{basename}</span>
        {copied && (
          <span aria-live="polite" className="qf-fsec-copied">
            <Check aria-hidden size={11} /> copied
          </span>
        )}
      </button>
      {changedSinceViewed.has(file.filename) && (
        <span
          className="qf-updated-chip"
          title="Changed since you marked it viewed"
        >
          updated
        </span>
      )}
      <span className="qf-filebar-stat">
        <span className="qf-add">+{file.additions}</span>
        <span className="qf-del">−{file.deletions}</span>
      </span>
      <button
        aria-pressed={viewed}
        className={cn("qf-viewed-btn", viewed && "qf-viewed-on")}
        onClick={() => callbacks.onToggleViewed(groupIndex)}
        title={viewed ? "Viewed — click to unmark (v)" : "Mark as viewed (v)"}
        type="button"
      >
        <Check aria-hidden size={12} />
        Viewed
      </button>
    </header>
  );
}

function renderItem(ctx: ListContext, index: number, item: ReviewItem) {
  const p = ctx.props;
  const file = p.files[item.fileIndex];
  if (!file) {
    return <div style={{ height: 1 }} />;
  }

  switch (item.kind) {
    case "image":
      return (
        <div data-file-index={item.fileIndex}>
          <ImageDiff
            baseSha={p.baseSha}
            file={file}
            headSha={p.headSha}
            owner={p.owner}
            repo={p.repo}
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
          className="qf-row qf-row-hunk"
          data-file-index={item.fileIndex}
          onClick={() =>
            p.callbacks.onToggleHunk(item.fileIndex, item.hunkIndex)
          }
          type="button"
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
          addPending={p.addPending}
          callbacks={p.callbacks}
          filename={file.filename}
          item={item}
          replyRequest={
            p.replyRequest && p.replyRequest.path === file.filename
              ? p.replyRequest
              : null
          }
        />
      );
    case "row": {
      const meta = fileRenderMeta(file.patch!);
      const key =
        item.anchor == null ? null : fileAnchorKey(item.fileIndex, item.anchor);
      const marks = p.marks;

      const marked =
        marks != null &&
        (marks.kind === "find"
          ? findMatchRangesInLine(
              item.row.content,
              marks.query,
              marks.caseSensitive
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
        ctx.colW == null
          ? `${meta.indentUnit.ch}ch`
          : `${(meta.indentUnit.ch * ctx.colW).toFixed(3)}px`;
      const sel = p.selection;
      const inSel =
        sel != null &&
        sel.fileIndex === item.fileIndex &&
        index >= sel.fromItem &&
        index <= sel.toItem;
      return (
        <DiffLine
          filename={file.filename}
          findOrdinal={findOrdinal}
          guideLvl={meta.guideByRow.get(item.row) ?? null}
          indentVar={indentVar}
          intra={meta.intraByRow.get(item.row) ?? null}
          item={item}
          markFlag={
            marked
              ? marks.kind === "find"
                ? marks.caseSensitive
                : marks.wholeWord
              : false
          }
          markKind={marked ? marks.kind : null}
          markQuery={marked ? marks.query : null}
          onEnter={p.callbacks.onRowEnter}
          onOpenBox={p.callbacks.onOpenBox}
          onPlusDragEnd={p.callbacks.onPlusDragEnd}
          onPlusDragOver={p.callbacks.onPlusDragOver}
          onPlusDragStart={p.callbacks.onPlusDragStart}
          stateCls={cn(
            key != null && key === p.cursorKey && "qf-row-active",
            inSel && "qf-row-selected",
            inSel && index === sel.endItem && "qf-row-sel-end",
            key != null && key === p.flashKey && "qf-row-flash"
          )}
        />
      );
    }
  }
}

/**
 * Custom scroller so the scroll element carries the app's classes (CSS hooks,
 * e2e selectors) — virtuoso owns the element, we own its identity.
 */
function Scroller({
  className: _cn,
  ref,
  ...props
}: HTMLAttributes<HTMLDivElement> & { ref?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={ref}
      {...props}
      className="qf-scrollhost min-w-0 flex-1"
      data-testid="review-scroller"
      tabIndex={-1}
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

  const modelRef = useLatest(model);

  const [colW, setColW] = useState<number | null>(monoColWidthCache);
  useEffect(() => {
    if (monoColWidthCache != null) {
      return;
    }
    const host = scrollerRef.current;
    if (!host) {
      return;
    }
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      const w = measureMonoColWidth(host);
      if (!cancelled && w > 0) {
        setColW(w);
      }
    });
    if (document.fonts?.status !== "loaded") {
      void document.fonts?.ready.then(() => {
        if (cancelled || !scrollerRef.current) {
          return;
        }
        const w = measureMonoColWidth(scrollerRef.current);
        if (w > 0) {
          setColW(w);
        }
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

  const cursorViewLocation: CalculateViewLocation = ({
    itemTop,
    itemBottom,
    viewportTop,
    viewportBottom,
    locationParams: { behavior, align: _align, ...rest },
  }) => {
    const headerPx = stickyHeaderPx() + 4;
    if (itemTop < viewportTop + headerPx) {
      return { ...rest, align: "start", behavior, offset: -headerPx };
    }
    if (itemBottom > viewportBottom - 4) {
      return { ...rest, align: "end", behavior, offset: 4 };
    }
    return null;
  };

  useImperativeHandle(
    ref,
    (): ReviewListHandle => ({
      centerItem(itemIndex) {
        vRef.current?.scrollToIndex({ align: "center", index: itemIndex });
      },
      firstVisibleRow() {
        const scroller = scrollerRef.current;
        if (!scroller) {
          return null;
        }
        const top = scroller.getBoundingClientRect().top;
        const rows = scroller.querySelectorAll<HTMLElement>("[data-anchor]");
        for (const el of rows) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom <= top + 1) {
            continue;
          }
          const anchor = el.dataset.anchor;
          const fi = Number(el.dataset.fileIndex);
          if (anchor == null || !Number.isFinite(fi)) {
            continue;
          }
          return { anchor, fileIndex: fi, top: rect.top - top };
        }
        return null;
      },
      firstVisibleRowItem() {
        const scroller = scrollerRef.current;
        if (!scroller) {
          return null;
        }
        const top = scroller.getBoundingClientRect().top + stickyHeaderPx();
        const rows = scroller.querySelectorAll<HTMLElement>("[data-anchor]");
        for (const el of rows) {
          if (el.getBoundingClientRect().bottom <= top + 4) {
            continue;
          }
          const anchor = el.dataset.anchor;
          const fi = Number(el.dataset.fileIndex);
          if (anchor == null || !Number.isFinite(fi)) {
            continue;
          }
          const idx = modelRef.current.anchorItem.get(
            fileAnchorKey(fi, anchor)
          );
          if (idx != null) {
            return idx;
          }
        }
        return null;
      },
      getState(cb) {
        vRef.current?.getState(cb);
      },
      nudgeItemIntoView(itemIndex) {
        vRef.current?.scrollIntoView({
          calculateViewLocation: cursorViewLocation,
          index: itemIndex,
        });
      },
      scroller() {
        return scrollerRef.current;
      },
      scrollItemTo(itemIndex, topPx) {
        vRef.current?.scrollToIndex({
          align: "start",
          index: itemIndex,
          offset: -topPx,
        });
      },
      scrollToFileStart(fileIndex) {
        const first = modelRef.current.groupFirstItem[fileIndex];
        if (first == null) {
          return;
        }
        vRef.current?.scrollToIndex({ align: "start", index: first });
      },
    })
  );

  return (
    <div
      className="qf-diff qf-review-list min-h-0 min-w-0 flex-1"
      data-dragging={props.dragging && props.selection ? "" : undefined}
      data-mode={props.inputMode}
      onMouseMove={(e) => props.callbacks.onMouseMove(e.clientX, e.clientY)}
    >
      <GroupedVirtuoso<unknown, ListContext>
        computeItemKey={(index, _group, ctx) => {
          const it = ctx.props.model.items[index];
          if (!it) {
            return `i${index}`;
          }
          switch (it.kind) {
            case "row":
              return it.anchor == null
                ? `r:${it.fileIndex}:${it.hunkIndex}:${index}`
                : `r:${it.fileIndex}:${it.anchor}`;
            case "hunk":
              return `h:${it.fileIndex}:${it.hunkIndex}`;
            case "comments":
              return `c:${it.fileIndex}:${it.anchor}`;
            default:
              return `f:${it.fileIndex}:${it.kind}`;
          }
        }}
        context={{ colW, props }}
        defaultItemHeight={26}
        groupContent={(groupIndex, ctx) => (
          <GroupHeader ctx={ctx} groupIndex={groupIndex} />
        )}
        groupCounts={model.groupCounts}
        increaseViewportBy={{ bottom: 600, top: 400 }}
        itemContent={(index, _group, _data, ctx) =>
          renderItem(ctx, index, ctx.props.model.items[index])
        }
        onScroll={props.callbacks.onScroll}
        ref={vRef}
        restoreStateFrom={props.restoreState}
        scrollerRef={(el) => {
          scrollerRef.current = (el as HTMLElement) ?? null;
        }}
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
