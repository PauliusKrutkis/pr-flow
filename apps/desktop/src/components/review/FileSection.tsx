import { memo, useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import type { ChangedFile, PendingComment, ReviewComment } from "../../types";
import { cn } from "../../lib/cn";
import {
  DiffViewer,
  type CursorSeed,
  type FindCurrent,
  type MarkSpec,
  type JumpTarget,
} from "./DiffViewer";
import { ImageDiff, isImageFile } from "./ImageDiff";

export interface FileSectionCallbacks {
  onActivate: (index: number) => void;
  onCursorExit: (index: number, dir: 1 | -1) => void;
  onToggleViewed: (index: number) => void;
  onAddComment: (a: {
    path: string;
    line: number;
    side: string;
    body: string;
  }) => Promise<void>;
  onReply: (a: { inReplyTo: number; body: string }) => Promise<void>;
  onAddPending: (c: {
    path: string;
    line: number;
    side: string;
    body: string;
  }) => void;
  onRemovePending: (id: string) => void;
}

interface FileSectionProps extends FileSectionCallbacks {
  file: ChangedFile;
  index: number;
  /** The file the keyboard talks to (and the sidebar highlights). */
  active: boolean;
  /** Windowing: the diff body renders only once the section nears the viewport. */
  mountedBody: boolean;
  estimatedHeight: number;
  registerEl: (index: number, el: HTMLElement | null) => void;
  viewed: boolean;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
  comments: ReviewComment[];
  pending: PendingComment[];
  jump: JumpTarget | null;
  seed: CursorSeed | null;
  /**
   * Occurrence marks — the find bar's (mod+f) or the selection's. `marks`
   * shares one identity across all sections (it only changes with the query),
   * and `findCurrent` is non-null for exactly one section — so stepping
   * through find matches re-renders at most two sections and this memo
   * contract holds.
   */
  marks: MarkSpec | null;
  findCurrent: FindCurrent | null;
  /** Content changed since the reviewer marked it viewed (auto-unviewed). */
  changed: boolean;
  addPending: boolean;
}

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

/**
 * One changed file in the continuous review scroll: a sticky path header and,
 * once the section nears the viewport, the diff (or image comparison). Until
 * then a placeholder holds the estimated height so the scrollbar stays honest.
 *
 * Memoized: scroll-driven active-file changes re-render two sections, not all.
 */
export const FileSection = memo(function FileSection({
  file,
  index,
  active,
  mountedBody,
  estimatedHeight,
  registerEl,
  viewed,
  owner,
  repo,
  baseSha,
  headSha,
  comments,
  pending,
  jump,
  seed,
  marks,
  findCurrent,
  changed,
  addPending,
  onActivate,
  onCursorExit,
  onToggleViewed,
  onAddComment,
  onReply,
  onAddPending,
  onRemovePending,
}: FileSectionProps) {
  const glyph = glyphFor(file.status);
  const slash = file.filename.lastIndexOf("/");
  const dir = slash === -1 ? "" : file.filename.slice(0, slash + 1);
  const basename = slash === -1 ? file.filename : file.filename.slice(slash + 1);

  // The header path is a copy target (like the branch chips): click copies,
  // a check confirms in place. Mirrors the mod+shift+c binding for the mouse.
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);
  function copyPath() {
    void navigator.clipboard?.writeText(file.filename).catch(() => {});
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <section
      ref={(el) => registerEl(index, el)}
      data-file-index={index}
      className={cn("qf-fsec", active && "qf-fsec-active")}
    >
      <header className="qf-fsec-head">
        <span className={cn("qf-file-glyph", glyph.cls)}>{glyph.letter}</span>
        <button
          type="button"
          className="qf-fsec-name qf-fsec-copy"
          title={copied ? "Copied" : `${file.filename} — click to copy path`}
          onClick={copyPath}
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
        {changed && (
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
          type="button"
          className={cn("qf-viewed-btn", viewed && "qf-viewed-on")}
          onClick={() => onToggleViewed(index)}
          title={viewed ? "Viewed — click to unmark (v)" : "Mark as viewed (v)"}
          aria-pressed={viewed}
        >
          <Check size={12} aria-hidden />
          Viewed
        </button>
      </header>

      {mountedBody ? (
        isImageFile(file) ? (
          <ImageDiff
            file={file}
            owner={owner}
            repo={repo}
            baseSha={baseSha}
            headSha={headSha}
          />
        ) : (
          <DiffViewer
            file={file}
            comments={comments}
            commitId={headSha}
            pending={pending}
            jumpTo={jump}
            seed={seed}
            marks={marks}
            findCurrent={findCurrent}
            active={active}
            onActivate={() => onActivate(index)}
            onCursorExit={(dir) => onCursorExit(index, dir)}
            onAddComment={onAddComment}
            onReply={onReply}
            onAddPending={onAddPending}
            onRemovePending={onRemovePending}
            addPending={addPending}
          />
        )
      ) : (
        <div
          className="qf-fsec-ph"
          style={{ height: estimatedHeight }}
          aria-hidden
        />
      )}
    </section>
  );
});
