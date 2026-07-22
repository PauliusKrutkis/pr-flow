import { defineConfig } from "astro/config";

// Static-first: this is a content page, so it ships ~zero JS. Styles are
// plain hand-authored CSS in src/styles/global.css — no framework.
export default defineConfig({
  site: "https://nod.pages.dev",
});
