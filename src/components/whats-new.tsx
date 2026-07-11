import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { useState } from "react";
import { api } from "../lib/api.ts";
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

interface WhatsNewData {
  notes: string | null;
  version: string;
}

/**
 * After the app updates, the first launch shows what changed. We compare the
 * running version to the last one we saw; on a change we pull that version's
 * public release notes and show a dismissible card. The first run ever (no
 * prior version) shows nothing — there's no "new" yet.
 */
export function WhatsNew() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<WhatsNewData | null>({
    queryFn: async () => {
      const version = await api.getAppVersion();
      const lastRun = readLastRun();
      rememberVersion(version);
      if (!lastRun || lastRun === version) {
        return null;
      }
      const notes = await api.getReleaseNotes(`v${version}`).catch(() => null);
      return { notes, version };
    },
    queryKey: ["whats-new"],
    refetchOnWindowFocus: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const dismiss = () => {
    setDismissed(true);
  };

  if (!data || dismissed) {
    return null;
  }

  return (
    <div className="qb-update qb-whatsnew" role="status">
      <span className="qb-update-icon">
        <Sparkles aria-hidden size={16} />
      </span>
      <div className="qb-update-body">
        <div className="qb-update-head">
          <span className="qb-update-title">What's new</span>
          <span className="q-mono qb-update-ver">{data.version}</span>
        </div>
        {data.notes ? (
          <div className="qb-whatsnew-notes">
            <Markdown>{data.notes}</Markdown>
          </div>
        ) : (
          <p className="qb-update-text">
            You're now on {data.version}. See the release on GitHub for details.
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
        </div>
      </div>
    </div>
  );
}
