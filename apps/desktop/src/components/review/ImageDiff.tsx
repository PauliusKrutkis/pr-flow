import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ChangedFile } from "../../types";
import { api } from "../../lib/api";
import { Spinner } from "../ui/Spinner";

/**
 * Before/after panes for binary image files, which have no textual patch.
 * Bytes come through the backend (the token never reaches the webview) as
 * base64 and render as data: URLs.
 */

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  ico: "image/x-icon",
  svg: "image/svg+xml",
};

function mimeFor(path: string): string | null {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return IMAGE_MIME[ext] ?? null;
}

export function isImageFile(file: ChangedFile): boolean {
  return !file.patch && mimeFor(file.filename) !== null;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
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
    queryKey: ["fileBlob", owner, repo, path, gitRef],
    queryFn: () => api.getFileBlob(owner, repo, path, gitRef),
    staleTime: Infinity,
    retry: 1,
    enabled: !!gitRef,
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
            src={`data:${mime};base64,${data.base64}`}
            alt={`${label}: ${path}`}
            onLoad={(e) =>
              setDims({
                w: e.currentTarget.naturalWidth,
                h: e.currentTarget.naturalHeight,
              })
            }
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
          label={file.status === "removed" ? "Removed" : "Before"}
          tone="old"
          owner={owner}
          repo={repo}
          path={oldPath}
          gitRef={baseSha}
        />
      )}
      {showNew && (
        <ImagePane
          label={file.status === "added" ? "Added" : "After"}
          tone="new"
          owner={owner}
          repo={repo}
          path={file.filename}
          gitRef={headSha}
        />
      )}
    </div>
  );
}
