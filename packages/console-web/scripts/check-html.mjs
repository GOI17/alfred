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
const required = [
  "<title>", "setKey", "loadTenants", "issueKey", "loadKeys", "ALFRED_API_BASE",
  "sessionApiKey", "toggleApiKeyVisibility", "copyApiKey", "logout",
  'localStorage.removeItem("alfred_api_key")',
  "g-6a320e87e6908191a3f834b273221f99-alfred",
  "Do not open the GPT editor or fill in Client ID or Client Secret",
  "already configured inside the published Alfred GPT"
];
for (const r of required) {
  if (!text.includes(r)) {
    console.error("Missing in src/index.html: " + r);
    process.exit(1);
  }
}

for (const forbidden of ["Operator: configure a separate Custom GPT", "ALFRED_OAUTH_CLIENT_SECRET"]) {
  if (text.includes(forbidden)) {
    console.error("Operator-only OAuth configuration leaked into the tenant UI: " + forbidden);
    process.exit(1);
  }
}

const declaredIds = new Set([...text.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
const referencedIds = new Set([...text.matchAll(/getElementById\(["']([^"']+)["']\)/g)].map((match) => match[1]));
const missingIds = [...referencedIds].filter((id) => !declaredIds.has(id));
if (missingIds.length > 0) {
  console.error("JavaScript references missing HTML id(s): " + missingIds.join(", "));
  process.exit(1);
}
console.log("src/index.html OK (" + text.length + " bytes)");
