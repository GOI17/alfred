#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

const manifest = json("package.json");
const releaseManifest = json(".release-please-manifest.json");
const config = json("release-please-config.json");
const installer = read("install.sh");
const openapi = read("packages/memory-openapi/openapi.yaml");
const gpt = json(".ai/gpt/alfred-memory-gpt.json");
const releaseWorkflow = read(".github/workflows/release-please.yml");
const tapWorkflow = read(".github/workflows/release-homebrew-tap.yml");
const validationWorkflow = read(".github/workflows/homebrew.yml");
const prWorkflow = read(".github/workflows/require-linked-issue.yml");

const version = manifest.version;
const escapedVersion = version.replaceAll(".", "\\.");
assert.match(version, /^\d+\.\d+\.\d+$/);
assert.equal(releaseManifest["."], version);
assert.match(installer, new RegExp(`^VERSION="${escapedVersion}" # x-release-please-version$`, "m"));
assert.match(openapi, new RegExp(`^  version: ${escapedVersion}$`, "m"));
assert.equal(gpt.metadata.version, version);

assert.equal(config["release-type"], "node");
assert.equal(config["include-v-in-tag"], true);
assert.equal(config["include-component-in-tag"], false);
assert.equal(config["bump-patch-for-minor-pre-major"], true);
assert.equal(config["pull-request-title-pattern"], "chore(main): release ${version}");
const extraFiles = config.packages?.["."]?.["extra-files"] ?? [];
assert.ok(extraFiles.some((entry) => entry.type === "generic" && entry.path === "install.sh"));
assert.ok(extraFiles.some((entry) => entry.type === "json" && entry.path === ".ai/gpt/alfred-memory-gpt.json" && entry.jsonpath === "$.metadata.version"));
assert.ok(extraFiles.some((entry) => entry.type === "yaml" && entry.path === "packages/memory-openapi/openapi.yaml" && entry.jsonpath === "$.info.version"));

assert.match(releaseWorkflow, /push:\s*\n\s+branches: \[main\]/);
assert.match(releaseWorkflow, /workflow_dispatch:/);
assert.match(releaseWorkflow, /contents: write/);
assert.match(releaseWorkflow, /issues: write/);
assert.match(releaseWorkflow, /pull-requests: write/);
assert.doesNotMatch(releaseWorkflow, /actions: write/);
assert.match(releaseWorkflow, /googleapis\/release-please-action@v4/);
assert.match(releaseWorkflow, /release_created: \$\{\{ steps\.release\.outputs\.release_created \}\}/);
assert.match(releaseWorkflow, /prs_created: \$\{\{ steps\.release\.outputs\.prs_created \}\}/);
assert.match(releaseWorkflow, /needs\.prepare-or-release\.outputs\.prs_created == 'true'/);
assert.match(releaseWorkflow, /startsWith\("release-please--branches--main"\)/);
assert.match(releaseWorkflow, /Validate generated release candidate/);
assert.match(releaseWorkflow, /npm run validate:release-automation/);
assert.match(releaseWorkflow, /npm run runtime:test/);
assert.match(releaseWorkflow, /npm run validate:homebrew -- --docs-only/);
assert.match(releaseWorkflow, /uses: \.\/\.github\/workflows\/release-homebrew-tap\.yml/);
assert.match(releaseWorkflow, /if: \$\{\{ needs\.prepare-or-release\.outputs\.release_created == 'true' \}\}/);
assert.match(releaseWorkflow, /tag: \$\{\{ needs\.prepare-or-release\.outputs\.tag_name \}\}/);
assert.doesNotMatch(releaseWorkflow, /secrets: inherit/);

assert.doesNotMatch(tapWorkflow, /\n  release:/);
assert.match(tapWorkflow, /github\.ref == 'refs\/heads\/main'/);
assert.match(tapWorkflow, /workflow_dispatch:/);
assert.match(tapWorkflow, /workflow_call:/);
assert.match(tapWorkflow, /actions\/upload-artifact@v4/);
assert.match(tapWorkflow, /build-runtime\.mjs/);
assert.doesNotMatch(tapWorkflow, /git push|gh release|HOMEBREW_TAP_DEPLOY_KEY/);
const publicWorkflow = read(".github/workflows/publish-homebrew-runtime.yml");
assert.match(publicWorkflow, /ALFRED_APPROVED_RUNTIME_SHA256/);
assert.match(publicWorkflow, /ALFRED_APPROVED_FORMULA_SHA256/);
assert.match(publicWorkflow, /repositories: homebrew-alfred/);
assert.match(publicWorkflow, /github\.ref == 'refs\/heads\/main'/);
assert.doesNotMatch(`${releaseWorkflow}\n${tapWorkflow}`, /PERSONAL_ACCESS_TOKEN|RELEASE_PLEASE_TOKEN|\bPAT\b/);

assert.match(validationWorkflow, /VERSION=\$\(node -p "require\('\.\/package\.json'\)\.version"\)/);
assert.match(validationWorkflow, /--version "\$VERSION"/);
assert.doesNotMatch(validationWorkflow, /--version \d+\.\d+\.\d+/);

assert.match(prWorkflow, /pr\.user\.login === "github-actions\[bot\]"/);
assert.match(prWorkflow, /branch\.startsWith\("release-please--branches--main"\)/);
assert.match(prWorkflow, /PR title must use Conventional Commits/);

process.stdout.write(`${JSON.stringify({
  status: "pass",
  version,
  release_pr: "review-required",
  private_prepare_paths: ["workflow-dispatch-main", "workflow-call-main"],
  public_publish: "manual-with-independent-archive-and-formula-approval",
  cross_repository_write_credential: "repository-scoped GitHub App",
  provider_calls: 0
})}\n`);
