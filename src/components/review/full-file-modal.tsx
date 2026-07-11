import { useQuery } from "@tanstack/react-query";
import { Virtuoso } from "react-virtuoso";
import { useModalDialog } from "../../hooks/use-modal-dialog.ts";
import { useHotkeys } from "../../keyboard/use-hotkeys.ts";
import { api } from "../../lib/api.ts";
import { highlightLine } from "../../lib/highlight.ts";
import type { FileBlob } from "../../types.ts";
import { Spinner } from "../ui/spinner.tsx";

// Beyond this the read-only preview isn't worth the render cost; the diff and
// GitHub are better tools for a file that big.
const MAX_VIEW_BYTES = 2_000_000;

function decodeBase64(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

type FileView =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "too-large"; kb: number }
  | { kind: "binary" }
  | { kind: "text"; lines: string[] };

function fileView(
  blob: FileBlob | undefined,
  isLoading: boolean,
  isError: boolean
): FileView {
  if (isLoading) {
    return { kind: "loading" };
  }
  if (isError || !blob) {
    return { kind: "error" };
  }
  if (blob.size > MAX_VIEW_BYTES) {
    return { kind: "too-large", kb: Math.round(blob.size / 1024) };
  }
  const text = decodeBase64(blob.base64);
  if (text.includes("\u0000")) {
    return { kind: "binary" };
  }
  return { kind: "text", lines: text.split("\n") };
}

interface Props {
  onClose: () => void;
  owner: string;
  path: string;
  repo: string;
  sha: string;
}

/**
 * Read-only full-file view (`shift+v`): the active file's complete contents at
 * head sha, syntax-highlighted and virtualized, for when the diff hunks don't
 * give enough context. Esc closes.
 */
export function FullFileModal({ owner, repo, path, sha, onClose }: Props) {
  const { dialogRef, onDialogCancel, onDialogClose } = useModalDialog(onClose);
  useHotkeys(
    "fileview",
    [{ description: "Close", hidden: true, keys: "esc", run: onClose }],
    { enabled: true }
  );

  const { data, isLoading, isError } = useQuery({
    queryFn: () => api.getFileBlob(owner, repo, path, sha),
    queryKey: ["fileBlob", owner, repo, path, sha],
  });
  const view = fileView(data, isLoading, isError);

  return (
    <dialog
      aria-label={`File: ${path}`}
      className="q-dialog qf-fileview"
      onCancel={onDialogCancel}
      onClose={onDialogClose}
      ref={dialogRef}
    >
      <div className="qf-fileview-head">
        <span className="qf-fileview-path" title={path}>
          {path}
        </span>
        <button
          aria-label="Close"
          className="qf-fileview-close qf-focusable"
          onClick={onClose}
          title="Close (Esc)"
          type="button"
        >
          Esc
        </button>
      </div>
      <div className="qf-fileview-body">
        {view.kind === "loading" && <Spinner label="Loading file…" />}
        {view.kind === "error" && (
          <p className="qf-fileview-msg">Couldn't load this file.</p>
        )}
        {view.kind === "too-large" && (
          <p className="qf-fileview-msg">
            This file is too large to preview ({view.kb} KB).
          </p>
        )}
        {view.kind === "binary" && (
          <p className="qf-fileview-msg">Binary file — no text preview.</p>
        )}
        {view.kind === "text" && (
          <FileLines filename={path} lines={view.lines} />
        )}
      </div>
    </dialog>
  );
}

function FileLines({ lines, filename }: { lines: string[]; filename: string }) {
  return (
    <Virtuoso
      className="qf-fileview-scroll"
      data={lines}
      itemContent={(i, line) => (
        <div className="qf-fileview-row">
          <span className="qf-fileview-num">{i + 1}</span>
          <code
            className="qf-fileview-code hljs"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: highlightLine escapes its input (same guarantee the diff rows rely on)
            dangerouslySetInnerHTML={{
              __html: highlightLine(line, filename) || "​",
            }}
          />
        </div>
      )}
      style={{ height: "100%" }}
    />
  );
}
