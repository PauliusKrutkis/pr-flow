import { Check, FoldVertical, UnfoldVertical } from "lucide-react";
import {
  type CSSProperties,
  type HTMLAttributes,
  type MouseEvent,
  type PointerEvent,
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
import { useLatest } from "../../hooks/use-latest.ts";
import { cn } from "../../lib/cn.ts";
import { canExpandFile } from "../../lib/expand-file.ts";
import { findMatchRangesInLine } from "../../lib/find-in-diff.ts";
import { highlightRowHtml } from "../../lib/highlight.ts";
import type { IntralineRanges } from "../../lib/intraline.ts";
import { occurrenceRangesInLine } from "../../lib/occurrences.ts";
import {
  fileAnchorKey,
  fileRenderMeta,
  type ReviewCommentsItem,
  type ReviewHunkItem,
  type ReviewImageItem,
  type ReviewItem,
  type ReviewListModel,
  type ReviewNoteItem,
  type ReviewRowItem,
} from "../../lib/review-items.ts";
import { useAppStore } from "../../store/app-store.ts";
import type { AccountInfo, ChangedFile, PendingComment } from "../../types.ts";
import { Markdown } from "../markdown.tsx";
import { Avatar } from "../ui/avatar.tsx";
import { Tooltip } from "../ui/tooltip.tsx";
import { AddCommentBox } from "./add-comment-box.tsx";
import { CodeCell } from "./code-cell.tsx";
import {
  CommentThread,
  type EditRequest,
  type ReplyRequest,
  type ToggleRequest,
} from "./comment-thread.tsx";
import { ImageDiff } from "./image-diff.tsx";

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
  centerItem: (itemIndex: number) => void;
  firstVisibleRow: () => {
    fileIndex: number;
    anchor: string;
    top: number;
  } | null;
  firstVisibleRowItem: () => number | null;
  getState: (cb: (state: StateSnapshot) => void) => void;
  nudgeItemIntoView: (itemIndex: number) => void;
  scroller: () => HTMLElement | null;
  scrollItemTo: (itemIndex: number, topPx: number) => void;
  scrollItemToReadingLine: (itemIndex: number) => void;
  scrollToFileStart: (fileIndex: number) => void;
}

