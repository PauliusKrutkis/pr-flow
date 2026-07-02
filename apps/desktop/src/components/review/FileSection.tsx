import { memo } from "react";
import { Check } from "lucide-react";
import type { ChangedFile, PendingComment, ReviewComment } from "../../types";
import { cn } from "../../lib/cn";
import { DiffViewer, type CursorSeed, type JumpTarget } from "./DiffViewer";
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

  return (
    <section
      ref={(el) => registerEl(index, el)}
      data-file-index={index}
      className={cn("qf-fsec", active && "qf-fsec-active")}
    >
      <header className="qf-fsec-head">
        <span className={cn("qf-file-glyph", glyph.cls)}>{glyph.letter}</span>
        <span className="qf-fsec-name" title={file.filename}>
          {file.previousFilename && file.status === "renamed" && (
            <span className="qf-filebar-prev">{file.previousFilename} → </span>
          )}
          <span className="qf-file-dir">{dir}</span>
          <span className="qf-fsec-base">{basename}</span>
        </span>
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
