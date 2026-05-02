// Tiny static server for the e2e suite. Serves the production-built
// SPA from dist/public with index.html fallback so client-side routes
// like /invoice-groups/:id resolve. Mirrors the pattern used by
// artifacts/training-guide/serve-dev.mjs.
//
// We can't reuse the project's dev workflow for e2e because it runs
// `vite` in dev mode with the cartographer plugin enabled, which
// currently fails to transform a couple of unrelated pages
// (insights.tsx, withdrawals.tsx) and pollutes the bundle with
// errors. The production build skips cartographer cleanly.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(__dirname, "..", "dist", "public");
const port = Number(process.env.PORT) || 5174;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

const indexHtml = readFileSync(join(distDir, "index.html"), "utf-8");

const server = createServer((req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    const filePath = join(distDir, url.pathname);

    if (
      url.pathname !== "/" &&
      existsSync(filePath) &&
      statSync(filePath).isFile()
    ) {
      const ext = extname(filePath);
      res.writeHead(200, {
        "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(readFileSync(filePath));
    } else {
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Cache-Control": "no-cache",
      });
      res.end(indexHtml);
    }
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(String(err));
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`E2E static server listening on http://0.0.0.0:${port}/`);
});
