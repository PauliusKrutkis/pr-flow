import { describe, expect, it } from "vitest";
import type { ReleaseInfo } from "../types.ts";
import { compareVersions, releasesSince } from "./releases.ts";

function release(tag: string): ReleaseInfo {
  return { notes: `notes for ${tag}`, publishedAt: null, tag };
}

describe("compareVersions", () => {
  it("orders numerically, not lexically", () => {
    expect(compareVersions("1.10.0", "1.9.3")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.11.0")).toBeLessThan(0);
  });

  it("ignores a leading v and missing parts", () => {
    expect(compareVersions("v1.4.0", "1.4.0")).toBe(0);
    expect(compareVersions("1.4", "1.4.0")).toBe(0);
    expect(compareVersions("v2", "1.9.9")).toBeGreaterThan(0);
  });
});

describe("releasesSince", () => {
  const releases = ["v1.5.0", "v1.2.0", "v1.4.0", "v1.3.0"].map(release);

  it("returns skipped releases too, newest first", () => {
    const tags = releasesSince(releases, "1.2.0", "1.4.0").map((r) => r.tag);
    expect(tags).toEqual(["v1.4.0", "v1.3.0"]);
  });

  it("excludes the last-run version and anything past the running one", () => {
    const tags = releasesSince(releases, "1.4.0", "1.5.0").map((r) => r.tag);
    expect(tags).toEqual(["v1.5.0"]);
  });

  it("is empty when nothing shipped in between", () => {
    expect(releasesSince(releases, "1.5.0", "1.5.0")).toEqual([]);
  });
});
