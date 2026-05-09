import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const port = Number(process.env.PORT) || 5173;
const basePath = process.env.BASE_PATH || "/";

// Cross-surface display timezone (#562). The server reads `DISPLAY_TIMEZONE`
// from `process.env`; we mirror the same env var into the client bundle so
// a single deployment-level variable controls both surfaces and they
// cannot drift. A literal `VITE_DISPLAY_TIMEZONE`, if also set, still wins
// (explicit client override).
//
// Implementation: we expose the value as a dedicated compile-time
// constant `__DISPLAY_TIMEZONE__` via `define`. Reading it through a
// literal global identifier (rather than dotting into
// `import.meta.env.VITE_DISPLAY_TIMEZONE`) makes the substitution
// unambiguous to esbuild/Rollup — there's no optional-chain or
// dynamic-property-access codepath that could cause the client to
// silently fall back when only `DISPLAY_TIMEZONE` is set.
const displayTimezone =
  process.env.VITE_DISPLAY_TIMEZONE ||
  process.env.DISPLAY_TIMEZONE ||
  "America/New_York";
// Also mirror into VITE_DISPLAY_TIMEZONE so dev-mode `import.meta.env`
// reflects the value (Vite reads `process.env.VITE_*` at config load).
process.env.VITE_DISPLAY_TIMEZONE = displayTimezone;

export default defineConfig({
  base: basePath,
  define: {
    __DISPLAY_TIMEZONE__: JSON.stringify(displayTimezone),
  },
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
