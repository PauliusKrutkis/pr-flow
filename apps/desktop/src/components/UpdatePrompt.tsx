import { useEffect, useState } from "react";
import { Download, RefreshCw } from "lucide-react";
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
    <div className="qb-stack qb-stack-tr">
      <div className="qb-update" role="status">
        <span className="qb-update-icon">
          <Download size={16} aria-hidden />
        </span>
        <div className="qb-update-body">
          <div className="qb-update-head">
            <span className="qb-update-title">Update available</span>
            <span className="q-mono qb-update-ver">{update.version}</span>
          </div>
          <p className="qb-update-text">
            You're on {update.currentVersion}. Installs on the next restart —
            nothing interrupts your review.
          </p>
          {update.notes ? (
            <p className="qb-update-text" style={{ marginTop: 6 }}>
              {update.notes}
            </p>
          ) : null}
          {error ? <p className="qb-update-err">{error}</p> : null}
          <div className="qb-update-actions">
            <button
              type="button"
              onClick={install}
              disabled={installing}
              className="q-btn q-btn-primary qb-update-primary"
            >
              <RefreshCw size={13} aria-hidden />
              {installing ? "Installing…" : "Restart & update"}
            </button>
            <button
              type="button"
              onClick={() => setUpdate(null)}
              disabled={installing}
              className="qb-update-later"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
