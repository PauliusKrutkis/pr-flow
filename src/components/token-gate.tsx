import { ArrowLeft, KeyRound, Server } from "lucide-react";
import { type ChangeEvent, type KeyboardEvent, useEffect, useRef } from "react";
import {
  type Busy,
  type GitlabInstance,
  shortHost,
  type TokenProvider,
  useTokenGate,
} from "../hooks/use-token-gate.ts";
import { Spinner } from "./ui/spinner.tsx";

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
  const onClick = () => {
    onOpen(inst);
  };

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
  const hostInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => hostInputRef.current?.focus());
  }, []);

  return (
    <>
      <label className="qg-label" htmlFor="qg-host">
        GitLab host
      </label>
      <div className="flex gap-2">
        <input
          autoComplete="off"
          className="q-input font-mono"
          disabled={disabled}
          id="qg-host"
          onChange={onHostInputChange}
          onKeyDown={onHostKeyDown}
          placeholder="gitlab.yourcompany.com"
          ref={hostInputRef}
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
            aria-label="Personal access token"
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
  const onSelectGithub = () => {
    onProviderChange("github");
  };
  const onSelectGitlab = () => {
    onProviderChange("gitlab");
  };
  const scopeLabel = tokenProvider === "github" ? "repo" : "api";
  const tokenPlaceholder = tokenProvider === "github" ? "ghp_…" : "glpat-…";
  const tokenInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => tokenInputRef.current?.focus());
  }, []);

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
        className="q-input font-mono"
        disabled={disabled}
        id="qg-token"
        onChange={onTokenChange}
        onKeyDown={onTokenKeyDown}
        placeholder={tokenPlaceholder}
        ref={tokenInputRef}
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

function TokenGateScreen() {
  const gate = useTokenGate();
  const gateError: string | null = gate.error;

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div className="qg-card">
        <div className="flex items-center gap-2.5">
          <span aria-hidden className="qg-logo" />
          <h1 className="font-semibold text-2xl text-fg">Nod</h1>
          {gate.view === "identity" && gate.accounts.length > 0 ? (
            <button
              className="q-btn q-btn-ghost q-focus ml-auto px-2 py-1 text-xs"
              onClick={gate.onGoInbox}
              type="button"
            >
              <ArrowLeft aria-hidden size={13} /> Back
            </button>
          ) : null}
        </div>
        <p className="mt-1 mb-6 text-muted text-sm">
          {gate.accounts.length > 0
            ? "Add an account"
            : "Keyboard-first code review"}
        </p>

        {gate.view === "identity" ? (
          <IdentityPanel
            disabled={gate.disabled}
            ghOauthReady={gate.ghOauthReady}
            glOauthReady={gate.glOauthReady}
            instances={gate.instances}
            onOpenInstance={gate.onOpenInstance}
            onSelfHosted={gate.onSelfHosted}
            onSignInGithub={gate.onSignInGithub}
            onSignInGitlab={gate.onSignInGitlab}
            onUseToken={gate.onUseToken}
          />
        ) : null}

        {gate.view === "selfhosted" ? (
          <SelfHostedPanel
            appId={gate.appId}
            busy={gate.busy}
            disabled={gate.disabled}
            hostInput={gate.hostInput}
            oauthId={gate.oauthId}
            onAppIdChange={gate.onAppIdChange}
            onConnectGitlabToken={gate.onConnectGitlabToken}
            onCreateToken={gate.onCreateSelfHostedToken}
            onHostInputChange={gate.onHostInputChange}
            onHostKeyDown={gate.onHostKeyDown}
            onProbe={gate.onProbe}
            onSignInGitlab={gate.onSelfHostedSignInGitlab}
            onTokenChange={gate.onSelfHostedTokenChange}
            onTokenKeyDown={gate.onSelfHostedTokenKeyDown}
            probedHost={gate.probedHost}
            token={gate.token}
          />
        ) : null}

        {gate.view === "token" ? (
          <TokenPanel
            busy={gate.busy}
            disabled={gate.disabled}
            onConnect={gate.onConnectToken}
            onCreateToken={gate.onCreateToken}
            onProviderChange={gate.onProviderChange}
            onTokenChange={gate.onTokenChange}
            onTokenHostChange={gate.onTokenHostChange}
            onTokenKeyDown={gate.onTokenKeyDown}
            token={gate.token}
            tokenHost={gate.tokenHost}
            tokenProvider={gate.tokenProvider}
          />
        ) : null}

        {gate.busy === "oauth" ? (
          <p className="mt-3 text-center text-muted text-xs">
            {gate.busyLabel}
          </p>
        ) : null}
        {gateError ? (
          <p className="mt-3 break-words text-danger text-sm">{gateError}</p>
        ) : null}

        {gate.view === "identity" ? null : (
          <button
            className="qg-link q-focus mt-5"
            onClick={gate.onBackToIdentity}
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

export function TokenGate() {
  return <TokenGateScreen />;
}
