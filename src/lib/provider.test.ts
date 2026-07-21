import { describe, expect, it } from "vitest";
import { gitlabProjectBaseUrl, isGitlabPrUrl } from "./provider.ts";

describe("isGitlabPrUrl", () => {
  it("recognizes GitLab merge request URLs", () => {
    expect(
      isGitlabPrUrl(
        "https://lab.cyberbutis.io/decodo/applications/frontend/decodo-dashboard/-/merge_requests/1505"
      )
    ).toBe(true);
  });

  it("rejects GitHub PR URLs", () => {
    expect(isGitlabPrUrl("https://github.com/owner/repo/pull/123")).toBe(false);
  });
});

describe("gitlabProjectBaseUrl", () => {
  it("strips the merge_requests suffix, including nested subgroups", () => {
    expect(
      gitlabProjectBaseUrl(
        "https://lab.cyberbutis.io/decodo/applications/frontend/decodo-dashboard/-/merge_requests/1505"
      )
    ).toBe(
      "https://lab.cyberbutis.io/decodo/applications/frontend/decodo-dashboard"
    );
  });

  it("returns undefined for GitHub URLs", () => {
    expect(
      gitlabProjectBaseUrl("https://github.com/owner/repo/pull/123")
    ).toBeUndefined();
  });
});
