import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// Static-first: this is a content page, so it ships ~zero JS. Tailwind v4 is
// wired through its Vite plugin (same setup the desktop app uses), and styles
// live in src/styles/global.css.
export default defineConfig({
  site: "https://nod.pages.dev",
  vite: {
    plugins: [tailwindcss()],
  },
});
