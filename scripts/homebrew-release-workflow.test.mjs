#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const workflow = readFileSync(
  resolve(root, ".github/workflows/release-homebrew-tap.yml"),
  "utf8"
);
const releasePleaseWorkflow = readFileSync(
  resolve(root, ".github/workflows/release-please.yml"),
  "utf8"
);
const validationWorkflow = readFileSync(resolve(root, ".github/workflows/homebrew.yml"), "utf8");
const releasePleaseConfig = JSON.parse(readFileSync(
  resolve(root, "release-please-config.json"),
  "utf8"
));

const publicWorkflow = readFileSync(resolve(root, ".github/workflows/publish-homebrew-runtime.yml"), "utf8");

test("prepares private candidates from separate source and builder checkouts", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /path: builder/);
  assert.match(workflow, /path: source/);
  assert.match(workflow, /SOURCE_REVISION=\$\(git -C source rev-parse HEAD\)/);
  assert.match(workflow, /BUILDER_REVISION=\$\(git -C builder rev-parse HEAD\)/);
  assert.match(workflow, /--source-revision "\$SOURCE_REVISION"/);
  assert.match(workflow, /--builder-revision "\$BUILDER_REVISION"/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow, /git push|gh release|publish-homebrew-runtime\.mjs|contents: write/);
});

test("prepares reviewable releases from conventional commits on main", () => {
  assert.match(releasePleaseWorkflow, /push:\s*\n\s+branches: \[main\]/);
  assert.match(releasePleaseWorkflow, /googleapis\/release-please-action@v4/);
  assert.match(releasePleaseWorkflow, /contents: write/);
  assert.match(releasePleaseWorkflow, /pull-requests: write/);
  assert.equal(releasePleaseConfig["release-type"], "node");
  assert.equal(releasePleaseConfig["bump-patch-for-minor-pre-major"], true);
  assert.match(releasePleaseWorkflow, /npm run runtime:test/);
  assert.match(releasePleaseWorkflow, /npm run validate:homebrew -- --docs-only/);
});

test("automatic releases can prepare only private runtime review artifacts", () => {
  assert.match(releasePleaseWorkflow, /prepare-homebrew-runtime:/);
  assert.match(releasePleaseWorkflow, /uses: \.\/\.github\/workflows\/release-homebrew-tap\.yml/);
  assert.match(releasePleaseWorkflow, /needs\.prepare-or-release\.outputs\.release_created == 'true'/);
  assert.doesNotMatch(releasePleaseWorkflow, /publish-homebrew-runtime|secrets: inherit/);
});

test("manual publication requires independent archive and formula approvals on main", () => {
  assert.match(publicWorkflow, /workflow_dispatch:/);
  assert.doesNotMatch(publicWorkflow, /\n  (?:push|pull_request|release|workflow_call):/);
  assert.match(publicWorkflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(publicWorkflow, /ALFRED_APPROVED_RUNTIME_SHA256/);
  assert.match(publicWorkflow, /ALFRED_APPROVED_FORMULA_SHA256/);
  assert.match(publicWorkflow, /manifest\.provenance\.builder_revision !== run\.head_sha/);
  assert.match(publicWorkflow, /actions\/create-github-app-token@v2/);
  assert.match(publicWorkflow, /repositories: homebrew-alfred/);
  assert.match(publicWorkflow, /permission-contents: write/);
  assert.doesNotMatch(publicWorkflow, /PERSONAL_ACCESS_TOKEN|\bPAT\b|gh repo edit/);
  assert.ok(publicWorkflow.indexOf("Require configured explicit approval") < publicWorkflow.indexOf("Create target repository scoped installation token"));
});

test("Homebrew CI validates runtime fixtures and active documentation without building real artifacts", () => {
  for (const path of ["README.md", "site/docs/install.html", ".ai/context.md", ".ai/instructions/install-management.md", ".ai/execution/homebrew-tap-access.md", "packaging/runtime/**", "scripts/runtime-distribution.test.mjs"]) {
    assert.equal(validationWorkflow.split(`- "${path}"`).length - 1, 2, `${path} must trigger validation on push and pull_request`);
  }
  assert.match(validationWorkflow, /npm run runtime:test/);
  assert.match(validationWorkflow, /npm run validate:homebrew -- --docs-only/);
  assert.doesNotMatch(validationWorkflow, /npm ci|build-runtime\.mjs --root/);
});
