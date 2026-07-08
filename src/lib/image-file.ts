import type { ChangedFile } from "../types.ts";

const IMAGE_MIME: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

function mimeFor(path: string): string | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return IMAGE_MIME[ext] ?? null;
}

export function isImageFile(file: ChangedFile): boolean {
  return !file.patch && mimeFor(file.filename) !== null;
}
