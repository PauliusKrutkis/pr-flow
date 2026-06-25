import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api } from "../lib/api";
import { cn } from "../lib/cn";
import { Spinner } from "./ui/Spinner";

const CREATE_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=PR%20Flow";

export function TokenGate({
  onAuthenticated,
}: {
  onAuthenticated: () => void;
}) {
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    const trimmed = token.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      await api.setToken(trimmed);
      onAuthenticated();
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-8 shadow-lg">
        <h1 className="text-2xl font-semibold text-fg">PR Flow</h1>
        <p className="mt-1 text-sm text-muted">
          Keyboard-first GitHub PR review
        </p>

        <p className="mt-6 text-sm text-muted">
          Connect with a GitHub Personal Access Token that has the{" "}
          <code className="rounded bg-elevated px-1.5 py-0.5 font-mono text-xs text-fg">
            repo
          </code>{" "}
          scope.
        </p>

        <div className="mt-5">
          <input
            type="password"
            autoFocus
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
            className="w-full rounded-card border border-line bg-bg px-3 py-2 font-mono text-sm text-fg outline-none placeholder:text-faint focus:border-accent"
          />
          <p className="mt-1.5 text-xs text-faint">
            Stored locally on this device.
          </p>
        </div>

        {error ? (
          <p className="mt-3 break-words text-sm text-danger">{error}</p>
        ) : null}

        <button
          type="button"
          onClick={() => void connect()}
          disabled={loading || !token.trim()}
          className={cn(
            "mt-5 inline-flex w-full items-center justify-center gap-2 rounded-card px-3 py-2 text-sm font-medium",
            "bg-accent text-accent-fg transition-opacity",
            (loading || !token.trim()) && "cursor-not-allowed opacity-50",
          )}
        >
          {loading ? <Spinner /> : "Connect"}
        </button>

        <button
          type="button"
          onClick={() => void openUrl(CREATE_TOKEN_URL)}
          className="mt-4 text-sm text-accent hover:underline"
        >
          Create a token →
        </button>
      </div>
    </div>
  );
}
