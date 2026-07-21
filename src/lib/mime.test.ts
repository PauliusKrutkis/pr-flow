import { describe, expect, it } from "vitest";
import { imageMimeFor, videoMimeFor } from "./mime.ts";

describe("imageMimeFor", () => {
  it("maps known image extensions", () => {
    expect(imageMimeFor("screenshot.PNG")).toBe("image/png");
    expect(imageMimeFor("/uploads/abc/photo.jpg")).toBe("image/jpeg");
  });

  it("returns null for unknown or video extensions", () => {
    expect(imageMimeFor("clip.mov")).toBeNull();
    expect(imageMimeFor("noext")).toBeNull();
  });
});

describe("videoMimeFor", () => {
  it("maps known video extensions", () => {
    expect(videoMimeFor("Screen Recording 11.26.07.MOV")).toBe(
      "video/quicktime"
    );
    expect(videoMimeFor("clip.webm")).toBe("video/webm");
  });

  it("returns null for image or unknown extensions", () => {
    expect(videoMimeFor("photo.png")).toBeNull();
    expect(videoMimeFor("noext")).toBeNull();
  });
});
