import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { forkDesign } from "@pako_krc/forkdesign/plugin";

// The design lab is a plain browser app (no Tauri). It runs on its own port so
// it can sit side-by-side with the desktop dev server.
//
// forkDesign() is dev-only: comment on a running component and the feedback is
// written back into the source as a reviewable diff, plus AI-generated variants.
// It lives in the design lab only — never in the desktop app.
// https://vite.dev/config/
export default defineConfig({
  plugins: [forkDesign(), react(), tailwindcss()],
  server: {
    port: 1430,
    strictPort: true,
  },
});
