import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { KeyboardProvider } from "./keyboard/KeyboardProvider.tsx";
import { queryClient } from "./lib/queryClient.ts";

import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource-variable/geist-mono";

import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <KeyboardProvider>
        <App />
      </KeyboardProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
