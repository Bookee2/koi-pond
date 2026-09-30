import { defineConfig } from "vite";

export default defineConfig({
  // Served from https://bookee2.github.io/koi-pond/ on GitHub Pages.
  base: process.env.GITHUB_ACTIONS ? "/koi-pond/" : "/",
  server: { port: 5178 },
  build: { target: "esnext" },
});
