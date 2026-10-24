#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { buildRuntime } from "./build-runtime.mjs";
import { publishAssets, readCandidate } from "./publish-runtime-assets.mjs";
import { join, resolve } from "node:path";
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
const releasePleaseConfig = JSON.parse(readFileSync(
  resolve(root, "release-please-config.json"),
  "utf8"
));

test("publishes only stable semantic releases with matching package versions", () => {
  assert.match(workflow, /release:\s*\n\s+types: \[published\]/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /if: inputs\.tag != ''/);
  assert.match(workflow, /release\.prerelease == false/);
  assert.match(workflow, /\^v\(0\|\[1-9\]\[0-9\]\*\)/);
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
  assert.match(releasePleaseWorkflow, /HOMEBREW_TAP_DEPLOY_KEY: \$\{\{ secrets\.HOMEBREW_TAP_DEPLOY_KEY \}\}/);
  assert.doesNotMatch(releasePleaseWorkflow, /secrets: inherit/);
  assert.doesNotMatch(releasePleaseWorkflow, /PERSONAL_ACCESS_TOKEN|RELEASE_PLEASE_TOKEN|\bPAT\b/);
});

test("uses a deploy key scoped to the private tap instead of a PAT", () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: write/);
  assert.match(workflow, /repository: GOI17\/homebrew-alfred/);
  assert.match(workflow, /ssh-key: \$\{\{ secrets\.HOMEBREW_TAP_DEPLOY_KEY \}\}/);
  assert.doesNotMatch(workflow, /PERSONAL_ACCESS_TOKEN|\bPAT\b/);
});

test("generates, validates, and publishes only Formula/alfred.rb", () => {
  assert.match(workflow, /cp "\$RUNNER_TEMP\/alfred-runtime-assets\/alfred\.rb" homebrew-tap\/Formula\/alfred\.rb/);
  assert.doesNotMatch(workflow, /--source git/);
  assert.match(workflow, /ruby -c homebrew-tap\/Formula\/alfred\.rb/);
  assert.match(workflow, /brew style homebrew-tap\/Formula\/alfred\.rb/);
  assert.match(workflow, /grep -v '\^Formula\/alfred\.rb\$'/);
  assert.match(workflow, /git diff --quiet -- Formula\/alfred\.rb/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.doesNotMatch(workflow, /--force/);
});


test("builds locked runtime assets and verifies publication before accessing the private tap", () => {
  const build = workflow.indexOf("node scripts/build-runtime.mjs");
  const verify = workflow.indexOf("node scripts/verify-runtime.mjs");
  const publish = workflow.indexOf("node scripts/publish-runtime-assets.mjs");
  const tap = workflow.indexOf("repository: GOI17/homebrew-alfred");
  const push = workflow.indexOf("git push origin HEAD:main");
  assert.ok(build > 0 && build < verify && verify < publish && publish < tap && tap < push);
  assert.match(workflow, /--source-revision "\$REVISION" --builder-revision "\$REVISION"/);
  assert.match(workflow, /npm ci --prefix "\$RUNNER_TEMP\/alfred-runtime-deps" --omit=dev --ignore-scripts --no-audit --no-fund/);
  assert.match(workflow, /GH_TOKEN: \$\{\{ github.token \}\}/);
  assert.doesNotMatch(workflow, /continue-on-error|--clobber|gh release create|--exploratory/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /release\.draft == false/);
});

function identityScript() {
  const step = workflow.split("      - name: Validate release identity\n")[1].split("\n      - name:")[0];
  return step.split("        run: |\n")[1].split("\n").map(line => line.replace(/^          /, "")).join("\n");
}
function identityFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "alfred-release-identity-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env: { ...process.env,
      GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid",
      GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" } });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  git("init", "--quiet");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version: "1.2.3" }));
  git("add", "package.json"); git("commit", "--quiet", "-m", "fixture"); git("tag", "v1.2.3");
  const run = tag => spawnSync("bash", ["-c", identityScript()], { cwd: dir, encoding: "utf8",
    env: { ...process.env, RELEASE_TAG: tag, GITHUB_OUTPUT: join(dir, "outputs") } });
  return { dir, git, run };
}

test("actual identity shell accepts the exact release commit and emits its version/revision", t => {
  const f = identityFixture(t);
  assert.equal(f.run("v1.2.3").status, 0);
  assert.equal(readFileSync(join(f.dir, "outputs"), "utf8"), `version=1.2.3\nrevision=${f.git("rev-parse", "HEAD")}\n`);
});

