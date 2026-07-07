// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import type { StateSnapshot } from "react-virtuoso";

/**
 * Per-PR review memory — the "resume where you left off" substrate.
 *
 * For each PR we remember the file you were on, your scroll position within it,
 * and the head commit SHA you last saw. This lets the app reopen exactly where
 * you left a review, and lets the review screen tell you when a PR changed since
 * you last looked. Stored in localStorage (local-only, like the unread map) and
 * written debounced so frequent scroll updates stay cheap.
 */

export interface ReviewMemory {
  fileIndex: number;
  headSha: string;
  listState?: StateSnapshot;
  scrollTop: number;
  sectionOffset?: number;
  topRow?: { fileIndex: number; anchor: string; top: number };
}

const KEY = "pr-flow:reviewMemory";
const WRITE_DELAY = 400;

function loadAll(): Record<string, ReviewMemory> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

const cache: Record<string, ReviewMemory> = loadAll();
let timer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function schedule() {
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(flush, WRITE_DELAY);
}

export function getReviewMemory(prKey: string): ReviewMemory | undefined {
  return cache[prKey];
}

export function updateReviewMemory(
  prKey: string,
  patch: Partial<ReviewMemory>
) {
  const prev = cache[prKey] ?? { fileIndex: 0, headSha: "", scrollTop: 0 };
  cache[prKey] = { ...prev, ...patch };
  schedule();
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", flush);
}
