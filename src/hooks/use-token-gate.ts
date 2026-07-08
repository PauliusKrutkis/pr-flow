import { openUrl } from "@tauri-apps/plugin-opener";
import {
  type ChangeEvent,
  type KeyboardEvent,
  useEffect,
  useState,
} from "react";
import { useHotkeys } from "../keyboard/use-hotkeys.ts";
import { api } from "../lib/api.ts";
import { useAppStore } from "../store/app-store.ts";

type View = "identity" | "selfhosted" | "token";
export type Busy = "idle" | "oauth" | "probe" | "pat";
export type TokenProvider = "github" | "gitlab";

/** Remembered self-hosted instances (host + optional OAuth application id). */
export interface GitlabInstance {
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

export { shortHost };

function glTokenUrl(host: string): string {
  return `${host}/-/user_settings/personal_access_tokens?name=Nod&scopes=api`;
}

function runPromise(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

export function useTokenGate() {
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

  const instances = (() => {
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

  const reset = (next: View) => {
    setError(null);
    setBusy("idle");
    setView(next);
  };

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

  const finish = () => {
    goInbox();
    window.location.reload();
  };

  const run = async (
    label: string,
    kind: Busy,
    action: () => Promise<void>
  ) => {
    if (busy !== "idle") {
      return;
    }
    setBusy(kind);
    setBusyLabel(label);
    setError(null);
    try {
      await action();
      setBusy("idle");
    } catch (e) {
      setError(String(e));
      setBusy("idle");
    }
  };

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
        await api.loginWithGitlab({
          clientId: clientId ?? null,
          host: host ?? null,
        });
        if (host) {
          saveInstance({ clientId, host });
        }
        finish();
      }
    );

  const openInstance = (inst: GitlabInstance) => {
    if (inst.clientId) {
      runPromise(signInGitlab(inst.host, inst.clientId));
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
    });

  const connectToken = (provider: TokenProvider, host: string | null) =>
    run("Checking the token…", "pat", async () => {
      await api.addAccount({ host, provider, token: token.trim() });
      if (provider === "gitlab" && host) {
        saveInstance({ host });
      }
      finish();
    });

  const disabled = busy !== "idle";
  const knownId = probedHost
    ? instances.find((i) => i.host === probedHost)?.clientId
    : undefined;
  const oauthId = appId.trim() || knownId;
  const tokenConnectHost =
    tokenProvider === "gitlab" ? tokenHost.trim() || null : null;

  return {
    accounts,
    appId,
    busy,
    busyLabel,
    disabled,
    error,
    ghOauthReady,
    glOauthReady,
    hasAccounts,
    hostInput,
    instances,
    oauthId,
    onAppIdChange: (event: ChangeEvent<HTMLInputElement>) => {
      setAppId(event.target.value);
    },
    onBackToIdentity: () => {
      reset("identity");
    },
    onConnectGitlabToken: () => {
      if (probedHost) {
        runPromise(connectToken("gitlab", probedHost));
      }
    },
    onConnectToken: () => {
      runPromise(connectToken(tokenProvider, tokenConnectHost));
    },
    onCreateSelfHostedToken: () => {
      if (probedHost) {
        runPromise(openUrl(glTokenUrl(probedHost)));
      }
    },
    onCreateToken: () => {
      const url =
        tokenProvider === "github"
          ? GH_TOKEN_URL
          : glTokenUrl(
              tokenHost.trim()
                ? `https://${shortHost(tokenHost.trim())}`
                : "https://gitlab.com"
            );
      runPromise(openUrl(url));
    },
    onGoInbox: goInbox,
    onHostInputChange: (event: ChangeEvent<HTMLInputElement>) => {
      setHostInput(event.target.value);
      setProbedHost(null);
    },
    onHostKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !probedHost) {
        event.preventDefault();
        runPromise(probe());
      } else if (event.key === "Escape") {
        event.preventDefault();
        reset("identity");
      }
    },
    onOpenInstance: openInstance,
    onProbe: () => {
      runPromise(probe());
    },
    onProviderChange: (provider: TokenProvider) => {
      setTokenProvider(provider);
    },
    onSelfHosted: () => {
      setHostInput("");
      setProbedHost(null);
      setAppId("");
      setToken("");
      reset("selfhosted");
    },
    onSelfHostedSignInGitlab: () => {
      if (probedHost && oauthId) {
        runPromise(signInGitlab(probedHost, oauthId));
      }
    },
    onSelfHostedTokenChange: (event: ChangeEvent<HTMLInputElement>) => {
      setToken(event.target.value);
    },
    onSelfHostedTokenKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && probedHost) {
        event.preventDefault();
        runPromise(connectToken("gitlab", probedHost));
      } else if (event.key === "Escape") {
        event.preventDefault();
        reset("identity");
      }
    },
    onSignInGithub: () => {
      runPromise(signInGithub());
    },
    onSignInGitlab: () => {
      runPromise(signInGitlab());
    },
    onTokenChange: (event: ChangeEvent<HTMLInputElement>) => {
      setToken(event.target.value);
    },
    onTokenHostChange: (event: ChangeEvent<HTMLInputElement>) => {
      setTokenHost(event.target.value);
    },
    onTokenKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runPromise(connectToken(tokenProvider, tokenConnectHost));
      } else if (event.key === "Escape") {
        event.preventDefault();
        reset("identity");
      }
    },
    onUseToken: () => {
      setToken("");
      reset("token");
    },
    probedHost,
    token,
    tokenHost,
    tokenProvider,
    view,
  };
}
