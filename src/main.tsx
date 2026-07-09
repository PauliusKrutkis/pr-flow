import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./app.tsx";
import { KeyboardProvider } from "./keyboard/keyboard-provider.tsx";
import { api } from "./lib/api.ts";
import { queryClient } from "./lib/query-client.ts";
import { normalizeViewedMap } from "./lib/viewed-fingerprint.ts";
import { useAppStore } from "./store/app-store.ts";

import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource-variable/geist-mono";

import "./index.css";

/**
 * Hydrate persisted viewed-file state into the store once, at startup, before
 * React mounts. The Rust side persists opaque JSON, so older installs may hold
 * the legacy `prKey -> string[]` shape — normalizeViewedMap migrates either.
 */
api
  .getViewedMap()
  .then((map) => useAppStore.getState().setViewed(normalizeViewedMap(map)))
  .catch(() => undefined);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <KeyboardProvider>
        <App />
      </KeyboardProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
