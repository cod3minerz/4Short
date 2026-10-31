import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The desktop app mounts the REAL product dashboard (components/ui primitives,
// components/hashpix compositions, app/dashboard views) so it cannot drift from
// the site's design system. Only the three Next.js modules the dashboard uses
// are replaced by small shims; no dashboard source is modified.
const repo = fileURLToPath(new URL("../..", import.meta.url));
const shim = (name: string) => fileURLToPath(new URL(`./src/shims/${name}`, import.meta.url));

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  publicDir: `${repo}public`,
  resolve: {
    alias: [
      { find: /^next\/link$/, replacement: shim("next-link.tsx") },
      { find: /^next\/navigation$/, replacement: shim("next-navigation.ts") },
      { find: /^next\/image$/, replacement: shim("next-image.tsx") },
      { find: /^@\//, replacement: repo },
    ],
    dedupe: ["react", "react-dom"],
  },
  define: {
    "process.env.NEXT_PUBLIC_CONTROL_API_URL": JSON.stringify(""),
    "process.env.NEXT_PUBLIC_DEVELOPMENT_USER_ID": "undefined",
  },
  server: { port: 1420, strictPort: true, fs: { allow: [repo] } },
  build: { target: "es2021", outDir: "dist" },
});
