import { describe, expect, it } from "vitest";
import { isGitlabPrUrl, parseGitlabUploadPath } from "./provider.ts";

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

describe("parseGitlabUploadPath", () => {
  it("extracts the secret and filename from a pasted-upload path", () => {
    expect(
      parseGitlabUploadPath(
        "/uploads/067e2eb6454010516f2b06f031c61ff3/image.png"
      )
    ).toEqual({
      filename: "image.png",
      secret: "067e2eb6454010516f2b06f031c61ff3",
    });
  });

  it("keeps dots in the filename intact", () => {
    expect(
      parseGitlabUploadPath("/uploads/abc123/Screen Recording 11.26.07.mov")
    ).toEqual({ filename: "Screen Recording 11.26.07.mov", secret: "abc123" });
  });

  it("returns undefined for absolute or unrelated srcs", () => {
    expect(
      parseGitlabUploadPath("https://github.com/user-attachments/x.png")
    ).toBeUndefined();
    expect(parseGitlabUploadPath("/avatar.png")).toBeUndefined();
    expect(parseGitlabUploadPath(undefined)).toBeUndefined();
  });
});
