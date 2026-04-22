import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// TUNABLE: custom domain -> site: "https://<domain>", base: "/", add public/CNAME
export default defineConfig({
  site: "https://rle-mino.github.io",
  base: "/cadence/",
  trailingSlash: "ignore",
  integrations: [mdx(), sitemap()],
  vite: { plugins: [tailwindcss()] },
  build: { format: "directory" },
});
