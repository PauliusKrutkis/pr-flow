/**
 * shadcn-style Dialog — Radix primitives for the accessibility floor (focus
 * trap, ESC-to-close, aria-modal, scroll lock, portal), themed by the Quiet
 * system rather than shadcn's default slate palette. The command palette, help
 * overlay, and submit modal all compose these.
 *
 * Tokens live on :root (see theme.ts) so portalled content — which renders on
 * document.body, outside the .dir-quiet root — still reads var(--accent) etc.
 */

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { forwardRef } from "react";
import { cn } from "../lib/cn";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogOverlay = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay ref={ref} className={cn("q-overlay", className)} {...props} />
));
DialogOverlay.displayName = "DialogOverlay";

/** `variant` picks the on-screen anchor: centered card vs. top-anchored palette. */
export const DialogContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    variant?: "center" | "top";
  }
>(({ className, children, variant = "center", ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn("q-dialog", variant === "top" && "q-dialog-top", className)}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";
