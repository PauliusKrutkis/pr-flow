import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useInbox } from "../hooks/use-inbox.ts";
import { useHotkeys } from "../keyboard/use-hotkeys.ts";
import { useAppStore } from "../store/app-store.ts";
import { type PullRequest, prKey } from "../types.ts";
import { Avatar } from "./ui/avatar.tsx";
import { Kbd } from "./ui/kbd.tsx";

/**
 * In-app "new review requested" notification (backlog: stronger than link
 * interception). Piggybacks on the existing 60s inbox poll — when a PR newly
 * appears in the Review-requests bucket, a keyboard-dismissable toast pops:
 * Enter opens it, Esc dismisses. No webhooks, no desktop-notification perms.
 */

const KNOWN_KEY = "pr-flow:knownReviewRequested:v1";
const LEGACY_KNOWN_KEY = "pr-flow:knownReviewRequested";
const AUTO_DISMISS_MS = 12_000;

function loadKnown(): Set<string> | null {
  let raw = localStorage.getItem(KNOWN_KEY);
  if (raw === null) {
    raw = localStorage.getItem(LEGACY_KNOWN_KEY);
    if (raw !== null) {
      try {
        localStorage.setItem(KNOWN_KEY, raw);
        localStorage.removeItem(LEGACY_KNOWN_KEY);
      } catch {
        /* ignore quota / private-mode errors */
      }
    }
  }
  if (raw === null) {
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

const keyOf = (item: PullRequest) =>
  prKey({ name: item.name, number: item.number, owner: item.owner });

export function ReviewNotifier() {
  const { data } = useInbox();
  const [toast, setToast] = useState<{ pr: PullRequest; extra: number } | null>(
    null
  );
  const cardRef = useRef<HTMLDialogElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const stored = useRef<Set<string> | null | undefined>(undefined);
  if (stored.current === undefined) {
    stored.current = loadKnown();
  }

  useEffect(() => {
    if (!data) {
      return;
    }
    const { prs } = data.reviewRequested;
    const current = prs.map(keyOf);

    if (stored.current === null) {
      stored.current = new Set(current);
      saveKnown(current);
      return;
    }

    const known = stored.current;
    if (known === undefined) {
      return;
    }
    const fresh = prs.filter((item) => !known.has(keyOf(item)));
    stored.current = new Set(current);
    saveKnown(current);
    if (fresh.length === 0) {
      return;
    }

    const { route } = useAppStore.getState();
    const candidates = fresh.filter(
      (item) =>
        !(
          route.name === "review" &&
          route.owner === item.owner &&
          route.repo === item.name &&
          route.number === item.number
        )
    );
    if (candidates.length === 0) {
      return;
    }
    const latest = candidates.at(-1);
    if (!latest) {
      return;
    }
    setToast({
      extra: candidates.length - 1,
      pr: latest,
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
      if (prev?.isConnected) {
        prev.focus();
      }
    };
  }, [toast]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const card = cardRef.current;
    card?.show();
    return () => {
      card?.close();
    };
  }, [toast]);

  const dismiss = () => {
    setToast(null);
  };

  const open = () => {
    setToast((current) => {
      if (!current) {
        return null;
      }
      const { pr: reviewPr } = current;
      const store = useAppStore.getState();
      store.openReview(reviewPr.owner, reviewPr.name, reviewPr.number);
      store.markSeen(keyOf(reviewPr), reviewPr.updatedAt);
      return null;
    });
  };

  useHotkeys(
    "review-notifier",
    [
      {
        description: "Open review",
        hidden: true,
        keys: "enter",
        run: open,
      },
      {
        description: "Dismiss",
        hidden: true,
        keys: "esc",
        run: dismiss,
      },
    ],
    { enabled: !!toast }
  );

  if (!toast) {
    return null;
  }

  const { pr, extra } = toast;

  return (
    <dialog
      aria-labelledby="review-notifier-title"
      className="qb-toast"
      onClose={dismiss}
      ref={cardRef}
      tabIndex={-1}
    >
      <span aria-hidden className="qb-toast-rail" />
      <Avatar name={pr.author} size={30} url={pr.authorAvatarUrl} />
      <div className="qb-toast-body">
        <div className="qb-toast-head">
          <span className="qb-toast-title" id="review-notifier-title">
            New review request
          </span>
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
        {extra > 0 ? (
          <p className="qb-toast-sub">
            +{extra} more review request{extra > 1 ? "s" : ""}
          </p>
        ) : null}
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
    </dialog>
  );
}