export interface ReviewListCallbacks {
  onAddComment: (a: {
    path: string;
    line: number;
    side: string;
    body: string;
    startLine?: number;
  }) => Promise<void>;
  onAddPending: (c: {
    path: string;
    line: number;
    side: string;
    body: string;
    startLine?: number;
  }) => void;
  onCloseBox: (fileIndex: number, anchor: string) => void;
  onCopyPath: (fileIndex: number) => void;
  onDeleteComment: (a: { commentId: number }) => Promise<void>;
  onEditComment: (a: { commentId: number; body: string }) => Promise<void>;
  onMouseMove: (x: number, y: number) => void;
  onOpenBox: (fileIndex: number, anchor: string, startLine?: number) => void;
  onPlusDragEnd: () => void;
  onPlusDragOver: (fileIndex: number, anchor: string) => void;
  onPlusDragStart: (fileIndex: number, anchor: string) => void;
  onRemovePending: (id: string) => void;
  onReply: (a: { inReplyTo: number; body: string }) => Promise<void>;
  onResolveThread: (a: { threadId: string; resolved: boolean }) => void;
  onRowEnter: (fileIndex: number, anchor: string, x: number, y: number) => void;
  onScroll: () => void;
  onThreadHover: (t: { rootId: number; path: string } | null) => void;
  onToggleExpand: (fileIndex: number) => void;
  onToggleHunk: (fileIndex: number, hunkIndex: number) => void;
  onToggleViewed: (fileIndex: number) => void;
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
  editRequest: (EditRequest & { path: string }) | null;
  expandedFiles: ReadonlySet<string>;
  expandingFiles: ReadonlySet<string>;
  files: readonly ChangedFile[];
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
  toggleRequest: (ToggleRequest & { path: string }) | null;
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

/**
 * Where the expand/collapse swap parks the row you're reading: a constant
 * "reading line" this fraction of the viewport below the sticky header (vim's
 * `zz` is centered; ~1/3 keeps more of the newly revealed context visible
 * below the line, which is the point of expanding). See useExpansionScrollRestore.
 */
const READING_LINE_FRACTION = 1 / 3;

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

function diffRowMarker(type: ReviewRowItem["row"]["type"]): string {
  if (type === "add") {
    return "+";
  }
  if (type === "del") {
    return "-";
  }
  return " ";
}

function rowIsMarked(item: ReviewRowItem, marks: MarkSpec): boolean {
  if (marks.kind === "find") {
    return (
      findMatchRangesInLine(item.row.content, marks.query, marks.caseSensitive)
        .length > 0
    );
  }
  return (
    marks.fileIndex === item.fileIndex &&
    occurrenceRangesInLine(item.row.content, {
      query: marks.query,
      wholeWord: marks.wholeWord,
    }).length > 0
  );
}

function markFlagFor(marks: MarkSpec, marked: boolean): boolean {
  if (!marked) {
    return false;
  }
  if (marks.kind === "find") {
    return marks.caseSensitive;
  }
  return marks.wholeWord;
}

function computeReviewItemKey(
  index: number,
  item: ReviewItem | undefined
): string {
  if (!item) {
    return `i${index}`;
  }
  switch (item.kind) {
    case "row":
      return item.anchor === null
        ? `r:${item.fileIndex}:${item.hunkIndex}:${index}`
        : `r:${item.fileIndex}:${item.anchor}`;
    case "hunk":
      return `h:${item.fileIndex}:${item.hunkIndex}`;
    case "comments":
      return `c:${item.fileIndex}:${item.anchor}`;
    default:
      return `f:${item.fileIndex}:${item.kind}`;
  }
}

function readAnchoredRow(
  el: HTMLElement
): { anchor: string; fileIndex: number } | null {
  const { anchor, fileIndex: fileIndexRaw } = el.dataset;
  const fileIndex = Number(fileIndexRaw);
  if (anchor === undefined || !Number.isFinite(fileIndex)) {
    return null;
  }
  return { anchor, fileIndex };
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
  const canComment = item.target !== null;
  const marker = diffRowMarker(row.type);
  const lineHtml = highlightRowHtml(
    row.content,
    filename,
    intra,
    markKind,
    markQuery,
    markFlag,
    findOrdinal
  );

  const handleMouseEnter = (e: MouseEvent<HTMLDivElement>) => {
    if (anchor !== null) {
      onEnter(fileIndex, anchor, e.clientX, e.clientY);
    }
  };

  const handleAddClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (e.detail === 0 && anchor !== null) {
      onOpenBox(fileIndex, anchor);
    }
  };

  const handleAddPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (anchor === null) {
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    onPlusDragStart(fileIndex, anchor);
  };

