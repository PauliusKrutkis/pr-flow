// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { useQuery } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import type { ChangedFile } from "../../types.ts";
import { Spinner } from "../ui/spinner.tsx";

/**
 * Before/after panes for binary image files, which have no textual patch.
 * Bytes come through the backend (the token never reaches the webview) as
 * base64 and render as data: URLs.
 */

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

function formatBytes(n: number): string {
  if (n < 1024) {
    return `${n} B`;
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ImagePane({
  label,
  tone,
  owner,
  repo,
  path,
  gitRef,
}: {
  label: string;
  tone: "old" | "new";
  owner: string;
  repo: string;
  path: string;
  gitRef: string;
}) {
  const { data, isLoading, isError, error } = useQuery({
    enabled: !!gitRef,
    queryFn: () => api.getFileBlob(owner, repo, path, gitRef),
    queryKey: ["fileBlob", owner, repo, path, gitRef],
    retry: 1,
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const mime = mimeFor(path) ?? "application/octet-stream";
  const blobKey = data?.base64 ?? "";

  const bindImgRef = useCallback((img: HTMLImageElement | null) => {
    imgRef.current = img;
    if (!img) {
      return;
    }
    setDims(null);
    const syncDims = () => {
      if (img.naturalWidth > 0) {
        setDims({ h: img.naturalHeight, w: img.naturalWidth });
      }
    };
    if (img.complete) {
      syncDims();
    } else {
      img.addEventListener("load", syncDims, { once: true });
    }
  }, []);

  const dimText = dims === null ? null : `${dims.w}×${dims.h}`;
  const sizeText = data === undefined ? null : formatBytes(data.size);
  const metaParts = [dimText, sizeText].filter(
    (part): part is string => part !== null
  );

  return (
    <figure className={`qf-img-pane qf-img-${tone}`}>
      <figcaption className="qf-img-cap">
        <span className="qf-img-label">{label}</span>
        <span className="qf-img-meta">
          {metaParts.length > 0 ? metaParts.join(" · ") : null}
        </span>
      </figcaption>
      <div className="qf-img-frame">
        {isLoading ? <Spinner label="Loading image…" /> : null}
        {isError ? (
          <span className="qf-img-err">
            Couldn't load this version. {String(error)}
          </span>
        ) : null}
        {gitRef ? null : (
          <span className="qf-img-err">No ref available for this side.</span>
        )}
        {data ? (
          <img
            alt={`${label}: ${path}`}
            height={dims?.h}
            key={blobKey}
            ref={bindImgRef}
            src={`data:${mime};base64,${data.base64}`}
            width={dims?.w}
          />
        ) : null}
      </div>
    </figure>
  );
}

export function ImageDiff({
  file,
  owner,
  repo,
  baseSha,
  headSha,
}: {
  file: ChangedFile;
  owner: string;
  repo: string;
  baseSha: string;
  headSha: string;
}) {
  const showOld = file.status !== "added";
  const showNew = file.status !== "removed";
  const oldPath = file.previousFilename ?? file.filename;

  return (
    <div className="qf-imgdiff">
      {!!showOld && (
        <ImagePane
          gitRef={baseSha}
          label={file.status === "removed" ? "Removed" : "Before"}
          owner={owner}
          path={oldPath}
          repo={repo}
          tone="old"
        />
      )}
      {!!showNew && (
        <ImagePane
          gitRef={headSha}
          label={file.status === "added" ? "Added" : "After"}
          owner={owner}
          path={file.filename}
          repo={repo}
          tone="new"
        />
      )}
    </div>
  );
}
