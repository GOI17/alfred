#!/usr/bin/env node
// Phase 12 validator. Confirms the four foundational documents exist,
// parse, and reference each other consistently.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const checks = [];

function assertFile(rel, desc) {
  const abs = resolve(root, rel);
  const ok = existsSync(abs);
  checks.push({ ok, rel, desc });
  return ok;
}

function assertReferencedBy(rel, mustContain, desc) {
  const abs = resolve(root, rel);
  if (!existsSync(abs)) {
    checks.push({ ok: false, rel, desc });
    return false;
  }
  const text = readFileSync(abs, "utf8");
  const missing = mustContain.filter((needle) => !text.includes(needle));
  const ok = missing.length === 0;
  checks.push({ ok, rel, desc, missing });
  return ok;
}

console.log("Phase 12: Memory Hosting Policies Validation");
console.log("==========================================");

assertFile(".ai/architecture/memory-hosting-modes.md", "memory-hosting-modes.md exists");
assertFile(".ai/policies/memory-hosting-policy.md", "memory-hosting-policy.md exists");
assertFile(".ai/policies/memory-workspace-policy.md", "memory-workspace-policy.md exists");
assertFile(".ai/roadmaps/0.3.0.json", "0.3.0.json exists");
assertFile(".ai/roadmaps/0.3.0.md", "0.3.0.md exists");

// Cross-references
assertReferencedBy(
  ".ai/context.md",
  ["memory-hosting-modes.md", "memory-hosting-policy.md", "memory-workspace-policy.md"],
  "context.md references the three new docs"
);
assertReferencedBy(
  ".ai/policies/memory-hosting-policy.md",
  ["memory-workspace-policy.md", "memory-hosting-modes.md"],
  "hosting-policy references workspace-policy and modes"
);
assertReferencedBy(
  ".ai/policies/memory-workspace-policy.md",
  ["memory-hosting-policy.md"],
  "workspace-policy references hosting-policy"
);
assertReferencedBy(
  ".ai/architecture/memory-hosting-modes.md",
  ["memory-hosting-policy.md", "memory-workspace-policy.md"],
  "modes references both policies"
);
assertReferencedBy(
  ".ai/roadmaps/0.3.0.json",
  ["phase-12-docs-foundation", "phase-13-alfred-registry", "phase-24-release-0.3.0"],
  "0.3.0.json references core phases"
);

// Validate JSON
try {
  JSON.parse(readFileSync(resolve(root, ".ai/roadmaps/0.3.0.json"), "utf8"));
  checks.push({ ok: true, rel: ".ai/roadmaps/0.3.0.json", desc: "0.3.0.json is valid JSON" });
} catch (e) {
  checks.push({ ok: false, rel: ".ai/roadmaps/0.3.0.json", desc: "0.3.0.json must be valid JSON", error: e.message });
}

try {
  const m = JSON.parse(readFileSync(resolve(root, ".ai/manifest.json"), "utf8"));
  const sot = m.source_of_truth || {};
  const expected = ["memory_hosting_modes", "memory_hosting_policy", "memory_workspace_policy"];
  const missing = expected.filter((k) => !sot[k]);
  checks.push({
    ok: missing.length === 0,
    rel: ".ai/manifest.json",
    desc: "manifest.json source_of_truth includes the three new keys",
    missing
  });
} catch (e) {
  checks.push({ ok: false, rel: ".ai/manifest.json", desc: "manifest.json must be valid JSON", error: e.message });
}

let failed = 0;
for (const c of checks) {
  const mark = c.ok ? "OK " : "FAIL";
  let line = `  [${mark}] ${c.rel} -- ${c.desc}`;
  if (!c.ok && c.missing) line += ` missing: ${c.missing.join(", ")}`;
  if (!c.ok && c.error) line += ` error: ${c.error}`;
  console.log(line);
  if (!c.ok) failed += 1;
}

console.log("==========================================");
if (failed > 0) {
  console.error(`FAIL: ${failed} check(s) failed.`);
  process.exit(1);
} else {
  console.log(`PASS: ${checks.length} checks passed.`);
}
