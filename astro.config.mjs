import { defineConfig } from "astro/config";

// Polaris UI: static build, served by Fastify (@fastify/static).
// See ADR-0009 for the rationale (vs SSR via @astrojs/node).
export default defineConfig({
  srcDir: "./src/ui",
  publicDir: "./src/ui/public",
  outDir: "./dist/ui",
  output: "static",
  build: {
    assets: "_polaris",
    inlineStylesheets: "auto",
  },
  vite: {
    // Astro defaults to picking up the project's tsconfig — we keep our strict
    // settings (noUncheckedIndexedAccess etc.) which can trip on Astro's own
    // generated code. Limit type-checking to our explicit src/**/*.ts include.
    esbuild: {
      target: "es2022",
    },
  },
});
