import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useInbox } from "../hooks/useInbox";
import { useAppStore } from "../store/appStore";
import { prKey, type PullRequest } from "../types";
import { Avatar } from "./ui/Avatar";
import { Kbd } from "./ui/Kbd";

/**
 * In-app "new review requested" notification (backlog: stronger than link
 * interception). Piggybacks on the existing 60s inbox poll — when a PR newly
 * appears in the Review-requests bucket, a keyboard-dismissable toast pops:
 * Enter opens it, Esc dismisses. No webhooks, no desktop-notification perms.
 */

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

  /**
   * Known review-requested keys. A null stored value means "never seeded", so
   * the first poll quietly records the existing backlog instead of announcing
   * every open request at once.
   */

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

    /** Don't announce a PR you're already looking at. */

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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast]);

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
        className="qb-toast"
      >
        <span className="qb-toast-rail" aria-hidden />
        <Avatar url={pr.authorAvatarUrl} name={pr.author} size={30} />
        <div className="qb-toast-body">
          <div className="qb-toast-head">
            <span className="qb-toast-title">New review request</span>
            <button
              type="button"
              onClick={dismiss}
              className="qb-x q-focus"
              aria-label="Dismiss"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
          <p className="qb-toast-text">
            <b>{pr.author}</b> asked you to review{" "}
            <span className="q-mono qb-toast-num">#{pr.number}</span>
          </p>
          <p className="qb-toast-sub" title={pr.title}>
            {pr.title}
          </p>
          {extra > 0 && (
            <p className="qb-toast-sub">
              +{extra} more review request{extra > 1 ? "s" : ""}
            </p>
          )}
          <div className="qb-toast-actions">
            <button type="button" onClick={open} className="qb-toast-open q-focus">
              Open <Kbd combo="enter" />
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="qb-toast-snooze q-focus"
            >
              Dismiss
            </button>
          </div>
        </div>
      </div>
  );
}
