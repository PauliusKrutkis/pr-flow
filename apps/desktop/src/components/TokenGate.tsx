import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { Spinner } from "./ui/Spinner";

const CREATE_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=PR%20Flow";

type Busy = "idle" | "oauth" | "pat";

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

export function TokenGate({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [oauthReady, setOauthReady] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .isOAuthConfigured()
      .then(setOauthReady)
      .catch(() => setOauthReady(false));
  }, []);

  async function signInWithGithub() {
    if (busy !== "idle") return;
    setBusy("oauth");
    setError(null);
    try {
      await api.loginWithGithub();
      onAuthenticated();
    } catch (e) {
      setError(String(e));
      setBusy("idle");
    }
  }

  async function connect() {
    const trimmed = token.trim();
    if (!trimmed || busy !== "idle") return;
    setBusy("pat");
    setError(null);
    try {
      await api.setToken(trimmed);
      onAuthenticated();
    } catch (e) {
      setError(String(e));
      setBusy("idle");
    }
  }

  const disabled = busy !== "idle";

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-8 shadow-lg">
        <h1 className="text-2xl font-semibold text-fg">PR Flow</h1>
        <p className="mt-1 text-sm text-muted">Keyboard-first GitHub PR review</p>

        {/* Primary: Sign in with GitHub */}
        <button
          type="button"
          onClick={() => void signInWithGithub()}
          disabled={disabled}
          className={cn(
            "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-card px-3 py-2.5 text-sm font-medium",
            "bg-accent text-accent-fg transition-opacity",
            disabled && "cursor-not-allowed opacity-60",
          )}
        >
          {busy === "oauth" ? (
            <>
              <Spinner /> Waiting for GitHub…
            </>
          ) : (
            <>
              <GitHubMark /> Sign in with GitHub
            </>
          )}
        </button>
        {busy === "oauth" ? (
          <p className="mt-2 text-center text-xs text-muted">
            Complete the sign-in in your browser, then return here.
          </p>
        ) : oauthReady === false ? (
          <p className="mt-2 text-center text-xs text-faint">
            Needs a one-time OAuth setup — see the README. You can paste a token
            below in the meantime.
          </p>
        ) : null}

        {/* Divider */}
        <div className="my-5 flex items-center gap-3 text-xs text-faint">
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        {/* Fallback: Personal Access Token */}
        <p className="text-sm text-muted">
          Paste a Personal Access Token with the{" "}
          <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs text-fg">
            repo
          </code>{" "}
          scope.
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void connect();
            }
          }}
          placeholder="ghp_…"
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          className="mt-3 w-full rounded-card border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none placeholder:text-faint focus:border-accent disabled:opacity-60"
        />
        <p className="mt-1.5 text-xs text-faint">Stored locally on this device.</p>

        {error ? (
          <p className="mt-3 break-words text-sm text-danger">{error}</p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => void connect()}
            disabled={disabled || !token.trim()}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-card border border-line px-3 py-2 text-sm font-medium",
              "text-fg hover:bg-elevated transition-opacity",
              (disabled || !token.trim()) && "cursor-not-allowed opacity-50",
            )}
          >
            {busy === "pat" ? <Spinner /> : "Connect with token"}
          </button>
          <button
            type="button"
            onClick={() => void openUrl(CREATE_TOKEN_URL)}
            className="shrink-0 text-sm text-accent hover:underline"
          >
            Create a token →
          </button>
        </div>
      </div>
    </div>
  );
}
