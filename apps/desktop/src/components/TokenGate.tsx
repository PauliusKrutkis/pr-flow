import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowLeft, KeyRound, Server } from "lucide-react";
import { api } from "../lib/api";
import { useAppStore } from "../store/appStore";
import { useHotkeys } from "../keyboard";
import { Spinner } from "./ui/Spinner";

type View = "identity" | "selfhosted" | "token";
type Busy = "idle" | "oauth" | "probe" | "pat";

/** Remembered self-hosted instances (host + optional OAuth application id). */
interface GitlabInstance {
  host: string;
  clientId?: string;
}
const INSTANCES_KEY = "pr-flow:gitlabInstances";
function loadInstances(): GitlabInstance[] {
  try {
    const v = JSON.parse(localStorage.getItem(INSTANCES_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x?.host === "string") : [];
  } catch {
    return [];
  }
}
function saveInstance(inst: GitlabInstance) {
  const list = loadInstances().filter((i) => i.host !== inst.host);
  list.push(inst);
  try {
    localStorage.setItem(INSTANCES_KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function shortHost(host: string): string {
  return host.replace(/^https?:\/\//, "");
}

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GitLabMark() {
  return (
    <svg viewBox="0 0 16 16" width="17" height="17" fill="currentColor" aria-hidden>
      <path d="M15.73 6.44l-.02-.06-2.13-5.55a.55.55 0 00-.22-.26.57.57 0 00-.65.03.57.57 0 00-.19.29l-1.44 4.4H4.92L3.48.89a.56.56 0 00-.19-.29.57.57 0 00-.65-.03.55.55 0 00-.22.26L.29 6.38l-.02.06a3.95 3.95 0 001.31 4.56l.01.01.02.02 3.24 2.43 1.61 1.21 .98.74a.66.66 0 00.79 0l.98-.74 1.61-1.21 3.26-2.44.01-.01a3.95 3.95 0 001.31-4.57z" />
    </svg>
  );
}

export function TokenGate() {
  const goInbox = useAppStore((s) => s.goInbox);
  const hasAccounts = useAppStore((s) => s.accounts.length > 0);
  const accounts = useAppStore((s) => s.accounts);

  const [view, setView] = useState<View>("identity");
  const [busy, setBusy] = useState<Busy>("idle");
  const [busyLabel, setBusyLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [hostInput, setHostInput] = useState("");
  const [probedHost, setProbedHost] = useState<string | null>(null);
  const [appId, setAppId] = useState("");
  const [tokenProvider, setTokenProvider] = useState<"github" | "gitlab">("github");
  const [tokenHost, setTokenHost] = useState("");
  const [token, setToken] = useState("");

  const [ghOauthReady, setGhOauthReady] = useState(true);
  const [glOauthReady, setGlOauthReady] = useState(true);

  useEffect(() => {
    api.isOAuthConfigured().then(setGhOauthReady).catch(() => setGhOauthReady(false));
    api
      .isGitlabOAuthConfigured()
      .then(setGlOauthReady)
      .catch(() => setGlOauthReady(false));
  }, []);

  const instances: GitlabInstance[] = (() => {
    const list = loadInstances();
    for (const a of accounts) {
      if (
        a.provider === "gitlab" &&
        a.host !== "https://gitlab.com" &&
        !list.some((i) => i.host === a.host)
      ) {
        list.push({ host: a.host });
      }
    }
    return list;
  })();

  function reset(next: View) {
    setError(null);
    setBusy("idle");
    setView(next);
  }

  useHotkeys("token", [
    {
      keys: "esc",
      description: "Back",
      group: "Navigation",
      hidden: !hasAccounts && view === "identity",
      run: () => {
        if (view !== "identity") reset("identity");
        else if (hasAccounts) goInbox();
      },
    },
  ]);

  /** A new active account: reload so every cache belongs to it. */

  function finish() {
    goInbox();
    window.location.reload();
  }

  async function run(label: string, kind: Busy, action: () => Promise<void>) {
    if (busy !== "idle") return;
    setBusy(kind);
    setBusyLabel(label);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(String(e));
      setBusy("idle");
    }
  }

  const signInGithub = () =>
    run("Waiting for GitHub in your browser…", "oauth", async () => {
      await api.loginWithGithub();
      finish();
    });

  const signInGitlab = (host?: string, clientId?: string) =>
    run(
      `Waiting for ${shortHost(host ?? "gitlab.com")} in your browser…`,
      "oauth",
      async () => {
        await api.loginWithGitlab({ host: host ?? null, clientId: clientId ?? null });
        if (host) saveInstance({ host, clientId });
        finish();
      },
    );

  const openInstance = (inst: GitlabInstance) => {
    if (inst.clientId) {
      void signInGitlab(inst.host, inst.clientId);
    } else {
      setHostInput(shortHost(inst.host));
      setProbedHost(inst.host);
      setAppId("");
      setToken("");
      reset("selfhosted");
    }
  };

  const probe = () =>
    run("Checking the instance…", "probe", async () => {
      const normalized = await api.probeGitlab(hostInput);
      setProbedHost(normalized);
      setBusy("idle");
    });

  const connectToken = (provider: "github" | "gitlab", host: string | null) =>
    run("Checking the token…", "pat", async () => {
      await api.addAccount({ provider, host, token: token.trim() });
      if (provider === "gitlab" && host) saveInstance({ host });
      finish();
    });

  const disabled = busy !== "idle";
  const knownId = probedHost
    ? instances.find((i) => i.host === probedHost)?.clientId
    : undefined;
  const oauthId = appId.trim() || knownId;
  const ghTokenUrl =
    "https://github.com/settings/tokens/new?scopes=repo&description=Nod";
  const glTokenUrl = (host: string) =>
    `${host}/-/user_settings/personal_access_tokens?name=Nod&scopes=api`;

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div className="qg-card">
        {/* header */}
        <div className="flex items-center gap-2.5">
          <span className="qg-logo" aria-hidden />
          <h1 className="text-2xl font-semibold text-fg">Nod</h1>
          {hasAccounts && view === "identity" && (
            <button
              type="button"
              onClick={goInbox}
              className="q-btn q-btn-ghost q-focus ml-auto px-2 py-1 text-xs"
            >
              <ArrowLeft size={13} aria-hidden /> Back
            </button>
          )}
        </div>
        <p className="mb-6 mt-1 text-sm text-muted">
          {hasAccounts ? "Add an account" : "Keyboard-first code review"}
        </p>

        {view === "identity" && (
          <>
            <div className="qg-stack" role="group" aria-label="Sign in">
              <button
                type="button"
                className="qg-row q-focus"
                disabled={disabled}
                onClick={() => void signInGithub()}
              >
                <GitHubMark />
                Continue with GitHub
                {!ghOauthReady && <span className="qg-row-hint">needs setup</span>}
              </button>
              <button
                type="button"
                className="qg-row q-focus"
                disabled={disabled}
                onClick={() => void signInGitlab()}
              >
                <GitLabMark />
                Continue with GitLab
                {!glOauthReady && <span className="qg-row-hint">needs setup</span>}
              </button>
              {instances.map((inst) => (
                <button
                  key={inst.host}
                  type="button"
                  className="qg-row q-focus"
                  disabled={disabled}
                  onClick={() => openInstance(inst)}
                >
                  <Server size={16} aria-hidden />
                  <span className="q-mono">{shortHost(inst.host)}</span>
                  {!inst.clientId && <span className="qg-row-hint">token</span>}
                </button>
              ))}
            </div>

            <div className="qg-links">
              <button
                type="button"
                className="qg-link q-focus"
                onClick={() => {
                  setHostInput("");
                  setProbedHost(null);
                  setAppId("");
                  setToken("");
                  reset("selfhosted");
                }}
              >
                <Server size={12} aria-hidden /> Self-hosted GitLab
              </button>
              <span className="q-dot">·</span>
              <button
                type="button"
                className="qg-link q-focus"
                onClick={() => {
                  setToken("");
                  reset("token");
                }}
              >
                <KeyRound size={12} aria-hidden /> Use a token
              </button>
            </div>
          </>
        )}

        {view === "selfhosted" && (
          <>
            <label className="qg-label" htmlFor="qg-host">
              GitLab host
            </label>
            <div className="flex gap-2">
              <input
                id="qg-host"
                type="text"
                value={hostInput}
                onChange={(e) => {
                  setHostInput(e.target.value);
                  setProbedHost(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !probedHost) {
                    e.preventDefault();
                    void probe();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    reset("identity");
                  }
                }}
                placeholder="gitlab.yourcompany.com"
                spellCheck={false}
                autoComplete="off"
                autoFocus
                disabled={disabled}
                className="q-input font-mono"
              />
              {!probedHost && (
                <button
                  type="button"
                  onClick={() => void probe()}
                  disabled={disabled || !hostInput.trim()}
                  className="q-btn q-btn-quiet shrink-0"
                >
                  {busy === "probe" ? <Spinner /> : "Continue"}
                </button>
              )}
            </div>

            {probedHost && (
              <div className="qg-reveal">
                <p className="qg-ok">✓ {shortHost(probedHost)} is reachable</p>

                {oauthId && (
                  <button
                    type="button"
                    className="q-btn q-btn-primary q-focus mb-4 w-full py-2.5"
                    disabled={disabled}
                    onClick={() => void signInGitlab(probedHost, oauthId)}
                  >
                    <GitLabMark /> Sign in to {shortHost(probedHost)}
                  </button>
                )}

                <label className="qg-label" htmlFor="qg-appid">
                  Application ID{" "}
                  <span className="qg-label-soft">
                    — optional; a group owner creates it once, then sign-in is
                    one click for everyone
                  </span>
                </label>
                <input
                  id="qg-appid"
                  type="text"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="from Group → Settings → Applications"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={disabled}
                  className="q-input font-mono"
                />

                <div className="qg-divider">or connect with a token</div>

                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void connectToken("gitlab", probedHost);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      reset("identity");
                    }
                  }}
                  placeholder="glpat-…  (api scope)"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={disabled}
                  className="q-input font-mono"
                />
                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => void connectToken("gitlab", probedHost)}
                    disabled={disabled || !token.trim()}
                    className="q-btn q-btn-quiet flex-1"
                  >
                    {busy === "pat" ? <Spinner /> : "Connect"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void openUrl(glTokenUrl(probedHost))}
                    className="shrink-0 text-sm text-accent hover:underline"
                  >
                    Create a token →
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {view === "token" && (
          <>
            <div className="qa-seg mb-4" role="radiogroup" aria-label="Provider">
              <button
                type="button"
                role="radio"
                aria-checked={tokenProvider === "github"}
                className={"qa-seg-btn" + (tokenProvider === "github" ? " qa-seg-on" : "")}
                onClick={() => setTokenProvider("github")}
              >
                <GitHubMark /> GitHub
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={tokenProvider === "gitlab"}
                className={"qa-seg-btn" + (tokenProvider === "gitlab" ? " qa-seg-on" : "")}
                onClick={() => setTokenProvider("gitlab")}
              >
                <GitLabMark /> GitLab
              </button>
            </div>

            {tokenProvider === "gitlab" && (
              <>
                <label className="qg-label" htmlFor="qg-token-host">
                  Host <span className="qg-label-soft">— empty for gitlab.com</span>
                </label>
                <input
                  id="qg-token-host"
                  type="text"
                  value={tokenHost}
                  onChange={(e) => setTokenHost(e.target.value)}
                  placeholder="gitlab.com"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={disabled}
                  className="q-input mb-3 font-mono"
                />
              </>
            )}

            <label className="qg-label" htmlFor="qg-token">
              Personal access token{" "}
              <span className="qg-label-soft">
                — {tokenProvider === "github" ? "repo" : "api"} scope
              </span>
            </label>
            <input
              id="qg-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void connectToken(
                    tokenProvider,
                    tokenProvider === "gitlab" ? tokenHost.trim() || null : null,
                  );
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  reset("identity");
                }
              }}
              placeholder={tokenProvider === "github" ? "ghp_…" : "glpat-…"}
              spellCheck={false}
              autoComplete="off"
              autoFocus
              disabled={disabled}
              className="q-input font-mono"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() =>
                  void connectToken(
                    tokenProvider,
                    tokenProvider === "gitlab" ? tokenHost.trim() || null : null,
                  )
                }
                disabled={disabled || !token.trim()}
                className="q-btn q-btn-quiet flex-1 py-2"
              >
                {busy === "pat" ? <Spinner /> : "Connect"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void openUrl(
                    tokenProvider === "github"
                      ? ghTokenUrl
                      : glTokenUrl(
                          tokenHost.trim()
                            ? `https://${shortHost(tokenHost.trim())}`
                            : "https://gitlab.com",
                        ),
                  )
                }
                className="shrink-0 text-sm text-accent hover:underline"
              >
                Create a token →
              </button>
            </div>
          </>
        )}

        {/* one status line — the waiting state or the error, never both */}
        {busy === "oauth" && (
          <p className="mt-3 text-center text-xs text-muted">{busyLabel}</p>
        )}
        {error && <p className="mt-3 break-words text-sm text-danger">{error}</p>}

        {view !== "identity" && (
          <button
            type="button"
            className="qg-link q-focus mt-5"
            onClick={() => reset("identity")}
          >
            <ArrowLeft size={12} aria-hidden /> All sign-in options
          </button>
        )}
        <p className="mt-4 text-center text-xs text-faint">
          Tokens stay on this device; sign-ins open your browser.
        </p>
      </div>
    </div>
  );
}
