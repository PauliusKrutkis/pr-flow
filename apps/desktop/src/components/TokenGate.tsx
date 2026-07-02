import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft } from "lucide-react";
import { api } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { useHotkeys } from "../keyboard";
import { cn } from "../lib/cn";
import { Spinner } from "./ui/Spinner";

type Provider = "github" | "gitlab";
type Busy = "idle" | "oauth" | "pat";

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GitLabMark() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M15.73 6.44l-.02-.06-2.13-5.55a.55.55 0 00-.22-.26.57.57 0 00-.65.03.57.57 0 00-.19.29l-1.44 4.4H4.92L3.48.89a.56.56 0 00-.19-.29.57.57 0 00-.65-.03.55.55 0 00-.22.26L.29 6.38l-.02.06a3.95 3.95 0 001.31 4.56l.01.01.02.02 3.24 2.43 1.61 1.21 .98.74a.66.66 0 00.79 0l.98-.74 1.61-1.21 3.26-2.44.01-.01a3.95 3.95 0 001.31-4.57z" />
    </svg>
  );
}

/**
 * The account gate — first sign-in and "add account" alike. GitHub connects
 * via OAuth or a PAT; GitLab (gitlab.com or self-managed) via a PAT with the
 * `api` scope. On success the app reloads so every cache belongs to the new
 * active account.
 */
