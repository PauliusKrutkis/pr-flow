import { describe, expect, it } from "vitest";
import {
  isGitlabPrUrl,
  parseGitlabUploadPath,
  stripImageAttributeLists,
} from "./provider.ts";

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

describe("stripImageAttributeLists", () => {
  it("strips a kramdown attribute list right after an image", () => {
    expect(
      stripImageAttributeLists(
        "![Screenshot before](/uploads/abc/x.png){width=885 height=600}"
      )
    ).toBe("![Screenshot before](/uploads/abc/x.png)");
  });

  it("strips one per image across multiple images", () => {
    const source =
      "![a](/uploads/1/a.png){width=10 height=20}\n\n" +
      "text in between\n\n" +
      "![b](/uploads/2/b.png){width=30 height=40}";
    expect(stripImageAttributeLists(source)).toBe(
      "![a](/uploads/1/a.png)\n\ntext in between\n\n![b](/uploads/2/b.png)"
    );
  });

  it("leaves markdown without an attribute list untouched", () => {
    const source = "![alt](/uploads/abc/x.png) and some {curly} text";
    expect(stripImageAttributeLists(source)).toBe(source);
  });
});
