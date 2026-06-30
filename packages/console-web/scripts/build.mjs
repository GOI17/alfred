#!/usr/bin/env node
// Build the console-web SPA for static hosting.
//
// Reads src/index.html and writes dist/index.html, optionally injecting a
// runtime API base URL (from ALFRED_API_BASE env var) and a build version.
//
// Usage:
//   npm run build                      # default API base
//   ALFRED_API_BASE=https://alfred.example.com npm run build

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(here, "..", "src");
const DIST_DIR = join(here, "..", "dist");
const SRC_HTML = join(SRC_DIR, "index.html");
const DIST_HTML = join(DIST_DIR, "index.html");

const API_BASE = process.env.ALFRED_API_BASE ?? "http://localhost:3000";
const BUILD_VERSION = new Date().toISOString().slice(0, 10);

function build() {
  if (!existsSync(SRC_HTML)) {
    process.stderr.write("Missing src/index.html\n");
    process.exit(1);
  }
  if (!existsSync(DIST_DIR)) mkdirSync(DIST_DIR, { recursive: true });
  let html = readFileSync(SRC_HTML, "utf8");

  // Inject API base and version. We do this by replacing a small <meta> tag
  // block. If not present, append before </head>.
  // Inject the API base as a unique <script> block. We use a unique sentinel
  // to avoid matching the inline comment in src/index.html.
  const sentinel = "/* __ALFRED_BUILD_INJECT__ */";
  if (html.includes(sentinel)) {
    // Already injected on a previous build; replace the whole block.
    html = html.replace(
      new RegExp(sentinel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\\s\\S]*?<\/script>", "m"),
      "/* ALFRED_BUILD_INJECTED at build time */\n  " + "window.ALFRED_API_BASE = " + JSON.stringify(API_BASE) + ";\n  " + "window.ALFRED_BUILD_VERSION = " + JSON.stringify(BUILD_VERSION) + ";"
    );
  } else {
    // First build: append the script before </head>.
    const inject = "<!-- " + sentinel + " -->\n<script>\n  " +
                   "window.ALFRED_API_BASE = " + JSON.stringify(API_BASE) + ";\n  " +
                   "window.ALFRED_BUILD_VERSION = " + JSON.stringify(BUILD_VERSION) + ";\n</script>\n";
    html = html.replace("</head>", inject + "</head>");
  }

  writeFileSync(DIST_HTML, html);
  process.stdout.write("Wrote " + DIST_HTML + " (" + html.length + " bytes)\n");
  process.stdout.write("API_BASE: " + API_BASE + "\n");
  process.stdout.write("BUILD_VERSION: " + BUILD_VERSION + "\n");
}

build();
