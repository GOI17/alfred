import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync, writeFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createSession, cleanEnvironment, safeText, schema } from "./bridge.mjs";
const root = resolve(import.meta.dirname, "../..");
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "alfred-setup-bridge-"));
  const home = join(directory, "home with spaces"), project = join(directory, "project with spaces"); mkdirSync(home); mkdirSync(project);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { home, project, env: { PATH: process.env.PATH, HOME: home, ALFRED_DISTRIBUTION: "homebrew" } };
}
const selection = { edition: "coding", harnesses: [], memory: "decide-later", name: "test", path: root, profiles: false };
const request = (id, operation, extra = {}) => ({ schema, id, operation, ...extra });
test("JSONL real discover/preview stays clean and exits on EOF without writes", async t => {
  const f = fixture(t);
  const child = spawn(process.execPath, [join(root, "scripts/setup/bridge.mjs")], { cwd: f.project, env: f.env });
  t.after(() => child.kill());
  let stdout = ""; child.stdout.on("data", bytes => stdout += bytes);
  child.stdin.write(JSON.stringify(request("a", "discover")) + "\n" + JSON.stringify(request("b", "preview", { selection })) + "\n");
  const deadline = Date.now() + 5000;
  while (stdout.trim().split("\n").length < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  const lines = stdout.trim().split("\n").map(JSON.parse);
  assert.equal(lines.length, 2); assert.equal(lines[0].data.defaults.path, root); assert.equal(lines[1].ok, true, JSON.stringify(lines[1]));
  assert.match(lines[1].data.text, /ALFRED SUITE INSTALL PREVIEW/);
  assert.match(lines[1].data.text, /\.alfred\/setup\/previews/);
  child.stdin.end(); const [code] = await once(child, "exit"); assert.equal(code, 0);
  assert.deepEqual(readdirSync(f.home), []); assert.deepEqual(readdirSync(f.project), []);
});
test("actual approved apply preserves spaces in project previews and home trace paths", async t => {
  const f = fixture(t), session = createSession({ cwd: f.project, env: f.env });
  const denied = await session(request("a", "apply", { selection, confirmed: true, previewToken: "missing" })); assert.equal(denied.error.code, "consent_required");
  const preview = await session(request("b", "preview", { selection })); assert.equal(preview.ok, true);
  const applied = await session(request("c", "apply", { selection, previewToken: preview.data.previewToken, confirmed: true })); assert.equal(applied.ok, true, JSON.stringify(applied));
  const generations = readdirSync(join(f.project, ".alfred/setup/previews"));
  assert.equal(generations.length, 1);
  assert.ok(existsSync(join(f.project, ".alfred/setup/previews", generations[0], "install-handoff.txt")));
  assert.equal(applied.data.status, "previews_only");
  assert.ok(existsSync(join(f.home, ".alfred/observability/install-trace.json")));
  assert.ok(!existsSync(join(f.home, ".alfred/runtime-profiles")));
  assert.ok(!existsSync(join(f.project, ".codex"))); assert.ok(!existsSync(join(f.project, ".alfred/runtime")));
  const replay = await session(request("d", "apply", { selection, previewToken: preview.data.previewToken, confirmed: true })); assert.equal(replay.error.code, "consent_required");
});
test("exact selection, explicit confirmation and failed-preview invalidation gate apply", async t => {
  const f = fixture(t); let applies = 0;
  const session = createSession({ cwd: f.project, env: f.env, execute: async args => { if (args.includes("--apply")) applies++; return "review"; } });
  let p = await session(request("p1", "preview", { selection }));
  assert.equal((await session(request("a1", "apply", { selection: { ...selection, name: "changed" }, previewToken: p.data.previewToken, confirmed: true }))).error.code, "consent_required");
  p = await session(request("p2", "preview", { selection }));
  assert.equal((await session(request("a2", "apply", { selection, previewToken: p.data.previewToken }))).error.code, "consent_required");
  p = await session(request("p3", "preview", { selection }));
  assert.equal((await session(request("bad", "preview", { selection: { ...selection, name: "bad\nname" } }))).ok, false);
  assert.equal((await session(request("a3", "apply", { selection, previewToken: p.data.previewToken, confirmed: true }))).error.code, "consent_required");
  assert.equal(applies, 0);
});
test("environment overrides cannot alter exact preview or handoff", async t => {
  const f = fixture(t), env = { ...f.env, ALFRED_INSTALL_FORCE_TUI: "1", ALFRED_INSTALL_APP_TUI_EVENTS: "set:apply=true,submit", ALFRED_INSTALL_HANDOFF_INPUT: "2" };
  assert.deepEqual(Object.keys(cleanEnvironment(env)).filter(key => key.startsWith("ALFRED_INSTALL_")), ["ALFRED_INSTALL_TUI_BACKEND"]);
  const session = createSession({ cwd: f.project, env });
  const result = await session(request("a", "preview", { selection })); assert.equal(result.ok, true);
  assert.deepEqual(readdirSync(f.home), []); assert.deepEqual(readdirSync(f.project), []);
});
test("unsafe output symlink is rejected even when dangling", async t => {
  const f = fixture(t); symlinkSync(join(f.home, "outside"), join(f.project, ".alfred"));
  const session = createSession({ cwd: f.project, env: f.env });
  assert.equal((await session(request("a", "preview", { selection }))).ok, false);
  assert.deepEqual(readdirSync(f.home), []);
});
test("changed preview, duplicate IDs, malformed selection and missing source fail closed", async t => {
  const f = fixture(t); let n = 0, applies = 0;
  const session = createSession({ cwd: f.project, env: f.env, execute: async args => { if (args.includes("--apply")) applies++; return `preview${n++}`; } });
  const p = await session(request("a", "preview", { selection }));
  assert.equal((await session(request("b", "apply", { selection, previewToken: p.data.previewToken, confirmed: true }))).error.code, "preview_changed");
  assert.equal((await session(request("a", "discover"))).ok, false);
  assert.equal((await session(request("c", "preview", { selection: { ...selection, harnesses: ["$(touch wrong)"] } }))).ok, false);
  assert.equal((await session(request("d", "preview", { selection: { ...selection, unexpected: true } }))).ok, false);
  const source = createSession({ cwd: f.project, env: { ...f.env, ALFRED_DISTRIBUTION: "source" } });
  assert.equal((await source(request("a", "preview", { selection: { ...selection, path: join(f.project, "missing") } }))).ok, false);
  assert.equal(applies, 0);
});
test("terminal strings remove control injection and oversized protocol exits promptly", async t => {
  assert.equal(safeText("hello\x1b[2Jworld\x1b]0;title\x07\x07"), "helloworld");
  const f = fixture(t), child = spawn(process.execPath, [join(root, "scripts/setup/bridge.mjs")], { cwd: f.project, env: f.env });
  let stdout = ""; child.stdout.on("data", bytes => stdout += bytes);
  child.stdin.end("x".repeat(70000));
  const [code] = await once(child, "exit"); assert.equal(code, 0); assert.equal(JSON.parse(stdout.trim()).error.code, "request_too_large");
});

test("selected harness review artifacts are generated outside the installed runtime", async t => {
  const f = fixture(t), session = createSession({ cwd: f.project, env: f.env });
  const selected = { ...selection, harnesses: ["codex-cli", "codex-app", "opencode"] };
  const p = await session(request("p", "preview", { selection: selected })); assert.equal(p.ok, true);
  const a = await session(request("a", "apply", { selection: selected, previewToken: p.data.previewToken, confirmed: true })); assert.equal(a.ok, true, JSON.stringify(a));
  assert.equal(a.data.status, "activation_review", JSON.stringify(a));
  const generation = readdirSync(join(f.project, ".alfred/setup/previews"))[0];
  const generated = join(f.project, ".alfred/setup/previews", generation);
  assert.ok(existsSync(join(generated, "codex-install/AGENTS.md")));
  assert.ok(existsSync(join(generated, "opencode-install/activation-manifest.json")));
  assert.ok(!existsSync(join(f.project, ".agents"))); assert.ok(!existsSync(join(f.project, ".opencode")));
  const activated = await session(request("activate", "activate", { selection: selected, previewToken: a.data.previewToken, confirmed: true }));
  assert.equal(activated.data.status, "activation_verified", JSON.stringify(activated));
  for (const path of [".agents/skills/alfred/SKILL.md", ".opencode/skills/alfred/SKILL.md", ".opencode/commands/alfred.md", ".codex/agents/developer.toml"]) assert.ok(existsSync(join(f.project, path)), path);
  assert.match(activated.data.text, /NEW harness session/);
});

test("bidi spoofing is rejected in paths and removed from terminal text", async t => {
  const f = fixture(t), session = createSession({ cwd: f.project, env: f.env });
  for (const character of ["\u202e", "\u2066"]) {
    const response = await session(request("bidi" + character.charCodeAt(0), "preview", { selection: { ...selection, path: root + character } }));
    assert.equal(response.error.code, "invalid_selection");
    assert.equal(safeText("cwd /tmp/" + character + "unsafe"), "cwd /tmp/unsafe");
  }
});
test("cancellation during refresh prevents apply and all later subprocesses", async t => {
  const f = fixture(t), controller = new AbortController(); let calls = 0, applies = 0;
  const session = createSession({ cwd: f.project, env: f.env, signal: controller.signal, execute: async args => {
    calls++; if (args.includes("--apply")) applies++; if (calls === 2) controller.abort(); return "review";
  } });
  const preview = await session(request("a", "preview", { selection }));
  const applied = await session(request("b", "apply", { selection, confirmed: true, previewToken: preview.data.previewToken }));
  assert.equal(applied.error.code, "cancelled"); assert.equal(applies, 0);
  assert.equal((await session(request("c", "preview", { selection }))).error.code, "cancelled"); assert.equal(calls, 2);
});


test("update discovery is local, explicit check is advisory, runtime approval is one-use", async t => {
  const f=fixture(t);let checks=0,handoffs=0;
  const session=createSession({cwd:f.project,env:f.env,check:async()=>{checks++;return {status:"available",text:"Alfred update available",currentVersion:"1.0.1",latestVersion:"1.1.0",canUpgrade:true};},handoff:()=>{handoffs++;}});
  const d=await session(request("d","discover"));assert.equal(d.data.project.status,"none");assert.equal(checks,0);assert.equal(handoffs,0);
  assert.deepEqual(readdirSync(f.project),[]);
  const checked=await session(request("c","check-update"));assert.equal(checked.data.status,"available");assert.equal(checks,1);
  const review=await session(request("r","runtime-preview",{selection}));assert.equal(review.data.status,"runtime_review");assert.equal(handoffs,0);
  assert.equal((await session(request("bad","runtime-approve",{selection,previewToken:review.data.previewToken}))).error.code,"consent_required");
  assert.equal(handoffs,0);
  const again=await session(request("r2","runtime-preview",{selection}));
  const approved=await session(request("a","runtime-approve",{selection,previewToken:again.data.previewToken,confirmed:true}));assert.equal(approved.data.status,"runtime_upgrade_approved");assert.equal(handoffs,1);
  assert.equal((await session(request("replay","runtime-approve",{selection,previewToken:again.data.previewToken,confirmed:true}))).error.code,"consent_required");assert.equal(handoffs,1);
});

test("saved integration updates through the real bridge without running the suite installer again", async t => {
  const f=fixture(t), selected={...selection,harnesses:["codex-cli","opencode"]};
  const first=createSession({cwd:f.project,env:f.env});
  const p=await first(request("p","preview",{selection:selected}));
  const a=await first(request("a","apply",{selection:selected,previewToken:p.data.previewToken,confirmed:true}));
  const installed=await first(request("i","activate",{selection:selected,previewToken:a.data.previewToken,confirmed:true}));assert.equal(installed.data.status,"activation_verified");
  const receipt=join(f.project,".alfred/setup/installation.json"), previous=JSON.parse(readFileSync(receipt));previous.integrationVersion="0.0.1";writeFileSync(receipt,JSON.stringify(previous));
  let installers=0, checkStatus="current";
  const updated=createSession({cwd:f.project,env:{...f.env,ALFRED_SETUP_RESUME:"1"},check:async()=>({status:checkStatus,text:"Advisory version check",currentVersion:"1.0.1",latestVersion:"1.0.1",canUpgrade:false}),execute:async()=>{installers++;throw new Error("must not run installer");}});
  const d=await updated(request("d","discover"));assert.equal(d.data.resume,true);assert.equal(d.data.project.canUpdate,true);assert.deepEqual(d.data.defaults.harnesses,["opencode","codex-cli"]);assert.equal(d.data.defaults.name,"test");
  const saved=d.data.defaults;
  const review=await updated(request("r","project-preview",{selection:saved}));assert.equal(review.data.status,"project_review",JSON.stringify(review));
  assert.equal((await updated(request("check-after-review","check-update"))).data.status,"current");
  assert.equal((await updated(request("deny","project-decline",{selection:saved,previewToken:review.data.previewToken}))).data.status,"project_declined");
  assert.equal(JSON.parse(readFileSync(receipt)).integrationVersion,"0.0.1");
  assert.equal((await updated(request("check-before-review","check-update"))).data.status,"current");
  const again=await updated(request("r2","project-preview",{selection:saved}));
  checkStatus="unavailable";
  assert.equal((await updated(request("check-after-second-review","check-update"))).data.status,"unavailable");
  const applied=await updated(request("u","project-apply",{selection:saved,previewToken:again.data.previewToken,confirmed:true}));assert.equal(applied.data.status,"project_verified",JSON.stringify(applied));
  assert.equal(installers,0);assert.equal(JSON.parse(readFileSync(receipt)).integrationVersion,d.data.version);
  const noop=await updated(request("n","project-preview",{selection:saved}));assert.equal(noop.data.status,"project_current",JSON.stringify(noop));
  assert.equal((await updated(request("replay","project-apply",{selection:saved,previewToken:again.data.previewToken,confirmed:true}))).error.code,"consent_required");
});