test("actual identity shell rejects unstable tags, version mismatches and tag/HEAD drift", t => {
  const f = identityFixture(t);
  for (const tag of ["main", "v1.2.3-rc.1", "v01.2.3", "v1.2.3;echo unsafe", "v1.2.4"]) assert.notEqual(f.run(tag).status, 0, tag);
  f.git("commit", "--quiet", "--allow-empty", "-m", "head drift");
  const drift = f.run("v1.2.3");
  assert.notEqual(drift.status, 0);
  assert.match(drift.stderr, /Checked-out source does not match/);
});

function assetsFixture(t, exploratory = false) {
  const temp = mkdtempSync(join(tmpdir(), "alfred-release-assets-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const source = join(temp, "source"), dependencies = join(temp, "deps/node_modules"), output = join(temp, "assets");
  mkdirSync(join(source, "packaging/runtime"), { recursive: true });
  mkdirSync(dependencies, { recursive: true });
  const put = (file, value) => writeFileSync(file, JSON.stringify(value));
  put(join(source, "package.json"), { name: "alfred", version: "1.2.3" });
  writeFileSync(join(source, "app.mjs"), "export const ready = true;\n");
  const lock = { lockfileVersion: 3, packages: {} };
  put(join(temp, "deps/package-lock.json"), lock);
  put(join(source, "packaging/runtime/package-lock.json"), lock);
  const allowlist = join(source, "packaging/runtime/allowlist.json");
  put(allowlist, { schema: "alfred.runtime.allowlist/v1", includes: ["app.mjs"], packageMetadata: [], dependencies: {}, workspaceModules: {} });
  const revision = "a".repeat(40);
  buildRuntime({ root: source, dependencies, output, allowlist, sourceRevision: revision, builderRevision: revision, exploratory });
  const assets = new Map(["alfred-1.2.3-runtime.tar.gz", "runtime-manifest.json", "alfred.rb", "SHA256SUMS"].map(name => [name, readFileSync(join(output, name))]));
  const remote = new Map(), calls = [], downloads = [];
  const release = { tagName: "v1.2.3", isDraft: false, isPrerelease: false };
  let visibility = "PUBLIC";
  const gh = async args => {
    calls.push(args);
    if (args[0] === "repo") return Buffer.from(visibility);
    if (args[0] === "release" && args[1] === "view") return Buffer.from(JSON.stringify({ ...release,
      assets: [...remote.keys()].map((name, index) => ({ name, apiUrl: `https://api.github.com/repos/GOI17/alfred/releases/assets/${index + 1}` })) }));
    if (args[0] === "api") return [...remote.values()][Number(args[1].split("/").at(-1)) - 1];
    if (args[0] === "release" && args[1] === "upload") {
      assert.equal(args[3], "--repo"); assert.equal(args[4], "GOI17/alfred");
      for (const file of args.slice(5)) remote.set(file.split("/").at(-1), readFileSync(file));
      return Buffer.alloc(0);
    }
    assert.fail(`Unexpected remote operation: ${JSON.stringify(args)}`);
  };
  const download = async url => { downloads.push(url); return remote.get(new URL(url).pathname.split("/").at(-1)); };
  return { output, revision, assets, remote, calls, downloads, release, gh, download,
    setVisibility: value => { visibility = value; },
    publish: overrides => publishAssets({ directory: output, tag: "v1.2.3", revision, gh, download, ...overrides }) };
}

test("publishes the exact four release assets and retries identical bytes without replacement", async t => {
  const f = assetsFixture(t);
  assert.deepEqual((await f.publish()).uploaded, [...f.assets.keys()]);
  assert.deepEqual([...f.remote], [...f.assets]);
  assert.deepEqual((await f.publish()).uploaded, []);
  assert.equal(f.calls.filter(args => args[1] === "upload").length, 1);
  assert.equal(f.downloads.length, 8);
  assert.ok(f.downloads.every(url => url.startsWith("https://github.com/GOI17/alfred/releases/download/v1.2.3/")));
  assert.ok(f.calls.every(args => !args.includes("--clobber") && !args.includes("create") && !args.includes("delete")));
});

test("checks all existing assets before uploading missing ones and rejects changed bytes", async t => {
  const f = assetsFixture(t);
  f.remote.set("alfred.rb", Buffer.from("different already-published formula"));
  await assert.rejects(f.publish(), /Refusing replacement/);
  assert.equal(f.calls.filter(args => args[1] === "upload").length, 0);
  assert.equal(f.downloads.length, 0);
  assert.equal(f.remote.size, 1);
});

test("partial identical release recovery uploads only missing assets", async t => {
  const f = assetsFixture(t);
  f.remote.set("alfred.rb", f.assets.get("alfred.rb"));
  const result = await f.publish();
  assert.deepEqual(result.uploaded, ["alfred-1.2.3-runtime.tar.gz", "runtime-manifest.json", "SHA256SUMS"]);
});

test("publisher fails closed on private source, draft/prerelease or missing release", async t => {
  for (const kind of ["private", "draft", "prerelease", "missing"]) {
    const f = assetsFixture(t);
    if (kind === "private") f.setVisibility("PRIVATE");
    if (kind === "draft") f.release.isDraft = true;
    if (kind === "prerelease") f.release.isPrerelease = true;
    await assert.rejects(f.publish(kind === "missing" ? { gh: async args => {
      if (args[0] === "repo") return Buffer.from("PUBLIC");
      throw new Error("Release not found");
    } } : {}));
    assert.equal(f.calls.filter(args => args[1] === "upload").length, 0);
  }
});

test("publication rejects wrong revision and exploratory artifacts before remote operations", async t => {
  const f = assetsFixture(t);
  await assert.rejects(f.publish({ revision: "b".repeat(40) }), /source mismatch/);
  assert.equal(f.calls.length, 0);
  const exploratory = assetsFixture(t, true);
  assert.throws(() => readCandidate({ directory: exploratory.output, tag: "v1.2.3", revision: exploratory.revision }), /Exploratory/);
});

test("anonymous byte verification must succeed before workflow can update the tap", async t => {
  const f = assetsFixture(t);
  await assert.rejects(f.publish({ download: async () => Buffer.from("unexpected CDN response") }), /Anonymous verification failed/);
});


test('Workspace release stages locked assets and architecture-specific native artifacts before packaging', () => {
  const native = readFileSync(resolve(root, '.github/workflows/workspace-native.yml'), 'utf8');
  const validation = readFileSync(resolve(root, '.github/workflows/homebrew.yml'), 'utf8');
  const workspace = readFileSync(resolve(root, '.github/workflows/workspace.yml'), 'utf8');
  assert.match(workflow, /needs: workspace-native/);
  assert.match(workflow, /--workspace-native "\$RUNNER_TEMP\/alfred-workspace-native"/);
  assert.match(workflow, /node scripts\/build-workspace\.mjs --dependencies/);
  assert.ok(workflow.indexOf('node scripts/build-workspace.mjs') < workflow.indexOf('node scripts/build-runtime.mjs'));
  assert.match(native, /ubuntu-22\.04-arm/);
  assert.match(native, /ubuntu-22\.04\n/);
  assert.match(native, /npm ci .*--include=dev --ignore-scripts/);
  assert.match(native, /node scripts\/build-workspace-native\.mjs/);
  assert.match(native, /persist-credentials: false/);
  assert.match(validation, /os: \[ubuntu-22\.04, ubuntu-22\.04-arm, macos-15-intel, macos-15\]/);
  assert.match(workspace, /pnpm install --frozen-lockfile --ignore-scripts/);
  const install = workspace.indexOf('pnpm install --frozen-lockfile --ignore-scripts');
  const prepare = workspace.indexOf('node packages/workspace/scripts/prepare-pty.mjs');
  const terminal = workspace.indexOf('node scripts/verify-workspace-native.mjs');
  const tests = workspace.indexOf('pnpm --filter @alfred-labs/workspace test');
  assert.ok(install >= 0 && install < prepare && prepare < terminal && terminal < tests, 'Fresh CI dependencies must prepare and execute the native PTY before testing');
  assert.doesNotMatch(workspace, /pnpm rebuild|--ignore-scripts=false/);
  assert.match(workspace, /playwright install chromium webkit/);
  assert.match(workspace, /exec playwright test/);
  assert.match(workspace, /workspace test:chat/);
  assert.match(workspace, /workspace-test-network-guard\.mjs/);
  assert.doesNotMatch(native, /continue-on-error/);
});
