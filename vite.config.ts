import { defineConfig } from "vite";

// Telegram Mini Apps are served over HTTPS from a static host.
// base: "./" keeps asset paths relative so the build works from any subpath.
export default defineConfig({
  base: "./",
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
