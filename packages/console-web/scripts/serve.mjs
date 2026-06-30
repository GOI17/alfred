#!/usr/bin/env node
// Local dev server. Serves src/ as static files, with CORS for cross-origin
// testing. Listens on port 4321 by default; override with PORT env.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(here, "..", "src");
const PORT = Number(process.env.PORT ?? 4321);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".png":  "image/png"
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let p = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = join(SRC_DIR, p);
  if (!existsSync(filePath)) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("Not found");
    return;
  }
  const ext = extname(filePath);
  const type = MIME[ext] ?? "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "access-control-allow-origin": "*"
  });
  res.end(readFileSync(filePath));
});

server.listen(PORT, () => {
  process.stdout.write(`console-web dev server: http://localhost:${PORT}\n`);
});
