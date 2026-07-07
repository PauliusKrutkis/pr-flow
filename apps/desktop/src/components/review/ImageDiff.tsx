import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api.ts";
import type { ChangedFile } from "../../types.ts";
import { Spinner } from "../ui/Spinner.tsx";

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

  const mime = mimeFor(path) ?? "application/octet-stream";

  return (
    <figure className={`qf-img-pane qf-img-${tone}`}>
      <figcaption className="qf-img-cap">
        <span className="qf-img-label">{label}</span>
        <span className="qf-img-meta">
          {dims && `${dims.w}×${dims.h}`}
          {dims && data && " · "}
          {data && formatBytes(data.size)}
        </span>
      </figcaption>
      <div className="qf-img-frame">
        {isLoading && <Spinner label="Loading image…" />}
        {isError && (
          <span className="qf-img-err">
            Couldn't load this version. {String(error)}
          </span>
        )}
        {!gitRef && (
          <span className="qf-img-err">No ref available for this side.</span>
        )}
        {data && (
          <img
            alt={`${label}: ${path}`}
            onLoad={(e) =>
              setDims({
                h: e.currentTarget.naturalHeight,
                w: e.currentTarget.naturalWidth,
              })
            }
            src={`data:${mime};base64,${data.base64}`}
          />
        )}
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
      {showOld && (
        <ImagePane
          gitRef={baseSha}
          label={file.status === "removed" ? "Removed" : "Before"}
          owner={owner}
          path={oldPath}
          repo={repo}
          tone="old"
        />
      )}
      {showNew && (
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
