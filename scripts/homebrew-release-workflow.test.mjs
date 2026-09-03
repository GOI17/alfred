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

test("publishes only stable semantic releases with matching package versions", () => {
  assert.match(workflow, /release:\s*\n\s+types: \[published\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release\.prerelease == false/);
  assert.match(workflow, /\^v\(\[0-9\]\+\)/);
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/);
  assert.match(workflow, /Release tag and package\.json version do not match/);
  assert.match(workflow, /git rev-parse "\$\{RELEASE_TAG\}\^\{commit\}"/);
  assert.match(workflow, /Checked-out source does not match the release tag/);
});

test("uses a deploy key scoped to the private tap instead of a PAT", () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /repository: GOI17\/homebrew-tap/);
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
