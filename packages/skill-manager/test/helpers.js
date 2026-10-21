import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSkillManager } from "../src/index.js";

export function put(path, value, mode = 0o644) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value);
  chmodSync(path, mode);
}

export function makeSkill(path, { name = "sample", version = "1.2.3", body = "Use the local sample.\n" } = {}) {
  put(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: A deterministic test skill.\n${version === null ? "" : `version: ${version}\n`}---\n\n${body}`);
  put(join(path, "references", "guide.md"), "Reference information.\n");
  put(join(path, "scripts", "check.sh"), "#!/bin/sh\nexit 0\n", 0o755);
  put(join(path, "assets", "binary.dat"), Buffer.from([0, 255, 13, 10, 1]));
  return path;
}

export function fixture(t, options = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "alfred-skills-qa-")));
  const cwd = join(root, "project");
  const home = join(root, "home");
  mkdirSync(cwd); mkdirSync(home);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = makeSkill(join(root, "source"));
  const create = (extra = {}) => createSkillManager({ cwd, home, env: {}, ...options, ...extra });
  const manager = create();
  return { root, cwd, home, source, create, manager, lock: join(cwd, ".alfred", "skills-lock.json") };
}

export const selection = { harness: "codex", scope: "project" };

export function installPlan(f, options = {}) {
  return f.manager.plan({ operation: "install", source: f.source, ...selection, ...options });
}

export async function install(f, options = {}) {
  const plan = await installPlan(f, options);
  assert.equal(plan.status, "preview", JSON.stringify(plan.blockers));
  const result = await f.manager.apply(plan, { approval: true });
  assert.equal(result.status, "applied");
  return { plan, result, target: plan.targetPath };
}

export function tree(path) {
  if (!existsSync(path)) return null;
  const output = {};
  function visit(current, relative) {
    const info = lstatSync(current);
    if (info.isDirectory()) {
      output[relative + "/"] = { mode: info.mode & 0o777 };
      for (const name of readdirSync(current).sort()) visit(join(current, name), relative ? `${relative}/${name}` : name);
    } else if (info.isSymbolicLink()) {
      output[relative] = { symlink: true };
    } else output[relative] = { mode: info.mode & 0o777, bytes: readFileSync(current).toString("base64") };
  }
  visit(path, "");
  return output;
}

export function receipt(f, scope = "project") {
  return JSON.parse(readFileSync(join(scope === "project" ? f.cwd : f.home, ".alfred", "skills-lock.json"), "utf8"));
}

export async function rejectedPlan(makePlan, pattern) {
  try {
    const plan = await makePlan();
    assert.equal(plan.status, "blocked", "Unsafe operation must throw or return a blocked plan");
    if (pattern) assert.match(JSON.stringify(plan.blockers), pattern);
    return plan;
  } catch (error) {
    if (error.code === "ERR_ASSERTION") throw error;
    if (pattern) assert.match(`${error.code} ${error.message}`, pattern);
    return error;
  }
}

export function assertTrace(value, status) {
  assert.equal(value.provider_calls, 0);
  assert.equal(value.trace.event, "skill_manager_operation");
  assert.equal(value.trace.data.provider_calls, 0);
  if (status) assert.equal(value.trace.data.status, status);
  assert.ok(value.trace.timestamp);
  assert.ok(value.trace.trace_id);
}
