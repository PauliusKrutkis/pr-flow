import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * App zoom — the desktop convention: mod +/- steps, mod 0 resets. The factor
 * persists per device and re-applies on boot. Native webview zoom behaves like
 * browser zoom (transparent to layout math); if the platform webview refuses,
 * CSS zoom on the root element is the fallback.
 */

const KEY = "pr-flow:zoom";
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.0;
export const ZOOM_STEP = 0.1;

export function loadZoom(): number {
  const v = Number(localStorage.getItem(KEY));
  return Number.isFinite(v) && v >= ZOOM_MIN && v <= ZOOM_MAX ? v : 1;
}

export function clampZoom(f: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(f * 10) / 10));
}

export async function applyZoom(factor: number): Promise<void> {
  try {
    localStorage.setItem(KEY, String(factor));
  } catch {
    /* ignore */
  }
  try {
    await getCurrentWebview().setZoom(factor);
  } catch {
    (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom =
      factor === 1 ? "" : String(factor);
  }
}
