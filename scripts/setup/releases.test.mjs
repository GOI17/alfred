import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkForUpdates, compareStableVersions, consumeRuntimeUpgrade, handoffRuntimeUpgrade } from "./releases.mjs";

const stable = version => ({ tag_name: `v${version}`, draft: false, prerelease: false, assets: [`alfred-${version}-runtime.tar.gz`, "runtime-manifest.json", "SHA256SUMS", "alfred.rb"].map(name => ({ name, browser_download_url: `https://github.com/GOI17/alfred/releases/download/v${version}/${name}` })) });
const formula = version => `class Alfred < Formula\n  url "https://github.com/GOI17/alfred/releases/download/v${version}/alfred-${version}-runtime.tar.gz"\n  sha256 "${"a".repeat(64)}"\nend\n`;
function transport(release = stable("1.10.0"), tap = formula("1.10.0")) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return new Response(url.includes("api.github.com") ? JSON.stringify(release) : tap, { status: 200 });
  } };
}
const check = extra => checkForUpdates({ currentVersion: "1.9.0", packaged: true, env: {}, ...extra });

test("stable comparison uses numeric components and rejects invalid or development versions", () => {
  assert.equal(compareStableVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareStableVersions("1.0.1", "1.0.1"), 0);
  assert.equal(compareStableVersions("1.2.3", "2.0.0"), -1);
  for (const version of ["01.0.0", "1.0", "1.2.3-beta", "1.2.3+dev", "1.2.3\n", "1.2.3;id"]) assert.throws(() => compareStableVersions(version, "1.0.0"));
});

test("available Homebrew release requires published assets and matching formula through fixed credential-free origins", async () => {
  const t = transport(); const result = await check(t);
  assert.equal(result.status, "available"); assert.equal(result.latestVersion, "1.10.0"); assert.equal(result.canUpgrade, true);
  assert.deepEqual(t.calls.map(call => call.url), ["https://api.github.com/repos/GOI17/alfred/releases/latest", "https://raw.githubusercontent.com/GOI17/homebrew-alfred/main/Formula/alfred.rb"]);
  for (const { options } of t.calls) { assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit"); assert.equal(options.headers.Authorization, undefined); }
});

test("current and newer installed versions never offer downgrade", async () => {
  for (const version of ["1.9.0", "1.8.0"]) {
    const t = transport(stable(version)); const result = await check(t);
    assert.equal(result.status, "current"); assert.equal(result.canUpgrade, false); assert.equal(t.calls.length, 1);
  }
});

test("development builds and explicit offline checks do not use network", async () => {
  let calls = 0; const fetchImpl = () => { calls++; throw new Error("unexpected request"); };
  assert.equal((await check({ currentVersion: "1.9.0-beta.1", fetchImpl })).status, "development");
  assert.equal((await check({ env: { ALFRED_SETUP_CHECK_UPDATES: "0" }, fetchImpl })).status, "unavailable");
  assert.equal(calls, 0);
});

test("source installations can see an update but never authorize Homebrew", async () => {
  const t = transport(); const result = await check({ ...t, packaged: false });
  assert.equal(result.status, "unsupported"); assert.equal(result.latestVersion, "1.10.0"); assert.equal(result.canUpgrade, false); assert.equal(t.calls.length, 1);
});

test("publication and tap lag remain pending, not upgradeable", async () => {
  for (const t of [transport({ ...stable("1.10.0"), assets: [] }), transport(stable("1.10.0"), formula("1.9.0")), transport(stable("1.10.0"), formula("1.10.0").replace('"a', '"invalid-'))]) {
    const result = await check(t); assert.equal(result.status, "pending"); assert.equal(result.canUpgrade, false);
  }
});

test("drafts, prereleases, malformed versions and untrusted asset URLs cannot authorize an update", async () => {
  const bad = stable("1.10.0"); bad.assets[0].browser_download_url = "https://evil.invalid/runtime.tar.gz";
  for (const release of [{ ...stable("1.10.0"), draft: true }, { ...stable("1.10.0"), prerelease: true }, { ...stable("1.10.0"), tag_name: "v1.10.0; touch /tmp/no" }, bad]) {
    const result = await check(transport(release)); assert.equal(result.canUpgrade, false); assert.doesNotMatch(result.text, /touch|evil/);
  }
});

test("HTTP failures, invalid JSON and oversized streamed or declared responses are sanitized", async () => {
  const transports = [
    async () => new Response("private response", { status: 429 }),
    async () => new Response("private response", { status: 500 }),
    async () => new Response("not JSON secret text"),
    async () => new Response("x", { headers: { "content-length": "9999999" } }),
    async () => new Response("x".repeat(262145)),
    async () => { throw new Error("private network details"); }
  ];
  for (const fetchImpl of transports) {
    const result = await check({ fetchImpl }); assert.equal(result.status, "unavailable"); assert.equal(result.canUpgrade, false); assert.doesNotMatch(result.text, /private|secret/);
  }
});

test("one deadline bounds a stalled transport and cancellation prevents late success", async () => {
  const started = performance.now();
  const result = await check({ fetchImpl: () => new Promise(() => {}), timeoutMs: 20 });
  assert.equal(result.status, "unavailable"); assert.ok(performance.now() - started < 1000);
  const controller = new AbortController(); controller.abort(); let calls = 0;
  assert.equal((await check({ signal: controller.signal, fetchImpl: () => { calls++; } })).status, "unavailable"); assert.equal(calls, 0);
  const pending = new AbortController();
  const promise = check({ signal: pending.signal, fetchImpl: () => new Promise(() => {}) }); pending.abort();
  assert.equal((await promise).status, "unavailable");
});

function approvalFixture(t) {
  const directory = mkdtempSync(join(realpathSync(tmpdir()), "alfred-setup-upgrade-"));
  const project = mkdtempSync(join(realpathSync(tmpdir()), "alfred project "));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); rmSync(project, { recursive: true, force: true }); });
  const env = { ALFRED_DISTRIBUTION: "homebrew", ALFRED_SETUP_UPGRADE_REQUEST: join(directory, "request.json"), ALFRED_SETUP_UPGRADE_NONCE: "a".repeat(64) };
  return { directory, project, env, request: { currentVersion: "1.0.1", latestVersion: "1.1.0", cwd: project, installRoot: project, env } };
}

