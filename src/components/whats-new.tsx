import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api.ts";
import {
  compareVersions,
  releasesQuery,
  releasesSince,
} from "../lib/releases.ts";
import { Markdown } from "./markdown.tsx";

const LAST_RUN_KEY = "pr-flow:lastRunVersion";

function readLastRun(): string | null {
  try {
    return localStorage.getItem(LAST_RUN_KEY);
  } catch {
    return null;
  }
}

function rememberVersion(version: string) {
  try {
    localStorage.setItem(LAST_RUN_KEY, version);
  } catch {
    /* ignore quota / private-mode errors */
  }
}

interface Gate {
  lastRun: string | null;
  version: string;
}

/**
 * After the app updates, the first launch shows what changed. We compare the
 * running version to the last one we saw; on a change we pull the release
 * notes for every version in between — an update that skipped versions shows
 * them all. The version is remembered on "Got it", not on render, so the card
 * returns until it's actually acknowledged. The first run ever (no prior
 * version) and downgrades show nothing — there's no "new" yet.
 */
export function WhatsNew({ onShowHistory }: { onShowHistory: () => void }) {
  const [dismissed, setDismissed] = useState(false);

  const { data: gate } = useQuery<Gate>({
    queryFn: async () => {
      const version = await api.getAppVersion();
      const lastRun = readLastRun();
      if (!lastRun || compareVersions(lastRun, version) >= 0) {
        rememberVersion(version);
        return { lastRun: null, version };
      }
      return { lastRun, version };
    },
    queryKey: ["whats-new"],
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const { data: releases } = useQuery({
    ...releasesQuery,
    enabled: Boolean(gate?.lastRun),
  });

  if (!gate?.lastRun || dismissed || releases === undefined) {
    return null;
  }

  const shown = releases
    ? releasesSince(releases, gate.lastRun, gate.version)
    : [];

  const dismiss = () => {
    rememberVersion(gate.version);
    setDismissed(true);
  };

  return (
    <div className="qb-update qb-whatsnew" role="status">
      <span className="qb-update-icon">
        <Sparkles aria-hidden size={16} />
      </span>
      <div className="qb-update-body">
        <div className="qb-update-head">
          <span className="qb-update-title">What's new</span>
          {shown.length <= 1 && (
            <span className="q-mono qb-update-ver">{gate.version}</span>
          )}
        </div>
        {shown.length > 0 ? (
          <div className="qb-whatsnew-notes">
            {shown.map((r) => (
              <section key={r.tag}>
                {shown.length > 1 && (
                  <h4 className="q-mono qb-whatsnew-tag">{r.tag}</h4>
                )}
                <Markdown>{r.notes ?? ""}</Markdown>
              </section>
            ))}
          </div>
        ) : (
          <p className="qb-update-text">
            You're now on {gate.version}. See the release on GitHub for details.
          </p>
        )}
        <div className="qb-update-actions">
          <button
            className="q-btn q-btn-primary qb-update-primary"
            onClick={dismiss}
            type="button"
          >
            Got it
          </button>
          <button
            className="qb-update-later"
            onClick={onShowHistory}
            type="button"
          >
            All releases
          </button>
        </div>
      </div>
    </div>
  );
}
