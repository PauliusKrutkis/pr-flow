import { useEffect, useRef, useState } from "react";
import { useInbox } from "../hooks/useInbox";
import { useAppStore } from "../store/appStore";
import { prKey, type PullRequest } from "../types";

// In-app "new review requested" notification (backlog: stronger than link
// interception). Piggybacks on the existing 60s inbox poll — when a PR newly
// appears in the Review-requests bucket, a keyboard-dismissable toast pops:
// Enter opens it, Esc dismisses. No webhooks, no desktop-notification perms.

const KNOWN_KEY = "pr-flow:knownReviewRequested";
const AUTO_DISMISS_MS = 12_000;

function loadKnown(): Set<string> | null {
  const raw = localStorage.getItem(KNOWN_KEY);
  if (raw == null) return null; // null = never seeded (first ever run)
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? new Set(v.filter((x) => typeof x === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function saveKnown(keys: string[]) {
  try {
    localStorage.setItem(KNOWN_KEY, JSON.stringify(keys));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

const keyOf = (pr: PullRequest) =>
  prKey({ owner: pr.owner, name: pr.name, number: pr.number });

export function ReviewNotifier() {
  const { data } = useInbox();
  const [toast, setToast] = useState<{ pr: PullRequest; extra: number } | null>(
    null,
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  // Known review-requested keys. A null stored value means "never seeded", so
  // the first poll quietly records the existing backlog instead of announcing
  // every open request at once.
  const stored = useRef<Set<string> | null | undefined>(undefined);
  if (stored.current === undefined) stored.current = loadKnown();

  useEffect(() => {
    if (!data) return;
    const prs = data.reviewRequested.prs;
    const current = prs.map(keyOf);

    if (stored.current == null) {
      stored.current = new Set(current);
      saveKnown(current);
      return;
    }

    const known = stored.current;
    const fresh = prs.filter((pr) => !known.has(keyOf(pr)));
    stored.current = new Set(current);
    saveKnown(current);
    if (fresh.length === 0) return;

    // Don't announce a PR you're already looking at.
    const route = useAppStore.getState().route;
    const candidates = fresh.filter(
      (pr) =>
        !(
          route.name === "review" &&
          route.owner === pr.owner &&
          route.repo === pr.name &&
          route.number === pr.number
        ),
    );
    if (candidates.length === 0) return;
    setToast({ pr: candidates[candidates.length - 1], extra: candidates.length - 1 });
  }, [data]);

  // Auto-dismiss so the toast never lingers / steals focus indefinitely.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast]);

  // Take keyboard focus when shown (so Enter/Esc work) — but not if the user is
  // typing somewhere — and restore the prior focus when the toast goes away.
  useEffect(() => {
    if (!toast) return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable);
    if (typing) return;
    prevFocusRef.current = active instanceof HTMLElement ? active : null;
    cardRef.current?.focus();
    return () => {
      const prev = prevFocusRef.current;
      prevFocusRef.current = null;
      if (prev && prev.isConnected) prev.focus();
    };
  }, [toast]);

  if (!toast) return null;

  const { pr, extra } = toast;

  const open = () => {
    const store = useAppStore.getState();
    store.openReview(pr.owner, pr.name, pr.number);
    store.markSeen(keyOf(pr), pr.updatedAt);
    setToast(null);
  };
  const dismiss = () => setToast(null);

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80">
      <div
        ref={cardRef}
        tabIndex={-1}
        role="alert"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.stopPropagation();
            open();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            dismiss();
          }
        }}
        className="overflow-hidden rounded-card border border-line bg-surface shadow-2xl outline-none ring-1 ring-accent/30"
      >
        <div className="px-4 pt-3 text-xs font-medium text-accent">
          🔔 New review requested
        </div>
        <div className="px-4 pb-1 pt-1">
          <div className="truncate text-sm font-semibold text-fg" title={pr.title}>
            {pr.title}
          </div>
          <div className="truncate text-xs text-muted">
            {pr.repo} #{pr.number}
          </div>
          {extra > 0 && (
            <div className="mt-1 text-xs text-faint">
              +{extra} more review request{extra > 1 ? "s" : ""}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-3 pt-1 text-xs">
          <button
            type="button"
            onClick={dismiss}
            className="rounded px-2 py-1 text-muted hover:bg-elevated hover:text-fg"
          >
            Dismiss
            <span className="ml-1 text-faint">Esc</span>
          </button>
          <button
            type="button"
            onClick={open}
            className="rounded bg-accent/15 px-2 py-1 font-medium text-accent hover:bg-accent/25"
          >
            Open
            <span className="ml-1 opacity-70">↵</span>
          </button>
        </div>
      </div>
    </div>
  );
}
