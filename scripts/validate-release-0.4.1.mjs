#!/usr/bin/env node
// Release 0.4.1 validator. Runs every test gate listed in
// .ai/evals/regression-gates.json and reports aggregate pass/fail.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const gates = JSON.parse(readFileSync(resolve(root, ".ai/evals/regression-gates.json"), "utf8"));

function run(command) {
  process.stderr.write(`\n$ ${command}\n`);
  const result = spawnSync(command, { stdio: "inherit", shell: true });
  return result.status || 0;
}

let failed = 0;
const results = [];

for (const gate of gates.gates) {
  process.stderr.write(`\n=== ${gate.id} ===\n`);
  if (gate.id === "policy-docs-present") {
    const code = run(gate.command);
    results.push({ id: gate.id, ok: code === 0 });
    if (code !== 0) failed += 1;
    continue;
  }
  // For node --test invocations we run them via the node_modules path.
  // We just execute "node --test path" and check return code + count.
  // shell:true allows brace expansion in test file globs.
  const proc = spawnSync(gate.command, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", shell: true });
  const out = (proc.stdout || "") + (proc.stderr || "");
  const match = out.match(/tests\s+(\d+)/) || out.match(/ℹ tests\s+(\d+)/);
  const testCount = match ? Number(match[1]) : undefined;
  const ok = proc.status === 0 && (gate.expected_test_count === undefined || testCount === gate.expected_test_count);
  results.push({ id: gate.id, ok, tests: testCount, expected: gate.expected_test_count });
  process.stderr.write(out.split("\n").slice(-5).join("\n") + "\n");
  if (!ok) failed += 1;
}

console.log("\n========================================");
console.log("Release 0.4.1 Validation");
console.log("========================================");
for (const r of results) {
  let line = `  [${r.ok ? "OK " : "FAIL"}] ${r.id}`;
  if (r.tests !== undefined) line += ` -- tests: ${r.tests}${r.expected !== undefined ? ` / expected ${r.expected}` : ""}`;
  console.log(line);
}
console.log("========================================");

if (failed > 0) {
  console.error(`FAIL: ${failed} gate(s) failed.`);
  process.exit(1);
} else {
  console.log(`PASS: ${results.length} gates passed.`);
}
