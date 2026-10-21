#!/usr/bin/env node

import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(root, process.env.SITE_OUTPUT_DIR ?? "dist/cloudflare-pages");
const rawBasePath = (process.env.SITE_BASE_PATH ?? "/").trim() || "/";
const basePath = rawBasePath === "/"
  ? "/"
  : `${rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`}`.replace(/\/+$/, "") + "/";

const required = [
  "index.html",
  "assets/styles.css",
  "assets/favicon.svg",
  "docs/index.html",
  "docs/install.html",
  "memory/index.html",
  "memory/app/index.html",
  "support/index.html",
  "terms/index.html",
  "_headers",
  "_redirects"
];

for (const file of required) await access(join(outputDir, file));

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return nested.flat();
}

const htmlFiles = (await listFiles(outputDir)).filter((file) => file.endsWith(".html"));
const problems = [];
for (const file of htmlFiles) {
  const text = await readFile(file, "utf8");
  if (basePath === "/" && text.includes("/alfred/")) {
    problems.push(`${relative(outputDir, file)} still contains /alfred/`);
  }

  const references = text.matchAll(/\b(?:href|src)="([^"]+)"/g);
  for (const match of references) {
    const reference = match[1];
    if (!reference.startsWith(basePath)) continue;
    const withoutFragment = reference.split(/[?#]/, 1)[0];
    const relativeReference = withoutFragment.slice(basePath.length);
    let target = resolve(outputDir, relativeReference);
    if (withoutFragment.endsWith("/") || relativeReference === "") target = join(target, "index.html");
    if (target !== outputDir && !target.startsWith(`${outputDir}${sep}`)) {
      problems.push(`${relative(outputDir, file)} contains an unsafe path: ${reference}`);
      continue;
    }
    try {
      await access(target);
    } catch {
      problems.push(`${relative(outputDir, file)} links to missing ${reference}`);
    }
  }
}

const consoleHtml = await readFile(join(outputDir, "memory", "app", "index.html"), "utf8");
if (!consoleHtml.includes('data-memory-local-only') || !consoleHtml.includes('alfred serve')) {
  problems.push("memory/app/index.html must explain starting the local Memory server");
}
if (/ALFRED_API_BASE|alfred-labs-memory\.fly\.dev|<script\b|<form\b/.test(consoleHtml)) {
  problems.push("memory/app/index.html must be static local-start instructions, without a live API client");
}

const supportHtml = await readFile(join(outputDir, "support", "index.html"), "utf8");
const termsHtml = await readFile(join(outputDir, "terms", "index.html"), "utf8");
for (const [name, html] of [["support", supportHtml], ["terms", termsHtml]]) {
  if (!html.includes("AlfredLabs")) problems.push(`${name}/index.html does not identify AlfredLabs`);
  if (!html.includes("alfred.support@alfredlabs.org")) {
    problems.push(`${name}/index.html does not contain the canonical Alfred support address`);
  }
}

if (problems.length) {
  process.stderr.write(`${problems.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write(`${JSON.stringify({
  status: "pass",
  output: relative(root, outputDir),
  html_files: htmlFiles.length,
  memory_ui: "local-start-instructions",
  provider_calls: 0
})}\n`);
