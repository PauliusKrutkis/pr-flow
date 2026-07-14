import { useEffect, useRef } from "react";
import { useLatest } from "./use-latest.ts";

/**
 * Open a native `<dialog>` modally on mount and close it when the backdrop is
 * clicked. Backdrop clicks are drag-safe: the pointer must go down *and* up on
 * the dialog element itself (its ::backdrop), so a text selection that drags
 * out of the panel never dismisses it. There is no explicit close on unmount:
 * React removes the element from the DOM, which the browser treats as closing
 * it (and releases the top layer). Calling `dialog.close()` ourselves would be
 * worse than useless — its `close` event is dispatched on a queued task, so
 * under StrictMode's mount→unmount→remount it fires *after* the remount and
 * bounces back into `onClose`, closing the owner the instant it opens.
 */
export function useModalDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useLatest(onClose);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }

    let downOnBackdrop = false;
    const onPointerDown = (e: PointerEvent) => {
      downOnBackdrop = e.target === dialog;
    };
    const onClick = (e: MouseEvent) => {
      if (downOnBackdrop && e.target === dialog) {
        onCloseRef.current();
      }
      downOnBackdrop = false;
    };
    dialog.addEventListener("pointerdown", onPointerDown);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("pointerdown", onPointerDown);
      dialog.removeEventListener("click", onClick);
    };
  }, [onCloseRef]);

  const onDialogClose = () => {
    onClose();
  };

  const onDialogCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };

  return { dialogRef, onDialogCancel, onDialogClose };
}
