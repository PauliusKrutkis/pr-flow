import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { forkDesign } from "@pako_krc/forkdesign/plugin";

export default defineConfig({
  plugins: [forkDesign(), react(), tailwindcss()],
  server: {
    port: 1430,
    strictPort: true,
  },
});
