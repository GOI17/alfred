import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdirSync, renameSync, symlinkSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { buildActivationPlan, activatePlan, describeActivation } from "./activation.mjs";
import { fixture, generate, put } from "./activation-fixture.mjs";
import { createSession, schema } from "./bridge.mjs";

function prepared(t) { const f = fixture(t); generate(f.previewRoot, "codex"); generate(f.previewRoot, "opencode"); return f; }
test("Codex and OpenCode activate enumerated files, preserve settings and reapply without writes", t => {
  const f = prepared(t);
  put(join(f.projectRoot, "AGENTS.md"), "Project rules\n");
  const settings = { model: "user-owned", provider: { local: { options: { apiKey: "fixture-only-never-display" } } }, plugin: ["user-plugin"], permission: { bash: { "*": "deny" } }, instructions: ["CUSTOM.md"], default_agent: "personal" };
  put(join(f.projectRoot, "opencode.json"), JSON.stringify(settings));
  put(join(f.previewRoot, "codex-install/.codex/agents/obsolete.toml"), "not selected");
  put(join(f.previewRoot, "codex-cli-install/.codex/agents/developer.toml"), "stale alias");
  const plan = buildActivationPlan(f), text = describeActivation(plan);
  assert.ok(!text.includes("fixture-only-never-display"));
  assert.ok(!existsSync(join(f.projectRoot, ".agents")));
  const result = activatePlan(plan); assert.equal(result.status, "activation_verified", result.text);
  assert.ok(readFileSync(join(f.projectRoot, "AGENTS.md"), "utf8").startsWith("Project rules\n"));
  const config = JSON.parse(readFileSync(join(f.projectRoot, "opencode.json")));
  for (const name of ["model", "provider", "plugin", "default_agent"]) assert.deepEqual(config[name], settings[name]);
  assert.equal(config.permission.bash["*"], "deny"); assert.deepEqual(config.instructions, ["CUSTOM.md", "AGENTS.md"]);
  assert.ok(existsSync(join(f.projectRoot, ".agents/skills/alfred/SKILL.md")));
  assert.ok(existsSync(join(f.projectRoot, ".opencode/commands/alfred.md")));
  assert.ok(!existsSync(join(f.projectRoot, ".codex/agents/obsolete.toml")));
  assert.deepEqual(activatePlan(buildActivationPlan(f)).written, []);
});
test("active Codex override is merged without touching AGENTS.md", t => {
  const f = prepared(t); put(join(f.projectRoot, "AGENTS.override.md"), "Override rules\n"); put(join(f.projectRoot, "AGENTS.md"), "base rules");
  assert.equal(activatePlan(buildActivationPlan(f)).status, "activation_verified");
  assert.match(readFileSync(join(f.projectRoot, "AGENTS.override.md"), "utf8"), /^Override rules\n/);
  assert.equal(readFileSync(join(f.projectRoot, "AGENTS.md"), "utf8"), "base rules");
});
for (const conflict of ["artifact", "jsonc", "json", "markers", "symlink", "dangling-parent"]) test(`preflight ${conflict} conflict writes nothing`, t => {
  const f = prepared(t);
  if (conflict === "artifact") put(join(f.projectRoot, ".opencode/agents/reviewer.md"), "user customized");
  if (conflict === "jsonc") put(join(f.projectRoot, "opencode.jsonc"), "{ /* keep */ }");
  if (conflict === "json") put(join(f.projectRoot, "opencode.json"), "{invalid}");
  if (conflict === "markers") put(join(f.projectRoot, "AGENTS.md"), "<!-- alfred:codex-primary:begin -->");
  if (conflict === "symlink") symlinkSync(f.installRoot, join(f.projectRoot, ".codex"));
  if (conflict === "dangling-parent") symlinkSync(join(f.root, "absent"), join(f.projectRoot, ".agents"));
  assert.throws(() => buildActivationPlan(f));
  assert.ok(!existsSync(join(f.projectRoot, ".opencode/skills/alfred/SKILL.md")));
});
for (const changed of ["source", "manifest", "target", "override", "project", "ancestor-symlink"]) test(`changed ${changed} after review fails before writes`, t => {
  const f = prepared(t), plan = buildActivationPlan(f);
  if (changed === "source") put(join(f.previewRoot, "codex-install/.agents/skills/alfred/SKILL.md"), "changed");
  if (changed === "manifest") put(join(f.previewRoot, "codex-install/activation-manifest.json"), "{}");
  if (changed === "target") put(join(f.projectRoot, "AGENTS.md"), "concurrent rules");
  if (changed === "override") put(join(f.projectRoot, "AGENTS.override.md"), "new override");
  if (changed === "project") { renameSync(f.projectRoot, join(f.root, "old-project")); mkdirSync(f.projectRoot); }
  if (changed === "ancestor-symlink") symlinkSync(f.installRoot, join(f.projectRoot, ".agents"));
  const result = activatePlan(plan); assert.equal(result.status, "activation_failed"); assert.deepEqual(result.written, []);
});
test("source symlinks, missing required artifacts and traversal manifests fail closed", t => {
  const f = prepared(t), source = join(f.previewRoot, "codex-install/.agents/skills/alfred/SKILL.md");
  rmSync(source); symlinkSync(join(f.installRoot, "install.sh"), source); assert.throws(() => buildActivationPlan(f));
  rmSync(source); generate(f.previewRoot, "codex");
  const path = join(f.previewRoot, "codex-install/activation-manifest.json"), manifest = JSON.parse(readFileSync(path));
  manifest.files = manifest.files.filter(e => e.target !== ".agents/skills/alfred/SKILL.md"); put(path, JSON.stringify(manifest));
  assert.throws(() => buildActivationPlan(f), /Missing required/);
  manifest.files[0].target = "../escape"; put(path, JSON.stringify(manifest)); assert.throws(() => buildActivationPlan(f), /manifest destination/);
});
test("failed writes report partial state, and verification catches corrupted writes", t => {
  const f = prepared(t), plan = buildActivationPlan(f); let calls = 0;
  const result = activatePlan(plan, { write(path, content) { if (++calls === 2) throw Object.assign(new Error("secret filesystem detail"), { code: "EACCES" }); put(path, content); } });
  assert.equal(result.status, "activation_partial"); assert.equal(result.written.length, 1); assert.ok(!result.text.includes("secret filesystem detail"));
  const retry = buildActivationPlan(f), failed = activatePlan(retry, { write(path) { put(path, "corrupt"); } });
  assert.equal(failed.status, "activation_partial"); assert.match(failed.text, /Verification failed/);
});
const request = (id, operation, extra = {}) => ({ schema, id, operation, ...extra });
function sessionFixture(t, { signal, nested = false } = {}) {
  const f = fixture(t), selection = { edition: "coding", harnesses: f.harnesses, memory: "decide-later", name: "test", path: f.installRoot, profiles: false };
  if (nested) { f.projectRoot = join(f.projectRoot, "selected-subdirectory"); mkdirSync(f.projectRoot); }
  const session = createSession({ signal, installRoot: f.installRoot, cwd: f.projectRoot, env: { ALFRED_DISTRIBUTION: "homebrew" }, execute: async args => {
    if (args.includes("--apply")) { const output = args.find(a => a.startsWith("--preview-output=")).split("=").slice(1).join("="); mkdirSync(output, { recursive: true }); generate(output, "codex"); generate(output, "opencode"); }
    return "Fixture setup: previews only";
  } });
  return { ...f, selection, session };
}
async function review(f, suffix = "") {
  const p = await f.session(request("preview" + suffix, "preview", { selection: f.selection })); assert.equal(p.ok, true);
  const a = await f.session(request("apply" + suffix, "apply", { selection: f.selection, previewToken: p.data.previewToken, confirmed: true }));
  assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(a.data.status, "activation_review", JSON.stringify(a));
  assert.ok(!existsSync(join(f.projectRoot, ".agents"))); return a.data.previewToken;
}
test("bridge preparation then separate approval installs and verifies real project files", async t => {
  const f = sessionFixture(t), token = await review(f);
  const response = await f.session(request("activate", "activate", { selection: f.selection, previewToken: token, confirmed: true }));
  assert.equal(response.data.status, "activation_verified", JSON.stringify(response));
  assert.ok(existsSync(join(f.projectRoot, ".agents/skills/alfred/SKILL.md")));
  assert.ok(existsSync(join(f.projectRoot, ".opencode/skills/alfred/SKILL.md")));
  assert.equal(response.data.traceEvents[0].human_approval, true); assert.equal(response.data.traceEvents[0].provider_calls, 0);
  assert.match(response.data.text, /NEW harness session/);
  assert.equal((await f.session(request("replay", "activate", { selection: f.selection, previewToken: token, confirmed: true }))).error.code, "consent_required");
});
for (const denial of ["decline", "missing", "changed-selection", "stale-target", "invalid-request"]) test(`bridge ${denial} cannot activate`, async t => {
  const f = sessionFixture(t), token = await review(f);
  if (denial === "stale-target") put(join(f.projectRoot, "AGENTS.md"), "new text");
  if (denial === "invalid-request") await f.session(request("bad", "unknown"));
  const r = await f.session(request("decision", denial === "decline" ? "decline" : "activate", { selection: denial === "changed-selection" ? { ...f.selection, name: "other" } : f.selection, previewToken: token, confirmed: denial !== "missing" }));
  if (denial === "decline") assert.equal(r.data.status, "activation_declined");
  else if (denial === "stale-target") assert.equal(r.data.status, "activation_failed");
  else assert.equal(r.error.code, "consent_required");
  assert.ok(!existsSync(join(f.projectRoot, ".agents"))); assert.ok(!existsSync(join(f.projectRoot, ".opencode")));
});
test("subdirectory and worktree metadata cannot redirect installation to a common checkout", async t => {
  const f = sessionFixture(t);
  put(join(f.projectRoot, ".git"), `gitdir: ${f.installRoot}/.git/worktrees/project\n`);
  const token = await review(f);
  const r = await f.session(request("a", "activate", { selection: f.selection, previewToken: token, confirmed: true }));
  assert.equal(r.data.status, "activation_verified"); assert.ok(!existsSync(join(f.installRoot, ".agents")));
});


test("cancelling after review invalidates activation without writes", async t => {
 const controller = new AbortController(), f = sessionFixture(t, { signal: controller.signal }), token = await review(f);
 controller.abort();
 const response = await f.session(request("cancelled", "activate", { selection: f.selection, previewToken: token, confirmed: true }));
 assert.equal(response.error.code, "cancelled"); assert.ok(!existsSync(join(f.projectRoot, ".agents")));
});
test("an explicitly invoking subdirectory stays the activation target", async t => {
 const f = sessionFixture(t, { nested: true }), token = await review(f);
 const response = await f.session(request("install", "activate", { selection: f.selection, previewToken: token, confirmed: true }));
 assert.equal(response.data.status, "activation_verified");
 assert.ok(existsSync(join(f.projectRoot, ".agents/skills/alfred/SKILL.md")));
 assert.ok(!existsSync(join(f.projectRoot, "../.agents")));
});
