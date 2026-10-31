import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Inline config stops Vite from walking up to the web app's postcss.config.mjs.
  css: { postcss: { plugins: [] } },
  server: { port: 1420, strictPort: true },
  build: { target: "es2021", outDir: "dist" },
});
