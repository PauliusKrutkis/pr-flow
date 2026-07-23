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

const VIDEO_MIME: Record<string, string> = {
  mov: "video/quicktime",
  mp4: "video/mp4",
  ogv: "video/ogg",
  webm: "video/webm",
};

function extOf(path: string): string {
  return path.toLowerCase().split(".").pop() ?? "";
}

export function imageMimeFor(path: string): string | null {
  return IMAGE_MIME[extOf(path)] ?? null;
}

export function videoMimeFor(path: string): string | null {
  return VIDEO_MIME[extOf(path)] ?? null;
}
