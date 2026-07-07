/**
 * The shadcn class-merge helper: clsx for conditional composition, then
 * tailwind-merge to let later utility classes win over earlier ones. Every
 * primitive under src/ui takes a `className` prop and folds it in with cn(),
 * so a view can override any default without fighting specificity.
 */

import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
