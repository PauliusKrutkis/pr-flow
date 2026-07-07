// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useRef } from "react";
import { cn } from "../../lib/cn.ts";

/**
 * Editor/browser-style find bar, floated over the diff's top-right corner
 * (mod+f). Deliberately NOT a modal: no scrim, no focus trap — the diff stays
 * fully interactive underneath, this is a lens on the text rather than a mode.
 *
 * Matching lives in lib/find-in-diff.ts and navigation state in ReviewScreen;
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

  const bindInputRef = (el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (el) {
      el.focus();
      el.select();
    }
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    onQueryChange(e.target.value);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (
      e.key === "Enter" ||
      e.key === "F3" ||
      (mod && e.key.toLowerCase() === "g")
    ) {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
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
  };

  if (!open) {
    return null;
  }

  const none = query.length > 0 && total === 0;

  return (
    <search aria-label="Find in diff" className="qf-findbar">
      <input
        aria-label="Find in diff"
        autoComplete="off"
        className="qf-findbar-input"
        key={focusSeq}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder="Find in diff"
        ref={bindInputRef}
        spellCheck={false}
        value={query}
      />
      <span
        aria-live="polite"
        className={cn("qf-findbar-count", none && "qf-findbar-none")}
      >
        {query.length > 0 ? `${current}/${total}` : ""}
      </span>
      <button
        aria-pressed={caseSensitive}
        className={cn("qf-findbar-btn", caseSensitive && "qf-findbar-btn-on")}
        onClick={onToggleCase}
        onMouseDown={keepFocus}
        title="Match case"
        type="button"
      >
        <CaseSensitive aria-hidden size={15} />
      </button>
      <span aria-hidden className="qf-findbar-sep" />
      <button
        aria-label="Previous match"
        className="qf-findbar-btn"
        disabled={total === 0}
        onClick={onPrev}
        onMouseDown={keepFocus}
        title="Previous match (Shift+Enter)"
        type="button"
      >
        <ChevronUp aria-hidden size={15} />
      </button>
      <button
        aria-label="Next match"
        className="qf-findbar-btn"
        disabled={total === 0}
        onClick={onNext}
        onMouseDown={keepFocus}
        title="Next match (Enter)"
        type="button"
      >
        <ChevronDown aria-hidden size={15} />
      </button>
      <button
        aria-label="Close find"
        className="qf-findbar-btn"
        onClick={onClose}
        onMouseDown={keepFocus}
        title="Close (Esc)"
        type="button"
      >
        <X aria-hidden size={15} />
      </button>
    </search>
  );
}