test("approved runtime handoff is private, bound to the session/project/runtime and consumed once", t => {
  const f = approvalFixture(t); handoffRuntimeUpgrade(f.request);
  assert.equal(lstatSync(f.env.ALFRED_SETUP_UPGRADE_REQUEST).mode & 0o777, 0o600);
  assert.throws(() => handoffRuntimeUpgrade(f.request), /already used/);
  assert.throws(() => consumeRuntimeUpgrade({ ...f.request, currentVersion: "1.0.0" }), /match/);
  assert.throws(() => consumeRuntimeUpgrade({ ...f.request, env: { ...f.env, ALFRED_SETUP_UPGRADE_NONCE: "b".repeat(64) } }), /match/);
  assert.equal(consumeRuntimeUpgrade(f.request).latestVersion, "1.1.0"); assert.equal(existsSync(f.env.ALFRED_SETUP_UPGRADE_REQUEST), false);
  assert.throws(() => consumeRuntimeUpgrade(f.request));
});

test("missing launcher, non-Homebrew, downgrades and unsafe private directories are rejected", t => {
  const f = approvalFixture(t);
  assert.throws(() => handoffRuntimeUpgrade({ ...f.request, env: {} }), /launcher/);
  assert.throws(() => handoffRuntimeUpgrade({ ...f.request, env: { ...f.env, ALFRED_DISTRIBUTION: "source" } }), /Homebrew/);
  assert.throws(() => handoffRuntimeUpgrade({ ...f.request, latestVersion: "1.0.0" }), /newer/);
  chmodSync(f.directory, 0o755); assert.throws(() => handoffRuntimeUpgrade(f.request), /private/); chmodSync(f.directory, 0o700);
  handoffRuntimeUpgrade(f.request);
  const bytes = readFileSync(f.env.ALFRED_SETUP_UPGRADE_REQUEST); unlinkSync(f.env.ALFRED_SETUP_UPGRADE_REQUEST);
  const target = join(f.directory, "other.json"); writeFileSync(target, bytes, { mode: 0o600 }); symlinkSync(target, f.env.ALFRED_SETUP_UPGRADE_REQUEST);
  assert.throws(() => consumeRuntimeUpgrade(f.request), /approval/);
});
