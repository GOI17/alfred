#!/usr/bin/env node
// Sanity check: src/index.html parses as JSON-ish (well, it's HTML but we can
// load it as text and check it has the key elements).
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const path = join(here, "..", "src", "index.html");
if (!existsSync(path)) {
  console.error("Missing src/index.html");
  process.exit(1);
}
const text = readFileSync(path, "utf8");
const required = ["<title>", "setKey", "loadTenants", "issueKey", "loadKeys", "ALFRED_API_BASE"];
for (const r of required) {
  if (!text.includes(r)) {
    console.error("Missing in src/index.html: " + r);
    process.exit(1);
  }
}
console.log("src/index.html OK (" + text.length + " bytes)");
