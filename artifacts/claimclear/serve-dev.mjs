import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = join(__dirname, "dist", "public");
const port = Number(process.env.PORT) || 5173;

const MIME_TYPES = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const indexHtml = readFileSync(join(distDir, "index.html"), "utf-8");

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const filePath = join(distDir, url.pathname);

  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const ext = extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(readFileSync(filePath));
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(indexHtml);
  }
});

server.on("error", (err) => {
  console.error("Server error:", err.message);
  if (err.code === "EADDRINUSE") {
    console.log(`Port ${port} in use, retrying in 1s...`);
    setTimeout(() => server.listen(port, "0.0.0.0"), 1000);
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`ClaimClear dev server listening on http://0.0.0.0:${port}/`);
});
