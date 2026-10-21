#!/usr/bin/env node
// Loopback static preview only; use alfred serve for working same-origin APIs.
// Listens on port 4321 by default; override with PORT env.
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
    "content-type": type
  });
  res.end(readFileSync(filePath));
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`console-web dev server: http://127.0.0.1:${PORT}\n`);
});
