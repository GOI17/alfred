#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { renderFormula, writeFormulaAtomic } from "./generate-homebrew-formula.mjs";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const readme = readFileSync(join(root, "README.md"), "utf8");
const context = readFileSync(join(root, ".ai/context.md"), "utf8");
const accessSpecification = readFileSync(join(root, ".ai/execution/homebrew-tap-access.md"), "utf8");
const installer = readFileSync(join(root, "install.sh"), "utf8");
const installDocs = readFileSync(join(root, "site/docs/install.html"), "utf8");
const installPolicy = readFileSync(join(root, ".ai/instructions/install-management.md"), "utf8");
const specification = readFileSync(join(root, ".ai/execution/homebrew-installation.md"), "utf8");
const setupCommand = readFileSync(join(root, "packages/memory-server/scripts/setup.mjs"), "utf8");
const version = manifest.version;
const escapedVersion = version.replaceAll(".", "\\.");

assert.match(version, /^\d+\.\d+\.\d+$/);
assert.match(installer, new RegExp(`^VERSION="${escapedVersion}" # x-release-please-version$`, "m"));
// Historical packaging requirements remain valid; current installation identity
// is governed by the access specification and active operator documentation.
for (const text of [installDocs, installPolicy, specification]) {
  assert.match(text, /preview-first/i);
}
assert.match(accessSpecification, /GOI17\/homebrew-alfred/);
assert.match(accessSpecification, /GOI17\/alfred\/alfred/);
for (const text of [readme, context, installDocs, installPolicy]) {
  const searchableText = text.replace(/<[^>]+>/g, "");
  assert.match(searchableText, /brew install GOI17\/alfred\/alfred/);
  assert.doesNotMatch(searchableText, /brew (?:install|upgrade|uninstall) GOI17\/tap\/alfred/);
}
for (const text of [readme, installDocs, installPolicy]) {
  const searchableText = text.replace(/<[^>]+>/g, "");
  assert.match(searchableText, /gh auth login --hostname github\.com --git-protocol https/);
  assert.match(searchableText, /gh auth setup-git --hostname github\.com/);
  assert.match(searchableText, /brew tap GOI17\/alfred/);
  for (const repository of ["homebrew-alfred", "alfred"]) {
    assert.ok(searchableText.includes(`gh api repos/GOI17/${repository} --jq .full_name`));
    assert.ok(searchableText.includes(`git ls-remote https://github.com/GOI17/${repository}.git HEAD`));
  }
}
assert.match(readme, /install\.html#homebrew-troubleshooting/);
assert.match(installDocs, /id="homebrew-troubleshooting"/);
assert.match(installDocs, /repos\/GOI17\/homebrew-alfred\/contents\/Formula\/alfred\.rb/);
assert.match(installDocs, /--workflow release-please\.yml/);
assert.match(installDocs, /--workflow release-homebrew-tap\.yml/);

const cli = spawnSync(
  process.execPath,
  [join(root, "packages/memory-server/scripts/alfred.mjs"), "version"],
  { encoding: "utf8", cwd: root }
);
assert.equal(cli.status, 0, cli.stderr);
assert.equal(cli.stdout.trim(), `alfred ${version}`);

const preview = spawnSync(
  process.execPath,
  [join(root, "packages/memory-server/scripts/alfred.mjs"), "setup", "--edition=coding", "--name=brew-validation", "--harness=none"],
  { encoding: "utf8", cwd: root, env: { ...process.env, ALFRED_DISTRIBUTION: "homebrew" } }
);
assert.equal(preview.status, 0, preview.stderr);
assert.match(preview.stdout, /ALFRED SUITE INSTALL PREVIEW/);
assert.match(preview.stdout, new RegExp(`Version:\\s+${escapedVersion}`));
assert.match(preview.stdout, new RegExp(`Target path:\\s+${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
assert.match(preview.stdout, /Provider calls: 0/);

const temporaryDirectory = mkdtempSync(join(tmpdir(), "alfred-homebrew-validation-"));
try {
  const formulaPath = join(temporaryDirectory, "Formula", "alfred.rb");
  const formula = renderFormula({
    source: "git",
    version,
    revision: "a".repeat(40)
  });
  writeFormulaAtomic(formulaPath, formula);
  const ruby = spawnSync("ruby", ["-c", formulaPath], { encoding: "utf8" });
  assert.equal(ruby.status, 0, `${ruby.stdout}${ruby.stderr}`);
  assert.match(ruby.stdout, /Syntax OK/);
  assert.match(formula, /ALFRED_DISTRIBUTION=homebrew/);
  assert.match(formula, /alfred setup/);
  assert.doesNotMatch(formula, /alfred-install/);
  assert.match(formula, /depends_on "node"/);
  assert.doesNotMatch(formula, /^\s*version\s/m);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
assert.match(setupCommand, /--no-clone/);

process.stdout.write(`${JSON.stringify({
  status: "pass",
  version,
  formula_modes: ["git-revision", "archive-sha256"],
  commands: ["alfred"],
  provider_calls: 0
})}\n`);
