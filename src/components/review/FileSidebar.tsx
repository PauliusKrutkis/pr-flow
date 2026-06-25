import { useMemo, useState } from "react";
import type { ChangedFile, FileStatus } from "../../types";
import { useAppStore } from "../../store/appStore";
import { cn } from "../../lib/cn";

interface FileSidebarProps {
  files: ChangedFile[];
  selectedIndex: number;
  onSelect: (i: number) => void;
  prKeyValue: string;
}

interface StatusGlyph {
  letter: string;
  className: string;
  title: string;
}

function statusGlyph(status: FileStatus): StatusGlyph {
  switch (status) {
    case "added":
      return { letter: "A", className: "text-success", title: "Added" };
    case "removed":
      return { letter: "D", className: "text-danger", title: "Removed" };
    case "renamed":
      return { letter: "R", className: "text-accent", title: "Renamed" };
    case "copied":
      return { letter: "C", className: "text-accent", title: "Copied" };
    default:
      return { letter: "M", className: "text-warning", title: "Modified" };
  }
}

function splitPath(filename: string): { dir: string; base: string } {
  const idx = filename.lastIndexOf("/");
  if (idx === -1) return { dir: "", base: filename };
  return { dir: filename.slice(0, idx + 1), base: filename.slice(idx + 1) };
}

export function FileSidebar({
  files,
  selectedIndex,
  onSelect,
  prKeyValue,
}: FileSidebarProps) {
  const [filter, setFilter] = useState("");
  // Subscribe to THIS PR's viewed list (not the stable method refs) so the
  // checkmarks and count re-render when a file is toggled viewed.
  const viewedFiles = useAppStore((s) => s.viewed[prKeyValue]);
  const viewedSet = useMemo(() => new Set(viewedFiles ?? []), [viewedFiles]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const indexed = files.map((file, index) => ({ file, index }));
    if (!q) return indexed;
    return indexed.filter(({ file }) =>
      file.filename.toLowerCase().includes(q),
    );
  }, [files, filter]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-fg">Files</span>
          <span className="text-xs text-muted">
            {viewedSet.size}/{files.length} viewed
          </span>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files…"
          className={cn(
            "mt-2 w-full rounded border border-line bg-bg px-2 py-1 text-xs",
            "text-fg placeholder:text-faint focus:border-accent focus:outline-none",
          )}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {filtered.map(({ file, index }) => {
          const glyph = statusGlyph(file.status);
          const { dir, base } = splitPath(file.filename);
          const selected = index === selectedIndex;
          const viewed = viewedSet.has(file.filename);
          return (
            <button
              key={file.filename}
              type="button"
              onClick={() => onSelect(index)}
              title={file.filename}
              className={cn(
                "flex w-full items-center gap-2 border-l-2 px-3 py-1.5 text-left",
                selected
                  ? "border-accent bg-surface-2"
                  : "border-transparent hover:bg-surface-2/60",
                viewed && !selected && "opacity-60",
              )}
            >
              <span
                className={cn("w-3 font-mono text-xs font-bold", glyph.className)}
                title={glyph.title}
              >
                {glyph.letter}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs">
                {dir && <span className="text-faint">{dir}</span>}
                <span className="font-medium text-fg">{base}</span>
              </span>
              <span className="shrink-0 font-mono text-[11px]">
                <span className="text-success">+{file.additions}</span>{" "}
                <span className="text-danger">−{file.deletions}</span>
              </span>
              <span className="w-3 shrink-0 text-center text-xs">
                {viewed ? (
                  <span className="text-success">✓</span>
                ) : (
                  <span className="text-faint">○</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
