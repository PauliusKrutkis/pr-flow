// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import tailwindcss from "@tailwindcss/vite";
// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import react from "@vitejs/plugin-react";
// biome-ignore lint/correctness/noUnresolvedImports: Biome cannot resolve pnpm-linked package exports
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  clearScreen: false,
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", {}]],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "zustand"],
  },
  server: {
    hmr: host
      ? {
          host,
          port: 1421,
          protocol: "ws",
        }
      : undefined,
    host,
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