export function TokenGate() {
  const goInbox = useAppStore((s) => s.goInbox);
  const hasAccounts = useAppStore((s) => s.accounts.length > 0);

  const [provider, setProvider] = useState<Provider>("github");
  const [host, setHost] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<Busy>("idle");
  const [error, setError] = useState<string | null>(null);
  const [oauthReady, setOauthReady] = useState<boolean | null>(null);
  const [gitlabOauthReady, setGitlabOauthReady] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .isOAuthConfigured()
      .then(setOauthReady)
      .catch(() => setOauthReady(false));
    api
      .isGitlabOAuthConfigured()
      .then(setGitlabOauthReady)
      .catch(() => setGitlabOauthReady(false));
  }, []);

  // Esc backs out of "add account" — only when there's an inbox to go back to.
  useHotkeys("token", [
    {
      keys: "esc",
      description: "Back to inbox",
      group: "Navigation",
      hidden: !hasAccounts,
      run: () => {
        if (hasAccounts) goInbox();
      },
    },
  ]);

  // The account changed under the app — reload into the inbox so queries,
  // caches, and viewed state all belong to the new active account.
  function finish() {
    goInbox();
    window.location.reload();
  }

  async function signInWithGithub() {
    if (busy !== "idle") return;
    setBusy("oauth");
    setError(null);
    try {
      await api.loginWithGithub();
      finish();
    } catch (e) {
      setError(String(e));
      setBusy("idle");
    }
  }

  async function signInWithGitlab() {
    if (busy !== "idle") return;
    setBusy("oauth");
    setError(null);
    try {
      await api.loginWithGitlab();
      finish();
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
      await api.addAccount({
        provider,
        host: provider === "gitlab" ? host.trim() || null : null,
        token: trimmed,
      });
      finish();
    } catch (e) {
      setError(String(e));
      setBusy("idle");
    }
  }

  const disabled = busy !== "idle";
  const tokenUrl =
    provider === "github"
      ? "https://github.com/settings/tokens/new?scopes=repo&description=Nod"
      : `${(host.trim() || "https://gitlab.com").replace(/\/$/, "")}/-/user_settings/personal_access_tokens?name=Nod&scopes=api`;

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div className="q-card relative w-full max-w-md p-8 shadow-lg">
        {hasAccounts && (
          <button
            type="button"
            onClick={goInbox}
            className="q-btn q-btn-ghost q-focus absolute right-4 top-4 px-2 py-1 text-xs"
          >
            <ArrowLeft size={13} aria-hidden /> Back
          </button>
        )}

        <div className="flex items-center gap-2.5">
          <span
            className="h-4 w-4 rounded-[5px]"
            style={{
              background: "linear-gradient(135deg, #8b80ff, #6f63e6)",
              boxShadow: "0 0 12px -2px rgba(139,128,255,0.5)",
            }}
            aria-hidden
          />
          <h1 className="text-2xl font-semibold text-fg">Nod</h1>
        </div>
        <p className="mt-1 text-sm text-muted">
          {hasAccounts
            ? "Add another account"
            : "Keyboard-first code review for GitHub and GitLab"}
        </p>

        {/* Provider */}
        <div className="qa-seg mt-6" role="tablist" aria-label="Provider">
          <button
            type="button"
            role="tab"
            aria-selected={provider === "github"}
            className={cn("qa-seg-btn", provider === "github" && "qa-seg-on")}
            onClick={() => {
              setProvider("github");
              setError(null);
            }}
          >
            <GitHubMark /> GitHub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={provider === "gitlab"}
            className={cn("qa-seg-btn", provider === "gitlab" && "qa-seg-on")}
            onClick={() => {
              setProvider("gitlab");
              setError(null);
            }}
          >
            <GitLabMark /> GitLab
          </button>
        </div>

        {provider === "github" && (
          <>
            <button
              type="button"
              onClick={() => void signInWithGithub()}
              disabled={disabled}
              className="q-btn q-btn-primary q-focus mt-5 w-full py-2.5"
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
                Complete the sign-in in your browser — the app comes back on its
                own.
              </p>
            ) : oauthReady === false ? (
              <p className="mt-2 text-center text-xs text-faint">
                Needs a one-time OAuth setup — see the README. You can paste a
                token below in the meantime.
              </p>
            ) : null}

            <div className="my-5 flex items-center gap-3 text-xs text-faint">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
          </>
        )}

        {provider === "gitlab" && (
          <>
            <button
              type="button"
              onClick={() => void signInWithGitlab()}
              disabled={disabled}
              className="q-btn q-btn-primary q-focus mt-5 w-full py-2.5"
            >
              {busy === "oauth" ? (
                <>
                  <Spinner /> Waiting for GitLab…
                </>
              ) : (
                <>
                  <GitLabMark /> Sign in with GitLab
                </>
              )}
            </button>
            {busy === "oauth" ? (
              <p className="mt-2 text-center text-xs text-muted">
                Complete the sign-in in your browser — the app comes back on its
                own.
              </p>
            ) : gitlabOauthReady === false ? (
              <p className="mt-2 text-center text-xs text-faint">
                Needs a one-time app registration on gitlab.com — see README →
                GitLab. You can paste a token below in the meantime.
              </p>
            ) : null}
            <div className="my-5 flex items-center gap-3 text-xs text-faint">
              <span className="h-px flex-1 bg-line" />
              or self-managed / token
              <span className="h-px flex-1 bg-line" />
            </div>
            <p className="text-sm text-muted">
              GitLab host — leave empty for gitlab.com.
            </p>
            <input
              type="text"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="https://gitlab.com"
              spellCheck={false}
              autoComplete="off"
              disabled={disabled}
              className="q-input mt-2 font-mono disabled:opacity-60"
            />
            <div className="my-4" />
          </>
        )}

        <p className="text-sm text-muted">
          Paste a Personal Access Token with the{" "}
          <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs text-fg">
            {provider === "github" ? "repo" : "api"}
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
          placeholder={provider === "github" ? "ghp_…" : "glpat-…"}
          spellCheck={false}
          autoComplete="off"
          disabled={disabled}
          className="q-input mt-3 font-mono disabled:opacity-60"
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
            className="q-btn q-btn-quiet q-focus flex-1 py-2"
          >
            {busy === "pat" ? <Spinner /> : "Connect with token"}
          </button>
          <button
            type="button"
            onClick={() => void openUrl(tokenUrl)}
            className="shrink-0 text-sm text-accent hover:underline"
          >
            Create a token →
          </button>
        </div>
      </div>
    </div>
  );
}
