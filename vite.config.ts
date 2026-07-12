import { defineConfig } from "vite";

// Telegram Mini Apps are served over HTTPS from a static host.
// base: "./" keeps asset paths relative so the build works from any subpath.
export default defineConfig({
  base: "./",
  // @ton/core references a global `Buffer` (BOC base64/hex). We polyfill it at
  // the top of main.ts; pre-bundle the package so dev + build resolve it.
  optimizeDeps: { include: ["buffer"] },
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: "es2020",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
  },
});
