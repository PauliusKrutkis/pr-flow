import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The design lab is a plain browser app (no Tauri). It runs on its own port so
// it can sit side-by-side with the desktop dev server.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 1430,
    strictPort: true,
  },
});
