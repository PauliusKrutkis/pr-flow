import { useEffect } from "react";
import { api } from "../lib/api";
import { useAppStore } from "../store/appStore";

/** Loads persisted viewed-file state into the store once on startup. */
export function useLoadViewed(): void {
  const setViewed = useAppStore((s) => s.setViewed);
  useEffect(() => {
    api
      .getViewedMap()
      .then((map) => setViewed(map ?? {}))
      .catch(() => {});
  }, [setViewed]);
}
