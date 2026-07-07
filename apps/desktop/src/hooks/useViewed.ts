import { useEffect } from "react";
import { api } from "../lib/api.ts";
import { normalizeViewedMap } from "../lib/viewedFingerprint.ts";
import { useAppStore } from "../store/appStore.ts";

/**
 * Loads persisted viewed-file state into the store once on startup.
 * The Rust side persists opaque JSON, so older installs may still hold the
 * legacy `prKey -> string[]` shape — normalizeViewedMap migrates either shape
 * into the fingerprinted map.
 */
export function useLoadViewed(): void {
  const setViewed = useAppStore((s) => s.setViewed);
  useEffect(() => {
    api
      .getViewedMap()
      .then((map) => setViewed(normalizeViewedMap(map)))
      .catch(() => {});
  }, [setViewed]);
}
