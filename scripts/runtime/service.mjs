import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { runRuntimeRequest } from "../../packages/core/src/runtime-authority.js";

const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const MAX_BYTES = 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const label = value => typeof value === "string" && value.length > 0 && value.length <= 4096 && !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value);
const fail = message => { throw new Error(message); };
const object = value => value && typeof value === "object" && !Array.isArray(value);
function keys(value, required, optional = []) {
  if (!object(value) || required.some(key => !Object.hasOwn(value, key)) ||
      Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) fail("Invalid runtime schema");
}
function regular(file, optional = false) {
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) {
    if (optional && error.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file) !== file) fail("Runtime files must be canonical regular files");
  return true;
}
function bytes(file) {
  regular(file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) fail("Runtime file is invalid or too large");
    const content = fs.readFileSync(fd);
    if (content.length > MAX_BYTES) fail("Runtime file is too large");
    return content;
  } finally { fs.closeSync(fd); }
}
function json(file) { return JSON.parse(bytes(file).toString("utf8")); }
function validateOption(option) {
  keys(option, ["id", "source", "contract", "action", "scope", "digest"]);
  if (!["id", "source", "action", "scope"].every(key => label(option[key])) ||
      !path.isAbsolute(option.source) || path.normalize(option.source) !== option.source ||
      option.contract !== "read-text-v1" || !HEX.test(option.digest)) fail("Invalid option or unsupported capability");
  return option;
}
function options(value) {
  if (!Array.isArray(value)) fail("Invalid options");
  value.forEach(validateOption);
  if (new Set(value.map(option => option.id)).size !== value.length) fail("Duplicate option identity");
  return value;
}
export function readInstructionManifest(file) {
  const content = bytes(file);
  const value = JSON.parse(content.toString("utf8"));
  keys(value, ["version", "instructions", "options"]);
  if (value.version !== 1 || !Array.isArray(value.instructions)) fail("Invalid instruction manifest");
  options(value.options);
  const ids = new Set();
  const matches = new Set();
  for (const instruction of value.instructions) {
    keys(instruction, ["id", "action", "scope", "disposition"], ["option"]);
    if (!["id", "action", "scope"].every(key => label(instruction[key])) ||
        !["deny", "execute"].includes(instruction.disposition)) fail("Invalid instruction");
    const match = JSON.stringify([instruction.action, instruction.scope]);
    if (ids.has(instruction.id) || matches.has(match)) fail("Ambiguous instruction manifest");
    ids.add(instruction.id); matches.add(match);
    if (instruction.disposition === "execute") {
      const option = value.options.find(item => item.id === instruction.option);
      if (!option || option.action !== instruction.action || option.scope !== instruction.scope) fail("Invalid instruction option reference");
    } else if (Object.hasOwn(instruction, "option")) fail("Deny instructions cannot execute");
  }
  return { ...value, token: sha(content) };
}
function runtimeDirectory(workspace, create = false) {
  let current = workspace;
  for (const segment of [".alfred", "runtime"]) {
    current = path.join(current, segment);
    if (create && !fs.existsSync(current)) fs.mkdirSync(current, { mode: 0o700 });
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.realpathSync(current) !== current) fail("Runtime directory must remain inside the canonical workspace");
  }
  return current;
}
function atomicJson(file, value) {
  regular(file, true);
  const temp = path.join(path.dirname(file), `.runtime-${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n"); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try { regular(file, true); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
function config(workspace) {
  const dir = runtimeDirectory(workspace);
  const value = json(path.join(dir, "project.json"));
  keys(value, ["version", "workspace_id", "instructions"]);
  if (value.version !== 1 || value.workspace_id !== workspace || !label(value.instructions) || !path.isAbsolute(value.instructions)) fail("Runtime workspace binding mismatch; initialize this workspace independently");
  return value;
}
function grants(workspace) {
  const file = path.join(runtimeDirectory(workspace), "grants.json");
  const value = json(file);
  keys(value, ["version", "workspace_id", "grants"]);
  if (value.version !== 1 || value.workspace_id !== workspace || !Array.isArray(value.grants)) fail("Invalid runtime grant store");
  for (const grant of value.grants) {
    keys(grant, ["workspace_id", "option_id", "source", "fingerprint", "action", "scope"]);
    if (grant.workspace_id !== workspace || !["option_id", "source", "action", "scope"].every(key => label(grant[key])) ||
        !HEX.test(grant.fingerprint) || !path.isAbsolute(grant.source)) fail("Invalid runtime grant");
  }
  return value;
}
export function initializeRuntime({ cwd = process.cwd(), instructions }) {
  if (!instructions) fail("runtime init requires --instructions pointing to a shared Alfred manifest");
  const workspace = fs.realpathSync(cwd);
  const manifest = fs.realpathSync(path.resolve(instructions));
  readInstructionManifest(manifest);
  const dir = runtimeDirectory(workspace, true);
  const file = path.join(dir, "project.json");
  if (regular(file, true)) {
    const existing = config(workspace);
    if (existing.instructions !== manifest) fail("Runtime already initialized with another instruction manifest");
    grants(workspace);
  } else {
    // Refuse orphan/copy state; initialization must never import another workspace's approvals.
    if (regular(path.join(dir, "grants.json"), true)) fail("Orphan runtime grants; move runtime state aside before initialization");
    atomicJson(path.join(dir, "grants.json"), { version: 1, workspace_id: workspace, grants: [] });
    atomicJson(file, { version: 1, workspace_id: workspace, instructions: manifest });
  }
  return runtimeStatus({ cwd });
}

export function locateRuntimeWorkspace(cwd = process.cwd()) {
  let candidate = fs.realpathSync(cwd);
  while (true) {
    const marker = path.join(candidate, ".alfred/runtime");
    try { fs.lstatSync(marker); return candidate; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    // A repository/worktree is an independent initialization boundary. Ordinary
    // non-Git subdirectories belong to the nearest initialized ancestor workspace.
    try {
      fs.lstatSync(path.join(candidate, ".git"));
      fail("This repository/worktree requires its own runtime initialization");
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const parent = path.dirname(candidate);
    if (parent === candidate) fail("No initialized Alfred runtime workspace found");
    candidate = parent;
  }
}

export function runtimeStatus({ cwd = process.cwd() } = {}) {
  const workspace = locateRuntimeWorkspace(cwd);
  const value = config(workspace);
  const store = grants(workspace);
  readInstructionManifest(value.instructions);
  return { initialized: true, workspace_id: workspace, instructions: value.instructions,
    project_file: path.join(workspace, ".alfred/runtime/project.json"),
    grants_file: path.join(workspace, ".alfred/runtime/grants.json"), grant_count: store.grants.length,
    capabilities: ["read-text-v1"], boundary: "managed CLI instruction loading only; native host tools are not intercepted" };
}

// The callable contract has no shell/process/network capability. Its implementation digest
// invalidates approvals when this adapter, authority implementation, or Node executable changes.
let executableDigest;
function contractFingerprint() {
  executableDigest ??= sha(fs.readFileSync(fs.realpathSync(process.execPath)));
  return sha(JSON.stringify(["read-text-v1", sha(bytes(fileURLToPath(import.meta.url))),
    sha(bytes(fileURLToPath(new URL("../../packages/core/src/runtime-authority.js", import.meta.url)))),
    fs.realpathSync(process.execPath), executableDigest]));
}
export function createRuntimePorts({ cwd = process.cwd(), home, selectOption, consent, trace = () => {} }) {
  const invocation = fs.realpathSync(cwd);
  const workspace = locateRuntimeWorkspace(cwd);
  const initial = config(workspace);
  const canonicalHome = fs.realpathSync(home);
  const catalog = path.join(canonicalHome, ".alfred/runtime/options.json");
  const implementation = contractFingerprint();
  return {
    workspace,
    ports: {
      trace,
      workspaceValid(request) {
        if (fs.realpathSync(cwd) !== invocation || locateRuntimeWorkspace(cwd) !== workspace || request.workspace_id !== workspace) return false;
        const current = config(workspace);
        grants(workspace);
        return current.instructions === initial.instructions;
      },
      lookupInstruction(request) {
        const manifest = readInstructionManifest(initial.instructions);
        const instruction = manifest.instructions.find(value => value.action === request.action && value.scope === request.scope);
        if (!instruction) return { status: "absent", token: manifest.token };
        return { status: "matched", disposition: instruction.disposition, token: manifest.token,
          option: manifest.options.find(value => value.id === instruction.option) };
      },
      discoverOptions(request) {
        // ENOENT alone means optional catalog absent; malformed or inaccessible is failure.
        if (!regular(catalog, true)) return [];
        const value = json(catalog);
        keys(value, ["version", "options"]);
        if (value.version !== 1) fail("Unsupported option catalog version");
        return options(value.options).filter(value => value.action === request.action && value.scope === request.scope);
      },
      selectOption,
      evaluatePolicy(request, option) {
        validateOption(option);
        return request.action === option.action && request.scope === option.scope;
      },
      prepareOption(request, option) {
        validateOption(option);
        const fingerprint = sha(JSON.stringify([workspace, option.id, option.source, option.contract,
          option.action, option.scope, option.digest, implementation]));
        const result = Object.freeze({ ...option, fingerprint });
        return result;
      },
      loadGrants() { return grants(workspace).grants; },
      saveGrant(request, grant) {
        const store = grants(workspace);
        if (!store.grants.some(value => JSON.stringify(value) === JSON.stringify(grant))) store.grants.push(grant);
        config(workspace);
        atomicJson(path.join(runtimeDirectory(workspace), "grants.json"), store);
      },
      consent,
      execute(request, option) {
        // This is the first source-content read, after authority/consent and revalidation.
        // Verify bytes before returning that same snapshot; never reread by path.
        const content = bytes(option.source);
        if (sha(content) !== option.digest) fail("Content digest changed; review and update the option catalog");
        const snapshot = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
        if (snapshot.includes("\0")) fail("Only UTF-8 text is supported");
        return { contract: "read-text-v1", content: snapshot, source: option.source };
      }
    }
  };
}
export async function runManagedRequest({ cwd, home, action, scope, option_id, selectOption, consent, trace }) {
  const runtime = createRuntimePorts({ cwd, home, selectOption, consent, trace });
  return runRuntimeRequest({ request_id: randomUUID(), workspace_id: runtime.workspace, action, scope, option_id }, runtime.ports);
}
