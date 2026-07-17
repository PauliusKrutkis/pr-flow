import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn.ts";
import { Kbd } from "./kbd.tsx";

const OPEN_DELAY_MS = 260;
const EDGE_GAP_PX = 8;

interface Coords {
  left: number;
  top: number;
}

/**
 * A hover/focus tooltip themed with the existing .q-tooltip tokens. Portals to
 * the body so it is never clipped by the virtualized diff scroller, positions
 * itself above the trigger and clamps to the viewport, and carries an optional
 * keyboard hint in the slot .q-tooltip already reserves. Opens on pointer and
 * on keyboard focus, closes on leave, blur, or Escape — the label is wired to
 * the child control with aria-describedby so it is announced, not just shown.
 * The trigger is held by an inline-flex wrapper span (measured for placement)
 * rather than cloned onto the child, so no ref threads through render.
 */
export function Tooltip({
  children,
  label,
  combo,
}: {
  children: ReactElement<{ "aria-describedby"?: string }>;
  label: string;
  combo?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);

  const cancelOpen = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };

  const show = (immediate: boolean) => {
    cancelOpen();
    if (immediate) {
      setOpen(true);
      return;
    }
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS);
  };

  const hide = () => {
    cancelOpen();
    setOpen(false);
  };

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!(trigger && tip)) {
      return;
    }
    const anchor = trigger.getBoundingClientRect();
    const tipRect = tip.getBoundingClientRect();
    const centered = anchor.left + anchor.width / 2 - tipRect.width / 2;
    const clampedLeft = Math.max(
      EDGE_GAP_PX,
      Math.min(centered, window.innerWidth - tipRect.width - EDGE_GAP_PX)
    );
    const above = anchor.top - tipRect.height - EDGE_GAP_PX;
    const top = above >= EDGE_GAP_PX ? above : anchor.bottom + EDGE_GAP_PX;
    setCoords({ left: clampedLeft, top });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const trigger = cloneElement(children, {
    "aria-describedby": open ? id : undefined,
  });

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: wrapper only mirrors hover/focus of its interactive child for positioning; the child stays the control. */}
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: wrapper only mirrors hover/focus of its interactive child for positioning; the child stays the control. */}
      <span
        className="q-tooltip-anchor"
        onBlur={hide}
        onFocus={() => show(true)}
        onPointerEnter={() => show(false)}
        onPointerLeave={hide}
        ref={triggerRef}
      >
        {trigger}
      </span>
      {open &&
        (createPortal(
          <div
            className={cn(
              "q-tooltip",
              coords ? undefined : "q-tooltip-measure"
            )}
            id={id}
            ref={tipRef}
            role="tooltip"
            style={
              coords
                ? { left: coords.left, position: "fixed", top: coords.top }
                : undefined
            }
          >
            {label}
            {combo ? <Kbd combo={combo} /> : null}
          </div>,
          document.body
        ) as ReactNode)}
    </>
  );
}
