// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { openUrl } from "@tauri-apps/plugin-opener";
// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { ArrowLeft, KeyRound, Server } from "lucide-react";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useHotkeys } from "../keyboard/use-hotkeys.ts";
import { api } from "../lib/api.ts";
import { useAppStore } from "../store/app-store.ts";
import { Spinner } from "./ui/spinner.tsx";

type View = "identity" | "selfhosted" | "token";
type Busy = "idle" | "oauth" | "probe" | "pat";
type TokenProvider = "github" | "gitlab";

/** Remembered self-hosted instances (host + optional OAuth application id). */
interface GitlabInstance {
  clientId?: string;
  host: string;
}

const INSTANCES_KEY = "pr-flow:gitlabInstances";
const HTTPS_PREFIX = /^https?:\/\//;
const GH_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=Nod";

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
  return host.replace(HTTPS_PREFIX, "");
}

function glTokenUrl(host: string): string {
  return `${host}/-/user_settings/personal_access_tokens?name=Nod&scopes=api`;
}

function runPromise(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

function GitHubMark() {
  return (
    <svg
      aria-hidden
      fill="currentColor"
      height="17"
      viewBox="0 0 16 16"
      width="17"
    >
      <title>GitHub</title>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function GitLabMark() {
  return (
    <svg
      aria-hidden
      fill="currentColor"
      height="17"
      viewBox="0 0 16 16"
      width="17"
    >
      <title>GitLab</title>
      <path d="M15.73 6.44l-.02-.06-2.13-5.55a.55.55 0 00-.22-.26.57.57 0 00-.65.03.57.57 0 00-.19.29l-1.44 4.4H4.92L3.48.89a.56.56 0 00-.19-.29.57.57 0 00-.65-.03.55.55 0 00-.22.26L.29 6.38l-.02.06a3.95 3.95 0 001.31 4.56l.01.01.02.02 3.24 2.43 1.61 1.21 .98.74a.66.66 0 00.79 0l.98-.74 1.61-1.21 3.26-2.44.01-.01a3.95 3.95 0 001.31-4.57z" />
    </svg>
  );
}

interface InstanceRowProps {
  disabled: boolean;
  inst: GitlabInstance;
  onOpen: (inst: GitlabInstance) => void;
}

function InstanceRow({ inst, disabled, onOpen }: InstanceRowProps) {
  const onClick = useCallback(() => onOpen(inst), [inst, onOpen]);

  return (
    <button
      className="qg-row q-focus"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <Server aria-hidden size={16} />
      <span className="q-mono">{shortHost(inst.host)}</span>
      {inst.clientId ? null : <span className="qg-row-hint">token</span>}
    </button>
  );
}

interface IdentityPanelProps {
  disabled: boolean;
  ghOauthReady: boolean;
  glOauthReady: boolean;
  instances: GitlabInstance[];
  onOpenInstance: (inst: GitlabInstance) => void;
  onSelfHosted: () => void;
  onSignInGithub: () => void;
  onSignInGitlab: () => void;
  onUseToken: () => void;
}

function IdentityPanel({
  disabled,
  ghOauthReady,
  glOauthReady,
  instances,
  onOpenInstance,
  onSelfHosted,
  onSignInGithub,
  onSignInGitlab,
  onUseToken,
}: IdentityPanelProps) {
  return (
    <>
      <fieldset className="qg-stack">
        <legend className="qg-label">Sign in</legend>
        <button
          className="qg-row q-focus"
          disabled={disabled}
          onClick={onSignInGithub}
          type="button"
        >
          <GitHubMark />
          Continue with GitHub
          {ghOauthReady ? null : (
            <span className="qg-row-hint">needs setup</span>
          )}
        </button>
        <button
          className="qg-row q-focus"
          disabled={disabled}
          onClick={onSignInGitlab}
          type="button"
        >
          <GitLabMark />
          Continue with GitLab
          {glOauthReady ? null : (
            <span className="qg-row-hint">needs setup</span>
          )}
        </button>
        {instances.map((inst) => (
          <InstanceRow
            disabled={disabled}
            inst={inst}
            key={inst.host}
            onOpen={onOpenInstance}
          />
        ))}
      </fieldset>

      <div className="qg-links">
        <button
          className="qg-link q-focus"
          onClick={onSelfHosted}
          type="button"
        >
          <Server aria-hidden size={12} /> Self-hosted GitLab
        </button>
        <span className="q-dot">·</span>
        <button className="qg-link q-focus" onClick={onUseToken} type="button">
          <KeyRound aria-hidden size={12} /> Use a token
        </button>
      </div>
    </>
  );
}

interface SelfHostedPanelProps {
  appId: string;
  busy: Busy;
  disabled: boolean;
  hostInput: string;
  oauthId: string | undefined;
  onAppIdChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onConnectGitlabToken: () => void;
  onCreateToken: () => void;
  onHostInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onHostKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onProbe: () => void;
  onSignInGitlab: () => void;
  onTokenChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTokenKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  probedHost: string | null;
  token: string;
}

function SelfHostedPanel({
  appId,
  busy,
  disabled,
  hostInput,
  oauthId,
  onAppIdChange,
  onConnectGitlabToken,
  onCreateToken,
  onHostInputChange,
  onHostKeyDown,
  onProbe,
  onSignInGitlab,
  onTokenChange,
  onTokenKeyDown,
  probedHost,
  token,
}: SelfHostedPanelProps) {
  return (
    <>
      <label className="qg-label" htmlFor="qg-host">
        GitLab host
      </label>
      <div className="flex gap-2">
        <input
          autoComplete="off"
          autoFocus
          className="q-input font-mono"
          disabled={disabled}
          id="qg-host"
          onChange={onHostInputChange}
          onKeyDown={onHostKeyDown}
          placeholder="gitlab.yourcompany.com"
          spellCheck={false}
          type="text"
          value={hostInput}
        />
        {probedHost ? null : (
          <button
            className="q-btn q-btn-quiet shrink-0"
            disabled={disabled || !hostInput.trim()}
            onClick={onProbe}
            type="button"
          >
            {busy === "probe" ? <Spinner /> : "Continue"}
          </button>
        )}
      </div>

      {probedHost ? (
        <div className="qg-reveal">
          <p className="qg-ok">✓ {shortHost(probedHost)} is reachable</p>

          {oauthId ? (
            <button
              className="q-btn q-btn-primary q-focus mb-4 w-full py-2.5"
              disabled={disabled}
              onClick={onSignInGitlab}
              type="button"
            >
              <GitLabMark /> Sign in to {shortHost(probedHost)}
            </button>
          ) : null}

          <label className="qg-label" htmlFor="qg-appid">
            Application ID{" "}
            <span className="qg-label-soft">
              — optional; a group owner creates it once, then sign-in is one
              click for everyone
            </span>
          </label>
          <input
            autoComplete="off"
            className="q-input font-mono"
            disabled={disabled}
            id="qg-appid"
            onChange={onAppIdChange}
            placeholder="from Group → Settings → Applications"
            spellCheck={false}
            type="text"
            value={appId}
          />

          <div className="qg-divider">or connect with a token</div>

          <input
            autoComplete="off"
            className="q-input font-mono"
            disabled={disabled}
            onChange={onTokenChange}
            onKeyDown={onTokenKeyDown}
            placeholder="glpat-…  (api scope)"
            spellCheck={false}
            type="password"
            value={token}
          />
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <button
              className="q-btn q-btn-quiet flex-1"
              disabled={disabled || !token.trim()}
              onClick={onConnectGitlabToken}
              type="button"
            >
              {busy === "pat" ? <Spinner /> : "Connect"}
            </button>
            <button
              className="shrink-0 text-accent text-sm hover:underline"
              onClick={onCreateToken}
              type="button"
            >
              Create a token →
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface TokenPanelProps {
  busy: Busy;
  disabled: boolean;
  onConnect: () => void;
  onCreateToken: () => void;
  onProviderChange: (provider: TokenProvider) => void;
  onTokenChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTokenHostChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onTokenKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  token: string;
  tokenHost: string;
  tokenProvider: TokenProvider;
}

function TokenPanel({
  busy,
  disabled,
  onConnect,
  onCreateToken,
  onProviderChange,
  onTokenChange,
  onTokenHostChange,
  onTokenKeyDown,
  token,
  tokenHost,
  tokenProvider,
}: TokenPanelProps) {
  const onSelectGithub = useCallback(
    () => onProviderChange("github"),
    [onProviderChange]
  );
  const onSelectGitlab = useCallback(
    () => onProviderChange("gitlab"),
    [onProviderChange]
  );
  const scopeLabel = tokenProvider === "github" ? "repo" : "api";
  const tokenPlaceholder = tokenProvider === "github" ? "ghp_…" : "glpat-…";

  return (
    <>
      <fieldset className="qa-seg mb-4">
        <legend className="qg-label">Provider</legend>
        <label
          className={`qa-seg-btn${tokenProvider === "github" ? "qa-seg-on" : ""}`}
        >
          <input
            checked={tokenProvider === "github"}
            className="sr-only"
            name="token-provider"
            onChange={onSelectGithub}
            type="radio"
            value="github"
          />
          <GitHubMark /> GitHub
        </label>
        <label
          className={`qa-seg-btn${tokenProvider === "gitlab" ? "qa-seg-on" : ""}`}
        >
          <input
            checked={tokenProvider === "gitlab"}
            className="sr-only"
            name="token-provider"
            onChange={onSelectGitlab}
            type="radio"
            value="gitlab"
          />
          <GitLabMark /> GitLab
        </label>
      </fieldset>

      {tokenProvider === "gitlab" ? (
        <>
          <label className="qg-label" htmlFor="qg-token-host">
            Host <span className="qg-label-soft">— empty for gitlab.com</span>
          </label>
          <input
            autoComplete="off"
            className="q-input mb-3 font-mono"
            disabled={disabled}
            id="qg-token-host"
            onChange={onTokenHostChange}
            placeholder="gitlab.com"
            spellCheck={false}
            type="text"
            value={tokenHost}
          />
        </>
      ) : null}

      <label className="qg-label" htmlFor="qg-token">
        Personal access token{" "}
        <span className="qg-label-soft">— {scopeLabel} scope</span>
      </label>
      <input
        autoComplete="off"
        autoFocus
        className="q-input font-mono"
        disabled={disabled}
        id="qg-token"
        onChange={onTokenChange}
        onKeyDown={onTokenKeyDown}
        placeholder={tokenPlaceholder}
        spellCheck={false}
        type="password"
        value={token}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          className="q-btn q-btn-quiet flex-1 py-2"
          disabled={disabled || !token.trim()}
          onClick={onConnect}
          type="button"
        >
          {busy === "pat" ? <Spinner /> : "Connect"}
        </button>
        <button
          className="shrink-0 text-accent text-sm hover:underline"
          onClick={onCreateToken}
          type="button"
        >
          Create a token →
        </button>
      </div>
    </>
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
  const [tokenProvider, setTokenProvider] = useState<TokenProvider>("github");
  const [tokenHost, setTokenHost] = useState("");
  const [token, setToken] = useState("");

  const [ghOauthReady, setGhOauthReady] = useState(true);
  const [glOauthReady, setGlOauthReady] = useState(true);

  useEffect(() => {
    api
      .isOAuthConfigured()
      .then(setGhOauthReady)
      .catch(() => setGhOauthReady(false));
    api
      .isGitlabOAuthConfigured()
      .then(setGlOauthReady)
      .catch(() => setGlOauthReady(false));
  }, []);

  const instances = useMemo<GitlabInstance[]>(() => {
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
  }, [accounts]);

  const reset = useCallback((next: View) => {
    setError(null);
    setBusy("idle");
    setView(next);
  }, []);

  useHotkeys("token", [
    {
      description: "Back",
      group: "Navigation",
      hidden: !hasAccounts && view === "identity",
      keys: "esc",
      run: () => {
        if (view !== "identity") {
          reset("identity");
        } else if (hasAccounts) {
          goInbox();
        }
      },
    },
  ]);

  const finish = useCallback(() => {
    goInbox();
    window.location.reload();
  }, [goInbox]);

  const run = useCallback(
    async (label: string, kind: Busy, action: () => Promise<void>) => {
      if (busy !== "idle") {
        return;
      }
      setBusy(kind);
      setBusyLabel(label);
      setError(null);
      try {
        await action();
      } catch (e) {
        setError(String(e));
        setBusy("idle");
      }
    },
    [busy]
  );

  const signInGithub = useCallback(
    () =>
      run("Waiting for GitHub in your browser…", "oauth", async () => {
        await api.loginWithGithub();
        finish();
      }),
    [finish, run]
  );

  const signInGitlab = useCallback(
    (host?: string, clientId?: string) =>
      run(
        `Waiting for ${shortHost(host ?? "gitlab.com")} in your browser…`,
        "oauth",
        async () => {
          await api.loginWithGitlab({
            clientId: clientId ?? null,
            host: host ?? null,
          });
          if (host) {
            saveInstance({ clientId, host });
          }
          finish();
        }
      ),
    [finish, run]
  );

  const openInstance = useCallback(
    (inst: GitlabInstance) => {
      if (inst.clientId) {
        runPromise(signInGitlab(inst.host, inst.clientId));
      } else {
        setHostInput(shortHost(inst.host));
        setProbedHost(inst.host);
        setAppId("");
        setToken("");
        reset("selfhosted");
      }
    },
    [reset, signInGitlab]
  );

  const probe = useCallback(
    () =>
      run("Checking the instance…", "probe", async () => {
        const normalized = await api.probeGitlab(hostInput);
        setProbedHost(normalized);
        setBusy("idle");
      }),
    [hostInput, run]
  );

  const connectToken = useCallback(
    (provider: TokenProvider, host: string | null) =>
      run("Checking the token…", "pat", async () => {
        await api.addAccount({ host, provider, token: token.trim() });
        if (provider === "gitlab" && host) {
          saveInstance({ host });
        }
        finish();
      }),
    [finish, run, token]
  );

  const disabled = busy !== "idle";
  const knownId = probedHost
    ? instances.find((i) => i.host === probedHost)?.clientId
    : undefined;
  const oauthId = appId.trim() || knownId;
  const tokenConnectHost =
    tokenProvider === "gitlab" ? tokenHost.trim() || null : null;

  const onSignInGithub = useCallback(() => {
    runPromise(signInGithub());
  }, [signInGithub]);

  const onSignInGitlabDefault = useCallback(() => {
    runPromise(signInGitlab());
  }, [signInGitlab]);

  const onSelfHosted = useCallback(() => {
    setHostInput("");
    setProbedHost(null);
    setAppId("");
    setToken("");
    reset("selfhosted");
  }, [reset]);

  const onUseToken = useCallback(() => {
    setToken("");
    reset("token");
  }, [reset]);

  const onHostInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setHostInput(event.target.value);
      setProbedHost(null);
    },
    []
  );

  const onHostKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !probedHost) {
        event.preventDefault();
        runPromise(probe());
      } else if (event.key === "Escape") {
        event.preventDefault();
        reset("identity");
      }
    },
    [probe, probedHost, reset]
  );

  const onProbe = useCallback(() => {
    runPromise(probe());
  }, [probe]);

  const onSelfHostedSignInGitlab = useCallback(() => {
    if (probedHost && oauthId) {
      runPromise(signInGitlab(probedHost, oauthId));
    }
  }, [oauthId, probedHost, signInGitlab]);

  const onAppIdChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setAppId(event.target.value);
  }, []);

  const onSelfHostedTokenChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setToken(event.target.value);
    },
    []
  );

  const onSelfHostedTokenKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && probedHost) {
        event.preventDefault();
        runPromise(connectToken("gitlab", probedHost));
      } else if (event.key === "Escape") {
        event.preventDefault();
        reset("identity");
      }
    },
    [connectToken, probedHost, reset]
  );

  const onConnectGitlabToken = useCallback(() => {
    if (probedHost) {
      runPromise(connectToken("gitlab", probedHost));
    }
  }, [connectToken, probedHost]);

  const onSelfHostedCreateToken = useCallback(() => {
    if (probedHost) {
      runPromise(openUrl(glTokenUrl(probedHost)));
    }
  }, [probedHost]);

  const onProviderChange = useCallback((provider: TokenProvider) => {
    setTokenProvider(provider);
  }, []);

  const onTokenHostChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setTokenHost(event.target.value);
    },
    []
  );

  const onTokenInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setToken(event.target.value);
    },
    []
  );

  const onTokenKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runPromise(connectToken(tokenProvider, tokenConnectHost));
      } else if (event.key === "Escape") {
        event.preventDefault();
        reset("identity");
      }
    },
    [connectToken, reset, tokenConnectHost, tokenProvider]
  );

  const onTokenConnect = useCallback(() => {
    runPromise(connectToken(tokenProvider, tokenConnectHost));
  }, [connectToken, tokenConnectHost, tokenProvider]);

  const onTokenCreateToken = useCallback(() => {
    const url =
      tokenProvider === "github"
        ? GH_TOKEN_URL
        : glTokenUrl(
            tokenHost.trim()
              ? `https://${shortHost(tokenHost.trim())}`
              : "https://gitlab.com"
          );
    runPromise(openUrl(url));
  }, [tokenHost, tokenProvider]);

  const onBackToIdentity = useCallback(() => {
    reset("identity");
  }, [reset]);

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div className="qg-card">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="qg-logo" />
          <h1 className="font-semibold text-2xl text-fg">Nod</h1>
          {hasAccounts && view === "identity" ? (
            <button
              className="q-btn q-btn-ghost q-focus ml-auto px-2 py-1 text-xs"
              onClick={goInbox}
              type="button"
            >
              <ArrowLeft aria-hidden size={13} /> Back
            </button>
          ) : null}
        </div>
        <p className="mt-1 mb-6 text-muted text-sm">
          {hasAccounts ? "Add an account" : "Keyboard-first code review"}
        </p>

        {view === "identity" ? (
          <IdentityPanel
            disabled={disabled}
            ghOauthReady={ghOauthReady}
            glOauthReady={glOauthReady}
            instances={instances}
            onOpenInstance={openInstance}
            onSelfHosted={onSelfHosted}
            onSignInGithub={onSignInGithub}
            onSignInGitlab={onSignInGitlabDefault}
            onUseToken={onUseToken}
          />
        ) : null}

        {view === "selfhosted" ? (
          <SelfHostedPanel
            appId={appId}
            busy={busy}
            disabled={disabled}
            hostInput={hostInput}
            oauthId={oauthId}
            onAppIdChange={onAppIdChange}
            onConnectGitlabToken={onConnectGitlabToken}
            onCreateToken={onSelfHostedCreateToken}
            onHostInputChange={onHostInputChange}
            onHostKeyDown={onHostKeyDown}
            onProbe={onProbe}
            onSignInGitlab={onSelfHostedSignInGitlab}
            onTokenChange={onSelfHostedTokenChange}
            onTokenKeyDown={onSelfHostedTokenKeyDown}
            probedHost={probedHost}
            token={token}
          />
        ) : null}

        {view === "token" ? (
          <TokenPanel
            busy={busy}
            disabled={disabled}
            onConnect={onTokenConnect}
            onCreateToken={onTokenCreateToken}
            onProviderChange={onProviderChange}
            onTokenChange={onTokenInputChange}
            onTokenHostChange={onTokenHostChange}
            onTokenKeyDown={onTokenKeyDown}
            token={token}
            tokenHost={tokenHost}
            tokenProvider={tokenProvider}
          />
        ) : null}

        {busy === "oauth" ? (
          <p className="mt-3 text-center text-muted text-xs">{busyLabel}</p>
        ) : null}
        {error === null ? null : (
          <p className="mt-3 break-words text-danger text-sm">{error}</p>
        )}

        {view === "identity" ? null : (
          <button
            className="qg-link q-focus mt-5"
            onClick={onBackToIdentity}
            type="button"
          >
            <ArrowLeft aria-hidden size={12} /> All sign-in options
          </button>
        )}
        <p className="mt-4 text-center text-faint text-xs">
          Tokens stay on this device; sign-ins open your browser.
        </p>
      </div>
    </div>
  );
}
