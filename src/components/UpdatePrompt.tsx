import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { UpdateInfo } from "../types";

// "Update available" prompt. Checks the release feed once on mount (best-effort
// — silent when the updater isn't configured or the feed is unreachable) and,
// if a newer signed build exists, offers a one-click install + relaunch.
//
// SCAFFOLD: functional end-to-end once `plugins.updater` has a real pubkey +
// endpoint and CI publishes signed bundles — see the README "Auto-updates"
// section. Until then `checkForUpdate` returns null and this renders nothing.

export function UpdatePrompt() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .checkForUpdate()
      .then((u) => {
        if (!cancelled) setUpdate(u);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update) return null;

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      // On success the backend relaunches into the new version, so control
      // never returns here.
      await api.installUpdate();
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  }

  return (
    <div className="fixed right-4 top-4 z-50 w-80">
      <div className="overflow-hidden rounded-card border border-line bg-surface shadow-2xl ring-1 ring-accent/30">
        <div className="px-4 pt-3 text-xs font-medium text-accent">
          ⬆ Update available
        </div>
        <div className="px-4 pb-1 pt-1">
          <div className="text-sm font-semibold text-fg">
            PR Flow {update.version}
          </div>
          <div className="text-xs text-muted">
            You're on {update.currentVersion}
          </div>
          {update.notes ? (
            <div className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs text-muted">
              {update.notes}
            </div>
          ) : null}
          {error ? <div className="mt-1 text-xs text-danger">{error}</div> : null}
        </div>
        <div className="flex items-center justify-end gap-2 px-4 pb-3 pt-1 text-xs">
          <button
            type="button"
            onClick={() => setUpdate(null)}
            disabled={installing}
            className="rounded px-2 py-1 text-muted hover:bg-elevated hover:text-fg disabled:opacity-50"
          >
            Later
          </button>
          <button
            type="button"
            onClick={install}
            disabled={installing}
            className="rounded bg-accent/15 px-2 py-1 font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
          >
            {installing ? "Installing…" : "Install & Restart"}
          </button>
        </div>
      </div>
    </div>
  );
}
