import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInbox } from "../hooks/useInbox.ts";
import { useAppStore } from "../store/appStore.ts";
import { type PullRequest, prKey } from "../types.ts";
import { Avatar } from "./ui/Avatar.tsx";
import { Kbd } from "./ui/Kbd.tsx";

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
  if (raw == null) {
    return null; // null = never seeded (first ever run)
  }
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v)
      ? new Set(v.filter((x) => typeof x === "string"))
      : new Set();
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
  prKey({ name: pr.name, number: pr.number, owner: pr.owner });

export function ReviewNotifier() {
  const { data } = useInbox();
  const [toast, setToast] = useState<{ pr: PullRequest; extra: number } | null>(
    null
  );
  const cardRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const stored = useRef<Set<string> | null | undefined>(undefined);
  if (stored.current === undefined) {
    stored.current = loadKnown();
  }

  useEffect(() => {
    if (!data) {
      return;
    }
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
    if (fresh.length === 0) {
      return;
    }

    const route = useAppStore.getState().route;
    const candidates = fresh.filter(
      (pr) =>
        !(
          route.name === "review" &&
          route.owner === pr.owner &&
          route.repo === pr.name &&
          route.number === pr.number
        )
    );
    if (candidates.length === 0) {
      return;
    }
    setToast({
      extra: candidates.length - 1,
      pr: candidates[candidates.length - 1],
    });
  }, [data]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const t = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const active = document.activeElement;
    const typing =
      active instanceof HTMLElement &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.isContentEditable);
    if (typing) {
      return;
    }
    prevFocusRef.current = active instanceof HTMLElement ? active : null;
    cardRef.current?.focus();
    return () => {
      const prev = prevFocusRef.current;
      prevFocusRef.current = null;
      if (prev && prev.isConnected) {
        prev.focus();
      }
    };
  }, [toast]);

  if (!toast) {
    return null;
  }

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
      className="qb-toast"
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
      ref={cardRef}
      role="alert"
      tabIndex={-1}
    >
      <span aria-hidden className="qb-toast-rail" />
      <Avatar name={pr.author} size={30} url={pr.authorAvatarUrl} />
      <div className="qb-toast-body">
        <div className="qb-toast-head">
          <span className="qb-toast-title">New review request</span>
          <button
            aria-label="Dismiss"
            className="qb-x q-focus"
            onClick={dismiss}
            type="button"
          >
            <X aria-hidden size={13} />
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
          <button
            className="qb-toast-open q-focus"
            onClick={open}
            type="button"
          >
            Open <Kbd combo="enter" />
          </button>
          <button
            className="qb-toast-snooze q-focus"
            onClick={dismiss}
            type="button"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
