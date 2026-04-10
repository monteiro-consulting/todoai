import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    hmr: {
      protocol: "ws",
      host: "localhost",
      port: 1420,
    },
    watch: {
      usePolling: true,
      interval: 500,
    },
    proxy: {
      "/api/terminal/ws": {
        target: "ws://127.0.0.1:18427",
        ws: true,
      },
      "/api": {
        target: "http://127.0.0.1:18427",
        changeOrigin: true,
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
