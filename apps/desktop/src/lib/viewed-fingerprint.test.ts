// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { describe, expect, it } from "vitest";
import {
  fingerprintFile,
  normalizeViewedMap,
  reconcileViewedEntry,
  UNKNOWN_FINGERPRINT,
} from "./viewed-fingerprint.ts";

const HEAD = "headsha";

describe("fingerprintFile", () => {
  it("is stable for identical patches and differs when the patch changes", () => {
    const a = fingerprintFile(
      { patch: "@@ -1 +1 @@\n-x\n+y", sha: "s1" },
      HEAD
    );
    const b = fingerprintFile(
      { patch: "@@ -1 +1 @@\n-x\n+y", sha: "s2" },
      "other"
    );
    const c = fingerprintFile(
      { patch: "@@ -1 +1 @@\n-x\n+z", sha: "s1" },
      HEAD
    );
    expect(a).toBe(b); // patch wins — sha/head don't leak into it
    expect(a).not.toBe(c);
    expect(a.startsWith("p:")).toBe(true);
  });

  it("falls back to the blob sha when there is no patch (binary files)", () => {
    expect(fingerprintFile({ patch: null, sha: "abc123" }, HEAD)).toBe(
      "s:abc123"
    );
    expect(fingerprintFile({ sha: "abc123" }, HEAD)).toBe("s:abc123");
  });

  it("falls back to the head sha when there is neither patch nor sha", () => {
    expect(fingerprintFile({ patch: undefined, sha: "" }, HEAD)).toBe(
      `h:${HEAD}`
    );
  });

  it("never produces the UNKNOWN sentinel", () => {
    expect(fingerprintFile({ patch: "?", sha: "?" }, "?")).not.toBe(
      UNKNOWN_FINGERPRINT
    );
  });
});

describe("normalizeViewedMap (migration)", () => {
  it("upgrades legacy filename arrays to unknown-fingerprint records", () => {
    expect(normalizeViewedMap({ "o/r#1": ["a.ts", "b.ts"] })).toEqual({
      "o/r#1": { "a.ts": UNKNOWN_FINGERPRINT, "b.ts": UNKNOWN_FINGERPRINT },
    });
  });

  it("passes current-shape entries through", () => {
    const map = { "o/r#1": { "a.ts": "p:12345678" } };
    expect(normalizeViewedMap(map)).toEqual(map);
  });

  it("handles mixed legacy and current entries in one map", () => {
    expect(
      normalizeViewedMap({
        "o/r#1": ["a.ts"],
        "o/r#2": { "b.ts": "s:abc" },
      })
    ).toEqual({
      "o/r#1": { "a.ts": UNKNOWN_FINGERPRINT },
      "o/r#2": { "b.ts": "s:abc" },
    });
  });

  it("drops garbage without throwing", () => {
    expect(normalizeViewedMap(null)).toEqual({});
    expect(normalizeViewedMap(undefined)).toEqual({});
    expect(normalizeViewedMap("nope")).toEqual({});
    expect(normalizeViewedMap([1, 2])).toEqual({});
    expect(
      normalizeViewedMap({
        alsoBad: { "a.ts": 9 },
        bad: 42,
        good: ["a.ts", 7, null],
      })
    ).toEqual({ alsoBad: {}, good: { "a.ts": UNKNOWN_FINGERPRINT } });
  });
});

describe("reconcileViewedEntry", () => {
  const fileA = { filename: "a.ts", patch: "patch-a", sha: "sa" };
  const fileB = { filename: "b.ts", patch: "patch-b", sha: "sb" };
  const fpA = fingerprintFile(fileA, HEAD);
  const fpB = fingerprintFile(fileB, HEAD);

  it("is a no-op when every mark matches", () => {
    const res = reconcileViewedEntry(
      { "a.ts": fpA, "b.ts": fpB },
      [fileA, fileB],
      HEAD
    );
    expect(res.changed).toBe(false);
    expect(res.unviewed).toEqual([]);
    expect(res.entry).toEqual({ "a.ts": fpA, "b.ts": fpB });
  });

  it("unviews files whose content changed", () => {
    const changedA = { ...fileA, patch: "patch-a-v2" };
    const res = reconcileViewedEntry(
      { "a.ts": fpA, "b.ts": fpB },
      [changedA, fileB],
      "headsha2"
    );
    expect(res.changed).toBe(true);
    expect(res.unviewed).toEqual(["a.ts"]);
    expect(res.entry).toEqual({ "b.ts": fpB });
  });

  it("silently upgrades migrated UNKNOWN marks instead of unviewing them", () => {
    const res = reconcileViewedEntry(
      { "a.ts": UNKNOWN_FINGERPRINT },
      [fileA],
      HEAD
    );
    expect(res.changed).toBe(true); // the upgrade must persist
    expect(res.unviewed).toEqual([]);
    expect(res.entry).toEqual({ "a.ts": fpA });
  });

  it("leaves marks for files no longer in the diff untouched", () => {
    const res = reconcileViewedEntry({ "gone.ts": "p:dead" }, [fileA], HEAD);
    expect(res.changed).toBe(false);
    expect(res.unviewed).toEqual([]);
    expect(res.entry).toEqual({ "gone.ts": "p:dead" });
  });

  it("handles empty / missing entries", () => {
    expect(reconcileViewedEntry(undefined, [fileA], HEAD)).toEqual({
      changed: false,
      entry: {},
      unviewed: [],
    });
    expect(reconcileViewedEntry({}, [fileA], HEAD).changed).toBe(false);
  });

  it("a binary file (sha fallback) unviews when its blob sha moves", () => {
    const bin = { filename: "img.png", patch: null, sha: "v1" };
    const fp = fingerprintFile(bin, HEAD);
    const res = reconcileViewedEntry(
      { "img.png": fp },
      [{ ...bin, sha: "v2" }],
      HEAD
    );
    expect(res.unviewed).toEqual(["img.png"]);
  });
});
