import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const srcIndex = join(pkgRoot, "src", "index.html");
const distDir = join(pkgRoot, "dist");

test("src/index.html exists and is non-empty", () => {
  assert.ok(existsSync(srcIndex));
  const text = readFileSync(srcIndex, "utf8");
  assert.ok(text.length > 5000, "index.html should be substantial");
});

test("signup skips the agent-kind choice and creates a human-agent tenant", () => {
  const text = readFileSync(srcIndex, "utf8");
  assert.doesNotMatch(text, /name=["']signupKind["']/);
  assert.doesNotMatch(text, /Human agent \(ChatGPT, Claude, Gemini\)/);
  assert.doesNotMatch(text, /Hybrid \(human \+ coding agents\)/);

  const sourceStart = text.indexOf("async function signup() {");
  const sourceEnd = text.indexOf("async function requestRecovery() {");
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart, "signup function should be extractable");

  const signupSource = text.slice(sourceStart, sourceEnd);
  assert.match(signupSource, /const kind = "human_agent";/);
  assert.match(signupSource, /JSON\.stringify\(\{ display_name: name, kind,/);
});

test("src/index.html has the key UI elements and current-session behavior", async () => {
  const text = readFileSync(srcIndex, "utf8");
  for (const r of [
    "<title>",
    "setKey",
    "loadTenants",
    "issueKey",
    "loadKeys",
    "apiBase",
    "requestRecovery",
    "continue_to",
    "new URL(window.location.href)",
    "sessionApiKey",
    "toggleApiKeyVisibility",
    "copyApiKey",
    "logout"
  ]) {
    assert.ok(text.includes(r), "missing: " + r);
  }

  const sourceStart = text.indexOf("function clearMemoryViews() {");
  const sourceEnd = text.indexOf("function setKey() {");
  assert.ok(sourceStart >= 0 && sourceEnd > sourceStart, "session functions should be extractable");

  const elementIds = [
    "sessionApiKey", "toggleSessionApiKey", "sessionStatus", "apiStatus",
    "locked", "unlocked", "apiKey", "newKeyBody", "tenantsBody",
    "keysBody", "keyTenant", "keyLabel", "showRevoked", "historyBody", "agentsBody", "historyPage", "historyStatus", "agentStatus", "historyNamespace", "historyProject", "historyType", "historyPrevious", "historyNext"
  ];
  const elements = Object.fromEntries(elementIds.map((id) => [id, {
    id,
    value: "",
    type: "",
    textContent: "",
    innerHTML: "",
    checked: false,
    style: {},
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  }]));
  const removedKeys = [];
  const copiedKeys = [];
  const document = { getElementById(id) { return elements[id]; } };
  const localStorage = { removeItem(key) { removedKeys.push(key); } };
  const navigator = { clipboard: { async writeText(value) { copiedKeys.push(value); } } };
  const createHarness = new Function("document", "localStorage", "navigator", `
    let API_KEY = "alk_active_secret";
    let CURRENT_TENANT = "usr_t_active";
    let SESSION_VERSION = 0;
    let HISTORY_REQUEST = 0, ACTIVITY_REQUEST = 0, HISTORY_OFFSET = 0;
    let HISTORY_FILTERS = "", HISTORY_CONTROLLER = null, ACTIVITY_CONTROLLER = null;
    ${text.slice(sourceStart, sourceEnd)}
    return {
      showUnlockedState,
      toggleApiKeyVisibility,
      copyApiKey,
      logout,
      state: () => ({ API_KEY, CURRENT_TENANT, SESSION_VERSION })
    };
  `);
  const harness = createHarness(document, localStorage, navigator);

  harness.showUnlockedState();
  assert.equal(elements.sessionApiKey.value, "alk_active_secret");
  assert.equal(elements.sessionApiKey.type, "password", "the key should start masked");
  assert.equal(elements.unlocked.style.display, "block");

  harness.toggleApiKeyVisibility();
  assert.equal(elements.sessionApiKey.type, "text");
  assert.equal(elements.toggleSessionApiKey.attributes["aria-pressed"], "true");
  harness.toggleApiKeyVisibility();
  assert.equal(elements.sessionApiKey.type, "password");

  await harness.copyApiKey();
  assert.deepEqual(copiedKeys, ["alk_active_secret"]);
  assert.equal(elements.sessionStatus.textContent, "API key copied.");

  elements.apiKey.value = "alk_active_secret";
  elements.newKeyBody.innerHTML = "alk_other_secret";
  elements.tenantsBody.innerHTML = "tenant data";
  elements.keysBody.innerHTML = "key data";
  harness.logout();

  assert.deepEqual(removedKeys, ["alfred_api_key"]);
  assert.deepEqual(harness.state(), { API_KEY: "", CURRENT_TENANT: "", SESSION_VERSION: 2 });
  assert.equal(elements.sessionApiKey.value, "");
  assert.equal(elements.apiKey.value, "");
  assert.equal(elements.newKeyBody.innerHTML, "");
  assert.doesNotMatch(elements.tenantsBody.innerHTML, /tenant data/);
  assert.doesNotMatch(elements.keysBody.innerHTML, /key data/);
  assert.equal(elements.unlocked.style.display, "none");
  assert.equal(elements.locked.style.display, "block");
});

test("npm run build creates dist/index.html", () => {
  const result = spawnSync("node", ["scripts/build.mjs"], { cwd: pkgRoot, encoding: "utf8" });
  assert.equal(result.status, 0, "build failed: " + result.stderr);
  assert.ok(existsSync(join(distDir, "index.html")));
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  // The build script injects window.ALFRED_API_BASE with the default.
  assert.match(text, /window\.ALFRED_API_BASE = ""/);
  assert.match(text, /window\.ALFRED_BUILD_VERSION = /);
});

test("build includes a version while retaining same-origin API", () => {
  const customDir = mkdtempSync(join(tmpdir(), "alfred-console-build-"));
  try {
    const result = spawnSync("node", ["scripts/build.mjs"], {
      cwd: pkgRoot,
      env: {
        ...process.env,
        ALFRED_API_BASE: "",
        ALFRED_BUILD_VERSION: "test-build",
        ALFRED_CONSOLE_OUTPUT_DIR: customDir
      },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, "build failed: " + result.stderr);
    const text = readFileSync(join(customDir, "index.html"), "utf8");
    assert.match(text, /window\.ALFRED_API_BASE = ""/);
    assert.match(text, /window\.ALFRED_BUILD_VERSION = "test-build"/);
  } finally {
    rmSync(customDir, { recursive: true, force: true });
  }
});

test("build is idempotent: second build replaces the first", () => {
  // Run twice; the second should overwrite cleanly.
  const r1 = spawnSync("node", ["scripts/build.mjs"], { cwd: pkgRoot, encoding: "utf8" });
  const r2 = spawnSync("node", ["scripts/build.mjs"], { cwd: pkgRoot, encoding: "utf8" });
  assert.equal(r1.status, 0);
  assert.equal(r2.status, 0);
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  // The script block appears exactly once (sentinel-based dedup).
  // Count only the assignment statements (config injection), not the function body reference.
  const matches = text.match(/window\.ALFRED_API_BASE =/g) || [];
  assert.equal(matches.length, 1, "should not duplicate the injection");
});

test("dist/index.html is self-contained (no external script src)", () => {
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  // No <script src="..."> tags (we are pure inline JS).
  const srcTags = text.match(/<script\s+src=/g) || [];
  assert.equal(srcTags.length, 0, "should be a single inline-JS bundle");
});

test("dist/index.html has CORS-friendly Authorization usage", () => {
  const text = readFileSync(join(distDir, "index.html"), "utf8");
  // Uses Authorization header (Bearer), not cookies, so CORS preflight is simple.
  assert.match(text, /"authorization":\s*"Bearer/);
});

test("hosted console manifests are retired", () => {
  assert.equal(existsSync(join(pkgRoot, "vercel.json")), false);
  assert.equal(existsSync(join(pkgRoot, "netlify.toml")), false);
});

test("console build rejects a cross-origin API override", () => {
  for (const base of ["https://alfred.example.com", "http://localhost:3000"]) {
    const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: pkgRoot, encoding: "utf8", env: { ...process.env, ALFRED_API_BASE: base } });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /own origin/);
  }
});

test("console API requests resolve on loopback aliases and custom ports", () => {
  const text = readFileSync(srcIndex, "utf8");
  const code = text.slice(text.indexOf("function apiBase(path) {"), text.indexOf("async function api("));
  const apiBase = new Function(code + "; return apiBase;")();
  for (const origin of ["http://localhost:4321", "http://127.0.0.2:9321", "http://[::1]:6789"]) {
    assert.equal(new URL(apiBase("/console/api/tenants"), origin).origin, origin);
  }
  assert.throws(() => apiBase("https://external.example/key"), /same-origin/);
  assert.throws(() => apiBase("//external.example/key"), /same-origin/);
});
