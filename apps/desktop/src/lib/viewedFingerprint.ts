/**
 * Content fingerprints for "viewed" file marks.
 *
 * A viewed mark belongs to the content you actually looked at. We stamp each
 * mark with a cheap fingerprint of the file's diff; when the PR's head moves
 * and the file's diff no longer matches, the mark is dropped automatically
 * (see reconcileViewedEntry) instead of silently vouching for code you never
 * saw.
 *
 * All functions here are pure — the store and ReviewScreen call them, and the
 * vitest suite exercises them without touching localStorage or Tauri.
 */

import type { ChangedFile, ViewedFileMap, ViewedMap } from "../types";

/**
 * Fingerprint of a legacy mark (persisted before fingerprints existed). It is
 * assumed still valid and upgraded to the real fingerprint on the next load of
 * that PR's detail — we never mass-unview a user's history on migration.
 * Real fingerprints are always prefixed ("p:", "s:", "h:"), so "?" can't
 * collide with one.
 */
export const UNKNOWN_FINGERPRINT = "?";

/** FNV-1a 32-bit over a string, as lowercase hex. Fast and plenty for change
 *  detection — a collision only means a changed file stays marked viewed. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * The fingerprint of a changed file as it appears in the current PR detail.
 * Prefers the patch text (what the reviewer actually reads); binary / huge
 * files without a patch fall back to the blob sha, and, failing that, the PR
 * head sha (any push then conservatively counts as a change).
 */
export function fingerprintFile(
  file: Pick<ChangedFile, "patch" | "sha">,
  headSha: string,
): string {
  if (file.patch) return `p:${fnv1a(file.patch)}`;
  if (file.sha) return `s:${file.sha}`;
  return `h:${headSha}`;
}

/**
 * Migrates whatever the storage layer returns into the current ViewedMap
 * shape. Handles, per PR entry:
 *  - legacy `string[]` of filenames  → each adopts UNKNOWN_FINGERPRINT
 *  - current `Record<file, fp>`      → kept (non-string values dropped)
 *  - anything else                   → dropped
 */
export function normalizeViewedMap(raw: unknown): ViewedMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ViewedMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      const entry: ViewedFileMap = {};
      for (const name of value) {
        if (typeof name === "string") entry[name] = UNKNOWN_FINGERPRINT;
      }
      out[key] = entry;
    } else if (value && typeof value === "object") {
      const entry: ViewedFileMap = {};
      for (const [name, fp] of Object.entries(value as Record<string, unknown>)) {
        if (typeof fp === "string") entry[name] = fp;
      }
      out[key] = entry;
    }
  }
  return out;
}

export interface ReconcileResult {
  entry: ViewedFileMap;
  unviewed: string[];
  changed: boolean;
}

/**
 * Reconciles one PR's viewed marks against its current file list:
 *  - marks matching the current fingerprint are kept
 *  - UNKNOWN (migrated) marks silently adopt the current fingerprint
 *  - mismatches are dropped and reported in `unviewed`
 *  - marks for files no longer in the diff are kept untouched (nothing to
 *    compare against, and they don't render anywhere)
 */
export function reconcileViewedEntry(
  entry: ViewedFileMap | undefined,
  files: readonly Pick<ChangedFile, "filename" | "patch" | "sha">[],
  headSha: string,
): ReconcileResult {
  if (!entry || Object.keys(entry).length === 0) {
    return { entry: entry ?? {}, unviewed: [], changed: false };
  }
  const byName = new Map(files.map((f) => [f.filename, f]));
  const next: ViewedFileMap = {};
  const unviewed: string[] = [];
  let changed = false;
  for (const [name, fp] of Object.entries(entry)) {
    const file = byName.get(name);
    if (!file) {
      next[name] = fp;
      continue;
    }
    const current = fingerprintFile(file, headSha);
    if (fp === current) {
      next[name] = fp;
    } else if (fp === UNKNOWN_FINGERPRINT) {
      next[name] = current; // migrated mark: assume valid, start tracking
      changed = true;
    } else {
      unviewed.push(name);
      changed = true;
    }
  }
  return { entry: next, unviewed, changed };
}
