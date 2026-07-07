import { Download, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api.ts";
import type { UpdateInfo } from "../types.ts";

/**
 * "Update available" prompt. Checks the release feed on launch, then every few
 * hours and on window focus (best-effort — silent when the feed is
 * unreachable), so a long-running app still notices new releases. When a newer
 * signed build exists it offers a one-click install + relaunch.
 */

const RECHECK_MS = 4 * 60 * 60 * 1000;

export function UpdatePrompt() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let lastCheck = 0;
    function check(minGapMs = 0) {
      const now = Date.now();
      if (now - lastCheck < minGapMs) {
        return;
      }
      lastCheck = now;
      api
        .checkForUpdate()
        .then((u) => {
          if (!cancelled && u) {
            setUpdate(u);
          }
        })
        .catch(() => {});
    }
    check();
    const timer = window.setInterval(() => check(), RECHECK_MS);

    const onFocus = () => check(30 * 60 * 1000);
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (!update) {
    return null;
  }

  async function install() {
    setInstalling(true);
    setError(null);
    try {
      await api.installUpdate();
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  }

  return (
    <div className="qb-update" role="status">
      <span className="qb-update-icon">
        <Download aria-hidden size={16} />
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
            className="q-btn q-btn-primary qb-update-primary"
            disabled={installing}
            onClick={install}
            type="button"
          >
            <RefreshCw aria-hidden size={13} />
            {installing ? "Installing…" : "Restart & update"}
          </button>
          <button
            className="qb-update-later"
            disabled={installing}
            onClick={() => setUpdate(null)}
            type="button"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
