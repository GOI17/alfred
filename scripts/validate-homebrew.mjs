#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { renderFormula, writeFormulaAtomic } from "./generate-homebrew-formula.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const installer = readFileSync(join(root, "install.sh"), "utf8");
const installDocs = readFileSync(join(root, "site/docs/install.html"), "utf8");
const installPolicy = readFileSync(join(root, ".ai/instructions/install-management.md"), "utf8");
const specification = readFileSync(join(root, ".ai/execution/homebrew-installation.md"), "utf8");

assert.equal(manifest.version, "0.5.0");
assert.match(installer, /^VERSION="0\.5\.0"$/m);
for (const text of [installDocs, installPolicy, specification]) {
  const searchableText = text.replace(/<[^>]+>/g, "");
  assert.match(searchableText, /brew install GOI17\/tap\/alfred/);
  assert.match(searchableText, /preview-first/i);
}

const cli = spawnSync(
  process.execPath,
  [join(root, "packages/memory-server/scripts/alfred.mjs"), "version"],
  { encoding: "utf8", cwd: root }
);
assert.equal(cli.status, 0, cli.stderr);
assert.equal(cli.stdout.trim(), "alfred 0.5.0");

const preview = spawnSync(
  "sh",
  [join(root, "install.sh"), "--edition=coding", "--name=brew-validation", "--harness=none"],
  { encoding: "utf8", cwd: root }
);
assert.equal(preview.status, 0, preview.stderr);
assert.match(preview.stdout, /ALFRED SUITE INSTALL PREVIEW/);
assert.match(preview.stdout, /Version:\s+0\.5\.0/);
assert.match(preview.stdout, /Provider calls: 0/);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "alfred-homebrew-validation-"));
try {
  const formulaPath = join(temporaryDirectory, "Formula", "alfred.rb");
  const formula = renderFormula({
    source: "git",
    version: "0.5.0",
    revision: "a".repeat(40)
  });
  writeFormulaAtomic(formulaPath, formula);
  const ruby = spawnSync("ruby", ["-c", formulaPath], { encoding: "utf8" });
  assert.equal(ruby.status, 0, `${ruby.stdout}${ruby.stderr}`);
  assert.match(ruby.stdout, /Syntax OK/);
  assert.match(formula, /--no-clone/);
  assert.match(formula, /depends_on "node"/);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({
  status: "pass",
  version: manifest.version,
  formula_modes: ["git-revision", "archive-sha256"],
  commands: ["alfred", "alfred-install"],
  provider_calls: 0
})}\n`);
