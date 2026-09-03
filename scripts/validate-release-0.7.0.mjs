#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

const manifest = json("package.json");
const release = json(".ai/releases/release-0.7.0.json");
const trace = json(".ai/observability/generated/release-0.7.0.json");
const gpt = json(".ai/gpt/alfred-memory-gpt.json");
const installer = read("install.sh");
const openapi = read("packages/memory-openapi/openapi.yaml");
const homebrewWorkflow = read(".github/workflows/homebrew.yml");
const tapWorkflow = read(".github/workflows/release-homebrew-tap.yml");
const notes = read(".ai/releases/release-0.7.0.md");

assert.equal(manifest.version, "0.7.0");
assert.match(installer, /^VERSION="0\.7\.0"$/m);
assert.match(openapi, /^\s+version: 0\.7\.0$/m);
assert.equal(gpt.metadata.version, "0.7.0");
assert.match(homebrewWorkflow, /--version 0\.7\.0/);

assert.equal(release.id, "release-0.7.0");
assert.equal(release.version, "0.7.0");
assert.equal(release.status, "candidate");
assert.equal(release.previous_release, "release-0.6.0");
assert.equal(release.source_policy.release_tag, "v0.7.0");
assert.equal(release.source_policy.validated_commit_source, "pending");
assert.equal(release.provider_calls_allowed, 0);
assert.ok(release.includes.includes("recovery-oauth-continuation"));
assert.ok(release.includes.includes("automatic-homebrew-tap-releases"));
assert.ok(release.excluded.includes("alfredlabs-resend-migration-pending-external-approval"));

assert.equal(trace.release, "0.7.0");
assert.equal(trace.provider_calls, 0);
assert.equal(trace.result, "candidate-pass-pending-publication");
assert.match(notes, /OAuth and account recovery/);
assert.match(notes, /Provider calls: 0/);

assert.match(tapWorkflow, /release:\s*\n\s+types: \[published\]/);
assert.match(tapWorkflow, /HOMEBREW_TAP_DEPLOY_KEY/);
assert.match(tapWorkflow, /git push origin HEAD:main/);

const cli = spawnSync(
  process.execPath,
  [resolve(root, "packages/memory-server/scripts/alfred.mjs"), "version"],
  { cwd: root, encoding: "utf8" }
);
assert.equal(cli.status, 0, cli.stderr);
assert.equal(cli.stdout.trim(), "alfred 0.7.0");

process.stdout.write(`${JSON.stringify({
  status: "pass",
  release: "0.7.0",
  included_changes: release.includes.length,
  required_validators: release.required_validators.length,
  provider_calls: 0
})}\n`);
