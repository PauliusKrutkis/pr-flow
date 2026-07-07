/**
 * Shared presentational primitives for the Quiet system — the small pieces that
 * recur across every view (avatars, keycaps, status glyphs, state pills). They
 * render the `q-` classes defined in theme.ts, so a view composes them instead
 * of re-deriving spacing/colour per surface.
 */

import type { ReactNode } from "react";
import { cn } from "./lib/cn";
import type { MockUser, FileStatus, ReviewerStatus } from "./mock";

export function Avatar({ user, size = 22 }: { user: MockUser; size?: number }) {
  return (
    <span
      className="q-avatar"
      style={{ width: size, height: size, background: user.color, fontSize: Math.round(size * 0.42) }}
      title={user.name}
      aria-hidden
    >
      {user.initials}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="q-kbd">{children}</kbd>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("q-eyebrow", className)}>{children}</span>;
}

const STATUS_GLYPH: Record<FileStatus, { glyph: string; label: string; cls: string }> = {
  added: { glyph: "A", label: "added", cls: "q-glyph-add" },
  modified: { glyph: "M", label: "modified", cls: "q-glyph-mod" },
  removed: { glyph: "D", label: "removed", cls: "q-glyph-del" },
  renamed: { glyph: "R", label: "renamed", cls: "q-glyph-ren" },
};

export function StatusGlyph({ status }: { status: FileStatus }) {
  const m = STATUS_GLYPH[status];
  return (
    <span className={cn("q-glyph", m.cls)} title={m.label} aria-label={m.label}>
      {m.glyph}
    </span>
  );
}

export function StatePill({ draft, state }: { draft?: boolean; state?: "open" | "closed" | "merged" }) {
  if (draft) {
    return (
      <span className="q-pill q-pill-draft">
        <span className="q-pill-dot" />
        Draft
      </span>
    );
  }
  if (state === "merged") {
    return <span className="q-pill q-pill-merged"><span className="q-pill-dot" />Merged</span>;
  }
  return (
    <span className="q-pill q-pill-open">
      <span className="q-pill-dot" />
      Open
    </span>
  );
}

const REVIEWER_META: Record<ReviewerStatus, { label: string; cls: string }> = {
  pending: { label: "Pending", cls: "q-pill-pending" },
  approved: { label: "Approved", cls: "q-pill-approved" },
  changes: { label: "Changes requested", cls: "q-pill-changes" },
  commented: { label: "Commented", cls: "q-pill-commented" },
};

export function ReviewerPill({ status }: { status: ReviewerStatus }) {
  const m = REVIEWER_META[status];
  return <span className={cn("q-pill", m.cls)}>{m.label}</span>;
}

/** Additions / deletions, mono, side by side — the same treatment everywhere. */
export function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="q-mono" style={{ fontSize: 11, display: "inline-flex", gap: 6 }}>
      <span className="q-add">+{additions}</span>
      <span className="q-del">−{deletions}</span>
    </span>
  );
}