  const handleAddPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.buttons === 0) {
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const rowEl = el?.closest?.("[data-anchor]");
    const a = rowEl?.getAttribute("data-anchor");
    const f = rowEl?.getAttribute("data-file-index");
    if (a && f !== null) {
      onPlusDragOver(Number(f), a);
    }
  };

  const rowHoverProps =
    anchor === null ? {} : { onMouseEnter: handleMouseEnter };

  return (
    <div
      className={cn(
        "qf-row",
        row.type === "add" && "qf-row-add",
        row.type === "del" && "qf-row-del",
        row.synthetic && "qf-row-xctx",
        stateCls,
        hasAnchored && "qf-row-threaded"
      )}
      data-anchor={anchor ?? undefined}
      data-file-index={fileIndex}
      style={{ "--qf-indent": indentVar } as CSSProperties}
      {...rowHoverProps}
    >
      <span className="qf-gutter qf-gutter-old">
        {row.oldLine ?? ""}
        {canComment && anchor !== null && (
          <button
            aria-label="Add comment"
            className="qf-add-btn"
            onClick={handleAddClick}
            onPointerDown={handleAddPointerDown}
            onPointerMove={handleAddPointerMove}
            onPointerUp={onPlusDragEnd}
            type="button"
          >
            +
          </button>
        )}
      </span>
      <span className="qf-gutter qf-gutter-new">{row.newLine ?? ""}</span>
      <span className="qf-marker">{marker}</span>
      <CodeCell guideLvl={guideLvl} html={lineHtml} />
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

function MappedCommentThread({
  thread,
  filename,
  addPending,
  replyRequest,
  toggleRequest,
  editRequest,
  callbacks,
}: {
  thread: ReviewCommentsItem["threads"][number];
  filename: string;
  addPending: boolean;
  replyRequest: ReplyRequest | null;
  toggleRequest: ToggleRequest | null;
  editRequest: EditRequest | null;
  callbacks: ReviewListCallbacks;
}) {
  const rootId = thread[0].id;
  const handleHoverChange = (hovering: boolean) => {
    callbacks.onThreadHover(hovering ? { path: filename, rootId } : null);
  };

  return (
    <CommentThread
      comments={thread}
      editRequest={editRequest}
      onDelete={callbacks.onDeleteComment}
      onEdit={callbacks.onEditComment}
      onHoverChange={handleHoverChange}
      onReply={callbacks.onReply}
      onResolve={callbacks.onResolveThread}
      replyPending={addPending}
      replyRequest={replyRequest}
      toggleRequest={toggleRequest}
    />
  );
}

function PendingCommentCard({
  comment,
  activeAccount,
  onRemovePending,
}: {
  comment: PendingComment;
  activeAccount: AccountInfo | undefined;
  onRemovePending: (id: string) => void;
}) {
  const handleRemove = () => {
    onRemovePending(comment.id);
  };

  return (
    <div className="qf-thread qf-pending">
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
          {comment.startLine !== null && (
            <span className="qf-range-tag">
              Lines {comment.startLine}–{comment.line}
            </span>
          )}
          <button
            className="qf-pending-remove qf-focusable"
            onClick={handleRemove}
            type="button"
          >
            Discard
          </button>
        </div>
        <div className="qf-comment-body">
          <Markdown>{comment.body}</Markdown>
        </div>
      </div>
    </div>
  );
}

function CommentAddBox({
  item,
  filename,
  target,
  addPending,
  callbacks,
}: {
  item: ReviewCommentsItem;
  filename: string;
  target: NonNullable<ReviewCommentsItem["target"]>;
  addPending: boolean;
  callbacks: ReviewListCallbacks;
}) {
  const handleCancel = () => {
    callbacks.onCloseBox(item.fileIndex, item.anchor);
  };

  const handleSecondary = (body: string) => {
    callbacks.onAddComment({
      body,
      line: target.line,
      path: filename,
      side: target.side,
      startLine: item.boxStartLine ?? undefined,
    });
    callbacks.onCloseBox(item.fileIndex, item.anchor);
  };

  const handleSubmit = (body: string) => {
    callbacks.onAddPending({
      body,
      line: target.line,
      path: filename,
      side: target.side,
      startLine: item.boxStartLine ?? undefined,
    });
    callbacks.onCloseBox(item.fileIndex, item.anchor);
  };

  return (
    <AddCommentBox
      autoFocus
      onCancel={handleCancel}
      onSecondary={handleSecondary}
      onSubmit={handleSubmit}
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
  );
}

function CommentsBlock({
  item,
  filename,
  addPending,
  replyRequest,
  toggleRequest,
  editRequest,
  callbacks,
}: {
  item: ReviewCommentsItem;
  filename: string;
  addPending: boolean;
  replyRequest: ReplyRequest | null;
  toggleRequest: ToggleRequest | null;
  editRequest: EditRequest | null;
  callbacks: ReviewListCallbacks;
}) {
  const activeAccount = useAppStore((s) =>
    s.accounts.find((a) => a.id === s.activeAccountId)
  );
  const { target } = item;

  return (
    <div
      className="js-comment qf-comment-wrap"
      data-file-index={item.fileIndex}
    >
      {item.threads.map((thread) => (
        <MappedCommentThread
          addPending={addPending}
          callbacks={callbacks}
          editRequest={editRequest}
          filename={filename}
          key={thread[0].id}
          replyRequest={replyRequest}
          thread={thread}
          toggleRequest={toggleRequest}
        />
      ))}
      {item.pending.map((pending) => (
        <PendingCommentCard
          activeAccount={activeAccount}
          comment={pending}
          key={pending.id}
          onRemovePending={callbacks.onRemovePending}
        />
      ))}
      {item.boxOpen && target !== null && (
        <div className="qf-thread">
          <div className="qf-comment">
            {item.boxStartLine !== null && (
              <div className="qf-range-head">
                Lines {item.boxStartLine}–{target.line}
              </div>
            )}
            <CommentAddBox
              addPending={addPending}
              callbacks={callbacks}
              filename={filename}
              item={item}
              target={target}
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
    expandedFiles,
    expandingFiles,
    callbacks,
  } = ctx.props;
  const file = files[groupIndex];
  const handleCopyPath = () => {
    callbacks.onCopyPath(groupIndex);
  };
  const handleToggleViewed = () => {
    callbacks.onToggleViewed(groupIndex);
  };
  const handleToggleExpand = () => {
    callbacks.onToggleExpand(groupIndex);
  };
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
  const expanded = expandedFiles.has(file.filename);
  const expanding = expandingFiles.has(file.filename);
  return (
    <header
      className={cn(
        "qf-fsec-head",
        groupIndex === activeIndex && "qf-fsec-active"
      )}
      data-file-index={groupIndex}
    >
      <span className={cn("qf-file-glyph", glyph.cls)}>{glyph.letter}</span>
      <Tooltip
        label={copied ? "Copied" : `${file.filename} — click to copy path`}
      >
        <button
          className="qf-fsec-name qf-fsec-copy"
          onClick={handleCopyPath}
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
      </Tooltip>
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
      {canExpandFile(file) && (
        <Tooltip
          combo="shift+v"
          label={expanded ? "Back to the diff" : "Expand to the full file"}
        >
          <button
            aria-busy={expanding || undefined}
            aria-pressed={expanded}
            className={cn("qf-expand-btn", expanded && "qf-expand-on")}
            onClick={handleToggleExpand}
            type="button"
          >
            {expanded ? (
              <FoldVertical aria-hidden size={12} />
            ) : (
              <UnfoldVertical aria-hidden size={12} />
            )}
            {expanded ? "Diff only" : "Full file"}
          </button>
        </Tooltip>
      )}
      <Tooltip
        combo="v"
        label={viewed ? "Viewed — click to unmark" : "Mark as viewed"}
      >
        <button
          aria-pressed={viewed}
          className={cn("qf-viewed-btn", viewed && "qf-viewed-on")}
          onClick={handleToggleViewed}
          type="button"
        >
          <Check aria-hidden size={12} />
          Viewed
        </button>
      </Tooltip>
    </header>
  );
}

function HunkRow({
  item,
  onToggleHunk,
}: {
  item: ReviewHunkItem;
  onToggleHunk: ReviewListCallbacks["onToggleHunk"];
}) {
  const handleClick = () => {
    onToggleHunk(item.fileIndex, item.hunkIndex);
  };

  return (
    <button
      className="qf-row qf-row-hunk"
      data-file-index={item.fileIndex}
      onClick={handleClick}
      type="button"
    >
      <span className="qf-gutter qf-gutter-old" />
      <span className="qf-gutter qf-gutter-new" />
      <span className="qf-marker">{item.collapsed ? "▸" : ""}</span>
      <code className="qf-code">{item.header}</code>
    </button>
  );
}

function renderImageItem(
  p: ReviewListProps,
  item: ReviewImageItem,
  file: ChangedFile
) {
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
}

function renderNoteItem(item: ReviewNoteItem) {
  return (
    <div className="qf-empty" data-file-index={item.fileIndex}>
      {item.text}
    </div>
  );
}

function renderCommentsItem(
  p: ReviewListProps,
  item: ReviewCommentsItem,
  file: ChangedFile
) {
  return (
    <CommentsBlock
      addPending={p.addPending}
      callbacks={p.callbacks}
      editRequest={
        p.editRequest && p.editRequest.path === file.filename
          ? p.editRequest
          : null
      }
      filename={file.filename}
      item={item}
      replyRequest={
        p.replyRequest && p.replyRequest.path === file.filename
          ? p.replyRequest
          : null
      }
      toggleRequest={
        p.toggleRequest && p.toggleRequest.path === file.filename
          ? p.toggleRequest
          : null
      }
    />
  );
}

function renderRowItem(
  ctx: ListContext,
  index: number,
  item: ReviewRowItem,
  file: ChangedFile,
  p: ReviewListProps
) {
  const { patch } = file;
  if (!patch) {
    return <div style={{ height: 1 }} />;
  }
  const meta = fileRenderMeta(patch);
  const key =
    item.anchor === null ? null : fileAnchorKey(item.fileIndex, item.anchor);
  const { marks } = p;
  const marked = marks !== null && rowIsMarked(item, marks);
  const findOrdinal =
    marks?.kind === "find" &&
    p.findCurrent &&
    p.findCurrent.fileIndex === item.fileIndex &&
    item.anchor === p.findCurrent.anchor
      ? p.findCurrent.ordinal
      : null;
  const indentVar =
    ctx.colW === null
      ? `${meta.indentUnit.ch}ch`
      : `${(meta.indentUnit.ch * ctx.colW).toFixed(3)}px`;
  const sel = p.selection;
  const inSel =
    sel !== null &&
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
      markFlag={marks === null ? false : markFlagFor(marks, marked)}
      markKind={marked && marks !== null ? marks.kind : null}
      markQuery={marked && marks !== null ? marks.query : null}
      onEnter={p.callbacks.onRowEnter}
      onOpenBox={p.callbacks.onOpenBox}
      onPlusDragEnd={p.callbacks.onPlusDragEnd}
      onPlusDragOver={p.callbacks.onPlusDragOver}
      onPlusDragStart={p.callbacks.onPlusDragStart}
      stateCls={cn(
        key !== null && key === p.cursorKey && "qf-row-active",
        inSel && "qf-row-selected",
        inSel && index === sel.endItem && "qf-row-sel-end",
        key !== null && key === p.flashKey && "qf-row-flash"
      )}
    />
  );
}

function renderItem(
  ctx: ListContext,
  index: number,
  item: ReviewItem | undefined
) {
  if (!item) {
    return <div style={{ height: 1 }} />;
  }
  const p = ctx.props;
  const file = p.files[item.fileIndex];
  if (!file) {
    return <div style={{ height: 1 }} />;
  }

  switch (item.kind) {
    case "image":
      return renderImageItem(p, item, file);
    case "note":
      return renderNoteItem(item);
    case "hunk":
      return <HunkRow item={item} onToggleHunk={p.callbacks.onToggleHunk} />;
    case "comments":
      return renderCommentsItem(p, item, file);
    case "row":
      return renderRowItem(ctx, index, item, file, p);
    default:
      return <div style={{ height: 1 }} />;
  }
}

function virtuosoComputeItemKey(
  index: number,
  _group: unknown,
  ctx: ListContext
) {
  return computeReviewItemKey(index, ctx.props.model.items[index]);
}

function virtuosoGroupContent(groupIndex: number, ctx: ListContext) {
  return <GroupHeader ctx={ctx} groupIndex={groupIndex} />;
}

function virtuosoItemContent(
  index: number,
  _group: unknown,
  _data: unknown,
  ctx: ListContext
) {
  return renderItem(ctx, index, ctx.props.model.items[index]);
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
  initialFileIndex,
  restoreState,
  ...props
}: ReviewListProps & { ref?: Ref<ReviewListHandle> }) {
  const vRef = useRef<GroupedVirtuosoHandle>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const { model } = props;

  const modelRef = useLatest(model);

  const [colW, setColW] = useState<number | null>(monoColWidthCache);
  useEffect(() => {
    if (monoColWidthCache !== null) {
      return;
    }
    const host = scrollerRef.current;
    if (!host) {
      return;
    }
    let cancelled = false;
    const tryMeasure = (element: HTMLElement) => {
      const w = measureMonoColWidth(element);
      if (!cancelled && w > 0) {
        setColW(w);
      }
    };
    const raf = requestAnimationFrame(() => {
      tryMeasure(host);
    });

    async function remeasureAfterFonts() {
      if (!document.fonts || document.fonts.status === "loaded") {
        return;
      }
      try {
        await document.fonts.ready;
      } catch {
        return;
      }
      if (cancelled || !scrollerRef.current) {
        return;
      }
      tryMeasure(scrollerRef.current);
    }
    remeasureAfterFonts();

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
        const { top } = scroller.getBoundingClientRect();
        const rows = scroller.querySelectorAll<HTMLElement>("[data-anchor]");
        for (const el of rows) {
          const rect = el.getBoundingClientRect();
          if (rect.bottom <= top + 1) {
            continue;
          }
          const anchored = readAnchoredRow(el);
          if (!anchored) {
            continue;
          }
          return { ...anchored, top: rect.top - top };
        }
        return null;
      },
      firstVisibleRowItem() {
        const scroller = scrollerRef.current;
        if (!scroller) {
          return null;
        }
        const { top: scrollerTop } = scroller.getBoundingClientRect();
        const top = scrollerTop + stickyHeaderPx();
        const rows = scroller.querySelectorAll<HTMLElement>("[data-anchor]");
        for (const el of rows) {
          if (el.getBoundingClientRect().bottom <= top + 4) {
            continue;
          }
          const anchored = readAnchoredRow(el);
          if (!anchored) {
            continue;
          }
          const idx = modelRef.current.anchorItem.get(
            fileAnchorKey(anchored.fileIndex, anchored.anchor)
          );
          if (idx !== undefined) {
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
      scrollItemToReadingLine(itemIndex) {
        const scroller = scrollerRef.current;
        const viewport = scroller?.clientHeight ?? 0;
        const readingLine =
          stickyHeaderPx() + Math.round(viewport * READING_LINE_FRACTION);
        vRef.current?.scrollToIndex({
          align: "start",
          index: itemIndex,
          offset: -readingLine,
        });
      },
      scrollToFileStart(fileIndex) {
        const first = modelRef.current.groupFirstItem[fileIndex];
        if (first === null) {
          return;
        }
        vRef.current?.scrollToIndex({ align: "start", index: first });
      },
    })
  );

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    props.callbacks.onMouseMove(e.clientX, e.clientY);
  };

  const handleScrollerRef = (el: HTMLElement | Window | null) => {
    scrollerRef.current = (el as HTMLElement) ?? null;
  };

  const virtuosoInitialIndex =
    restoreState === null &&
    initialFileIndex !== undefined &&
    initialFileIndex > 0
      ? (model.groupFirstItem[initialFileIndex] ?? 0)
      : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: tracks drag selection across the diff surface
    <div
      className="qf-diff qf-review-list min-h-0 min-w-0 flex-1"
      data-dragging={props.dragging && props.selection ? "" : undefined}
      data-mode={props.inputMode}
      onMouseMove={handleMouseMove}
    >
      <GroupedVirtuoso<unknown, ListContext>
        computeItemKey={virtuosoComputeItemKey}
        context={{ colW, props }}
        defaultItemHeight={26}
        groupContent={virtuosoGroupContent}
        groupCounts={model.groupCounts}
        increaseViewportBy={{ bottom: 600, top: 400 }}
        itemContent={virtuosoItemContent}
        onScroll={props.callbacks.onScroll}
        ref={vRef}
        restoreStateFrom={restoreState}
        scrollerRef={handleScrollerRef}
        {...(virtuosoInitialIndex === undefined
          ? {}
          : { initialTopMostItemIndex: virtuosoInitialIndex })}
        components={{ Scroller }}
      />
    </div>
  );
}
