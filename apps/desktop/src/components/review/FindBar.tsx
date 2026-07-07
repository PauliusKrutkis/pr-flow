import { useEffect, useRef } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Editor/browser-style find bar, floated over the diff's top-right corner
 * (mod+f). Deliberately NOT a modal: no scrim, no focus trap — the diff stays
 * fully interactive underneath, this is a lens on the text rather than a mode.
 *
 * Matching lives in lib/findInDiff.ts and navigation state in ReviewScreen;
 * this component only owns the input and its keys. The global key dispatcher
 * ignores non-modifier keys inside editable targets, so Enter / arrows / Esc
 * are handled right here while the input is focused.
 */
/**
 * Buttons don't steal focus from the input (onMouseDown preventDefault), so
 * clicking a chevron then pressing Enter keeps stepping through matches.
 */

const keepFocus = (e: React.MouseEvent) => e.preventDefault();

export function FindBar({
  open,
  query,
  caseSensitive,
  current,
  total,
  focusSeq,
  onQueryChange,
  onToggleCase,
  onNext,
  onPrev,
  onClose,
}: {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  current: number;
  total: number;
  focusSeq: number;
  onQueryChange: (q: string) => void;
  onToggleCase: () => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, focusSeq]);

  if (!open) return null;

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" || e.key === "F3" || (mod && e.key.toLowerCase() === "g")) {
      e.preventDefault();
      if (e.shiftKey) onPrev();
      else onNext();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      onNext();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onPrev();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.currentTarget.select();
    }
  }

  const none = query.length > 0 && total === 0;

  return (
    <search className="qf-findbar" aria-label="Find in diff">
      <input
        ref={inputRef}
        className="qf-findbar-input"
        placeholder="Find in diff"
        aria-label="Find in diff"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onKeyDown}
        autoComplete="off"
        spellCheck={false}
      />
      <span
        className={cn("qf-findbar-count", none && "qf-findbar-none")}
        aria-live="polite"
      >
        {query.length > 0 ? `${current}/${total}` : ""}
      </span>
      <button
        type="button"
        className={cn("qf-findbar-btn", caseSensitive && "qf-findbar-btn-on")}
        onMouseDown={keepFocus}
        onClick={onToggleCase}
        aria-pressed={caseSensitive}
        title="Match case"
      >
        <CaseSensitive size={15} aria-hidden />
      </button>
      <span className="qf-findbar-sep" aria-hidden />
      <button
        type="button"
        className="qf-findbar-btn"
        onMouseDown={keepFocus}
        onClick={onPrev}
        disabled={total === 0}
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <ChevronUp size={15} aria-hidden />
      </button>
      <button
        type="button"
        className="qf-findbar-btn"
        onMouseDown={keepFocus}
        onClick={onNext}
        disabled={total === 0}
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <ChevronDown size={15} aria-hidden />
      </button>
      <button
        type="button"
        className="qf-findbar-btn"
        onMouseDown={keepFocus}
        onClick={onClose}
        title="Close (Esc)"
        aria-label="Close find"
      >
        <X size={15} aria-hidden />
      </button>
    </search>
  );
}
