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

import type { ChangedFile, ViewedFileMap, ViewedMap } from "../types.ts";

/**
 * Fingerprint of a legacy mark (persisted before fingerprints existed). It is
 * assumed still valid and upgraded to the real fingerprint on the next load of
 * that PR's detail — we never mass-unview a user's history on migration.
 * Real fingerprints are always prefixed ("p:", "s:", "h:"), so "?" can't
 * collide with one.
 */
export const UNKNOWN_FINGERPRINT = "?";

/** Fast string hash for change detection — collisions only mean a changed file
 *  stays marked viewed. */
function stringHash(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) % 4_294_967_296;
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
  headSha: string
): string {
  if (file.patch) {
    return `p:${stringHash(file.patch)}`;
  }
  if (file.sha) {
    return `s:${file.sha}`;
  }
  return `h:${headSha}`;
}

function migrateLegacyArray(value: unknown[]): ViewedFileMap {
  const entry: ViewedFileMap = {};
  for (const name of value) {
    if (typeof name === "string") {
      entry[name] = UNKNOWN_FINGERPRINT;
    }
  }
  return entry;
}

function migrateRecord(value: Record<string, unknown>): ViewedFileMap {
  const entry: ViewedFileMap = {};
  for (const [name, fp] of Object.entries(value)) {
    if (typeof fp === "string") {
      entry[name] = fp;
    }
  }
  return entry;
}

/**
 * Migrates whatever the storage layer returns into the current ViewedMap
 * shape. Handles, per PR entry:
 *  - legacy `string[]` of filenames  → each adopts UNKNOWN_FINGERPRINT
 *  - current `Record<file, fp>`      → kept (non-string values dropped)
 *  - anything else                   → dropped
 */
export function normalizeViewedMap(raw: unknown): ViewedMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: ViewedMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      out[key] = migrateLegacyArray(value);
    } else if (value && typeof value === "object") {
      out[key] = migrateRecord(value as Record<string, unknown>);
    }
  }
  return out;
}

export interface ReconcileResult {
  changed: boolean;
  entry: ViewedFileMap;
  unviewed: string[];
}

function reconcileOneMark(
  fp: string,
  file: Pick<ChangedFile, "patch" | "sha"> | undefined,
  headSha: string
): { changed: boolean; fp: string; unviewed: boolean } {
  if (!file) {
    return { changed: false, fp, unviewed: false };
  }
  const current = fingerprintFile(file, headSha);
  if (fp === current) {
    return { changed: false, fp, unviewed: false };
  }
  if (fp === UNKNOWN_FINGERPRINT) {
    return { changed: true, fp: current, unviewed: false };
  }
  return { changed: true, fp, unviewed: true };
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
  headSha: string
): ReconcileResult {
  if (!entry || Object.keys(entry).length === 0) {
    return { changed: false, entry: entry ?? {}, unviewed: [] };
  }
  const byName = new Map(files.map((f) => [f.filename, f]));
  const next: ViewedFileMap = {};
  const unviewed: string[] = [];
  let changed = false;
  for (const [name, fp] of Object.entries(entry)) {
    const result = reconcileOneMark(fp, byName.get(name), headSha);
    if (result.unviewed) {
      unviewed.push(name);
    }
    if (!result.unviewed) {
      next[name] = result.fp;
    }
    if (result.changed) {
      changed = true;
    }
  }
  return { changed, entry: next, unviewed };
}
