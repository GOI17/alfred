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

test("publishes only stable semantic releases with matching package versions", () => {
  assert.match(workflow, /release:\s*\n\s+types: \[published\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /github\.event_name == 'workflow_call'/);
  assert.match(workflow, /release\.prerelease == false/);
  assert.match(workflow, /\^v\(\[0-9\]\+\)/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /Release tag and package\.json version do not match/);
  assert.match(workflow, /git rev-parse "\$\{RELEASE_TAG\}\^\{commit\}"/);
  assert.match(workflow, /Checked-out source does not match the release tag/);
});

test("prepares reviewable releases from conventional commits on main", () => {
  assert.match(releasePleaseWorkflow, /push:\s*\n\s+branches: \[main\]/);
  assert.match(releasePleaseWorkflow, /googleapis\/release-please-action@v4/);
  assert.match(releasePleaseWorkflow, /contents: write/);
  assert.match(releasePleaseWorkflow, /issues: write/);
  assert.match(releasePleaseWorkflow, /pull-requests: write/);
  assert.doesNotMatch(releasePleaseWorkflow, /actions: write/);
  assert.equal(releasePleaseConfig["release-type"], "node");
  assert.equal(releasePleaseConfig["bump-patch-for-minor-pre-major"], true);
  assert.equal(releasePleaseConfig["pull-request-title-pattern"], "chore(main): release ${version}");
  assert.match(releasePleaseWorkflow, /prs_created: \$\{\{ steps\.release\.outputs\.prs_created \}\}/);
  assert.match(releasePleaseWorkflow, /needs\.prepare-or-release\.outputs\.prs_created == 'true'/);
  assert.match(releasePleaseWorkflow, /startsWith\("release-please--branches--main"\)/);
  assert.match(releasePleaseWorkflow, /Validate generated release candidate/);
  assert.match(releasePleaseWorkflow, /npm run validate:release-automation/);
  assert.match(releasePleaseWorkflow, /npm run homebrew:test/);
  assert.match(releasePleaseWorkflow, /npm run validate:homebrew/);
});

test("publishes the tap directly after an automatic GitHub release", () => {
  assert.match(releasePleaseWorkflow, /release_created: \$\{\{ steps\.release\.outputs\.release_created \}\}/);
  assert.match(releasePleaseWorkflow, /if: \$\{\{ needs\.prepare-or-release\.outputs\.release_created == 'true' \}\}/);
  assert.match(releasePleaseWorkflow, /uses: \.\/\.github\/workflows\/release-homebrew-tap\.yml/);
  assert.match(releasePleaseWorkflow, /tag: \$\{\{ needs\.prepare-or-release\.outputs\.tag_name \}\}/);
  assert.match(releasePleaseWorkflow, /secrets: inherit/);
  assert.doesNotMatch(releasePleaseWorkflow, /PERSONAL_ACCESS_TOKEN|RELEASE_PLEASE_TOKEN|\bPAT\b/);
});

test("uses a deploy key scoped to the private tap instead of a PAT", () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /repository: GOI17\/homebrew-alfred/);
  assert.doesNotMatch(workflow, /repository: GOI17\/homebrew-tap/);
  for (const path of ["README.md", "site/docs/install.html", ".ai/context.md",
    ".ai/instructions/install-management.md", ".ai/execution/homebrew-tap-access.md"]) {
    assert.equal(validationWorkflow.split(`- "${path}"`).length - 1, 2,
      `${path} must trigger Homebrew validation on push and pull_request`);
  }
  assert.match(workflow, /ssh-key: \$\{\{ secrets\.HOMEBREW_TAP_DEPLOY_KEY \}\}/);
  assert.doesNotMatch(workflow, /PERSONAL_ACCESS_TOKEN|\bPAT\b|GH_TOKEN/);
});

test("generates, validates, and publishes only Formula/alfred.rb", () => {
  assert.match(workflow, /scripts\/generate-homebrew-formula\.mjs/);
  assert.match(workflow, /--source git/);
  assert.match(workflow, /--output homebrew-tap\/Formula\/alfred\.rb/);
  assert.match(workflow, /ruby -c homebrew-tap\/Formula\/alfred\.rb/);
  assert.match(workflow, /brew style homebrew-tap\/Formula\/alfred\.rb/);
  assert.match(workflow, /grep -v '\^Formula\/alfred\.rb\$'/);
  assert.match(workflow, /git diff --quiet -- Formula\/alfred\.rb/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.doesNotMatch(workflow, /--force/);
});
