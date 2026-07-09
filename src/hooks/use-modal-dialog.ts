import { useEffect, useRef } from "react";

/**
 * Open a native `<dialog>` modally on mount. There is no explicit close on
 * unmount: React removes the element from the DOM, which the browser treats as
 * closing it (and releases the top layer). Calling `dialog.close()` ourselves
 * would be worse than useless — its `close` event is dispatched on a queued
 * task, so under StrictMode's mount→unmount→remount it fires *after* the
 * remount and bounces back into `onClose`, closing the owner the instant it
 * opens.
 */
export function useModalDialog(onClose: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }
    if (!dialog.open) {
      dialog.showModal();
    }
  }, []);

  const onDialogClose = () => {
    onClose();
  };

  const onDialogCancel = (e: React.SyntheticEvent<HTMLDialogElement>) => {
    e.preventDefault();
    onClose();
  };

  return { dialogRef, onDialogCancel, onDialogClose };
}
