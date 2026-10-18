#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { dirname, delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const schema = "alfred.setup/v1";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const harnessIds = ["opencode", "codex-cli", "codex-app", "pi"];
const unsafe = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/u;
const digest = value => createHash("sha256").update(value).digest("hex");
const fault = (code, message) => Object.assign(new Error(message), { code });
export function safeText(text) {
  return String(text).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/g, "");
}
function keys(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fault("invalid_request", "Unexpected request fields.");
}
export function normalizeSelection(value, { packaged, installRoot }) {
  keys(value, ["edition", "harnesses", "memory", "name", "path", "profiles"]);
  if (!["coding", "memory", "full"].includes(value.edition) || !["decide-later", "existing-tenant", "local-sqlite", "postgres"].includes(value.memory) || typeof value.profiles !== "boolean") throw fault("invalid_selection", "Choose supported setup options.");
  if (!Array.isArray(value.harnesses) || value.harnesses.length > 4 || new Set(value.harnesses).size !== value.harnesses.length || value.harnesses.some(id => !harnessIds.includes(id))) throw fault("invalid_selection", "Choose supported harnesses.");
  if (typeof value.name !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(value.name)) throw fault("invalid_selection", "Name must contain letters, numbers, dots, underscores or hyphens.");
  if (typeof value.path !== "string" || value.path.length > 4096 || unsafe.test(value.path) || /["\\]/.test(value.path) || !isAbsolute(value.path)) throw fault("invalid_selection", "Choose an absolute installation path.");
  const selectedPath = resolve(value.path);
  if (packaged && selectedPath !== installRoot) throw fault("invalid_selection", "The Homebrew installation path is read-only.");
  return { edition: value.edition, harnesses: harnessIds.filter(id => value.harnesses.includes(id)), memory: value.memory, name: value.name, path: selectedPath, profiles: value.profiles };
}
export function cleanEnvironment(env) {
  const result = { ...env };
  for (const key of Object.keys(result)) if (key.startsWith("ALFRED_INSTALL_")) delete result[key];
  result.ALFRED_INSTALL_TUI_BACKEND = "node";
  return result;
}
const activeChildren = new Set();
function stopChild(child, signal = "SIGTERM") {
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch {} }
}
export function runInstaller(args, { cwd, env, installRoot, signal }) {
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(fault("cancelled", "Setup was cancelled.")); return; }
    const child = spawn("sh", [join(installRoot, "install.sh"), ...args], { cwd, env: cleanEnvironment(env), stdio: ["ignore", "pipe", "pipe"], detached: true });
    activeChildren.add(child);
    let stdout = "", stderr = "", oversized = false;
    let forceTimeout;
    const stop = () => { stopChild(child); forceTimeout = setTimeout(() => stopChild(child, "SIGKILL"), 500); forceTimeout.unref(); };
    const timeout = setTimeout(stop, 30000);
    signal?.addEventListener("abort", stop, { once: true });
    const capture = key => bytes => {
      if (stdout.length + stderr.length + bytes.length > 1024 * 1024) { oversized = true; stop(); return; }
      if (key === "stdout") stdout += bytes; else stderr += bytes;
    };
    child.stdout.on("data", capture("stdout")); child.stderr.on("data", capture("stderr"));
    child.on("error", () => { clearTimeout(timeout); clearTimeout(forceTimeout); signal?.removeEventListener("abort", stop); activeChildren.delete(child); reject(fault("installer_failed", "Setup could not start.")); });
    child.on("close", code => { clearTimeout(timeout); clearTimeout(forceTimeout); signal?.removeEventListener("abort", stop); activeChildren.delete(child); if (oversized || code !== 0) reject(fault("installer_failed", args.includes("--apply") ? "Setup did not finish. Some approved files may have been written; inspect the preview locations before retrying." : "Setup preview failed; no apply was attempted.")); else resolveResult(safeText(stdout)); });
  });
}
export function createSession({ installRoot = root, cwd = process.cwd(), env = process.env, execute = runInstaller, signal } = {}) {
  installRoot = realpathSync(installRoot); cwd = realpathSync(cwd);
  const packaged = env.ALFRED_DISTRIBUTION === "homebrew";
  let approval = null;
  const seen = new Set();
  let busy = false;
  const context = { installRoot, cwd, env, signal };
  signal?.addEventListener("abort", () => { approval = null; }, { once: true });
  const notCancelled = () => { if (signal?.aborted) throw fault("cancelled", "Setup was cancelled."); };
  const fingerprint = () => digest(readFileSync(join(installRoot, "install.sh")));
  function argv(selection, apply = false) {
    return [`--edition=${selection.edition}`, `--harness=${selection.harnesses.join(",") || "none"}`, `--memory=${selection.memory}`, `--name=${selection.name}`, `--path=${selection.path}`, "--no-clone", `--preview-output=${join(cwd, ".alfred/setup/previews")}`, ...(selection.profiles ? [] : ["--skip-profile-manager"]), ...(apply ? ["--apply"] : [])];
  }
  return async request => {
    let id = "";
    if (busy) { approval = null; return { schema, id, ok: false, error: { code: "busy", message: "Another setup operation is in progress." } }; }
    busy = true;
    try {
      notCancelled();
      keys(request, ["schema", "id", "operation", "selection", "previewToken", "confirmed"]);
      if (request.schema !== schema || typeof request.id !== "string" || !/^[a-zA-Z0-9._-]{1,80}$/.test(request.id)) throw fault("invalid_request", "Invalid setup protocol request.");
      id = request.id;
      if (seen.has(id) || seen.size >= 512) throw fault("invalid_request", "Duplicate request or session limit reached.");
      seen.add(id);
      if (request.operation === "discover") {
        keys(request, ["schema", "id", "operation"]);
        const commands = { opencode: "opencode", "codex-cli": "codex", "codex-app": "codex", pi: "pi" };
        const harnesses = Object.fromEntries(harnessIds.map(id => [id, (env.PATH || "").split(delimiter).some(p => p && existsSync(join(p, commands[id]))) ? "installed" : "not-installed"]));
        return { schema, id, ok: true, data: { version: JSON.parse(readFileSync(join(installRoot, "package.json"))).version, packaged, defaults: { edition: "coding", harnesses: [], memory: "decide-later", name: "default", path: installRoot, profiles: true }, capabilities: { platform: process.platform, arch: process.arch, node: process.version, harnesses } } };
      }
      if (!["preview", "apply"].includes(request.operation)) throw fault("invalid_request", "Unknown setup operation.");
      const selection = normalizeSelection(request.selection, { packaged, installRoot });
      if (!existsSync(selection.path) || lstatSync(selection.path).isSymbolicLink() || realpathSync(selection.path) !== selection.path || !existsSync(join(selection.path, "install.sh"))) throw fault("invalid_selection", "Use an existing Alfred installation; setup does not download source.");
      const binding = JSON.stringify({ selection, cwd, installRoot, previewRoot: join(cwd, ".alfred/setup/previews"), installer: fingerprint() });
      if (request.operation === "preview") {
        approval = null;
        keys(request, ["schema", "id", "operation", "selection"]);
        const text = await execute(argv(selection), context);
        notCancelled();
        const previewToken = randomBytes(32).toString("hex");
        approval = { previewToken, binding, text };
        return { schema, id, ok: true, data: { text: safeText(text), previewToken } };
      }
      const current = approval; approval = null;
      if (request.confirmed !== true || !current || request.previewToken !== current.previewToken || binding !== current.binding) throw fault("consent_required", "Review this exact setup and explicitly confirm Apply.");
      const refreshed = await execute(argv(selection), context);
      notCancelled();
      if (refreshed !== current.text) throw fault("preview_changed", "Setup changed since review. Generate a new preview.");
      const text = await execute(argv(selection, true), context);
      return { schema, id, ok: true, data: { text: safeText(text) } };
    } catch (error) {
      approval = null;
      return { schema, id, ok: false, error: { code: error.code?.startsWith?.("E") ? "setup_failed" : error.code || "invalid_request", message: safeText(error.code && !error.code.startsWith("E") ? error.message : "Setup request failed.") } };
    } finally { busy = false; }
  };
}
export async function serve(input = process.stdin, output = process.stdout, controller = new AbortController()) {
  const session = createSession({ signal: controller.signal }); let buffer = "";
  input.once("end", () => controller.abort());
  input.once("close", () => controller.abort());
  for await (const chunk of input) {
    buffer += chunk.toString();
    if (Buffer.byteLength(buffer) > 65536) { output.write(JSON.stringify({ schema, id: "", ok: false, error: { code: "request_too_large", message: "Setup request is too large." } }) + "\n"); return; }
    while (buffer.includes("\n")) {
      const end = buffer.indexOf("\n"), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
      let response;
      try { response = await session(JSON.parse(line)); } catch { await session(null); response = { schema, id: "", ok: false, error: { code: "invalid_json", message: "Invalid JSON request." } }; }
      output.write(JSON.stringify(response) + "\n");
    }
  }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const controller = new AbortController();
  for (const [signal, code] of [["SIGTERM", 143], ["SIGINT", 130]]) process.once(signal, () => {
    controller.abort();
    for (const child of activeChildren) stopChild(child);
    setTimeout(() => { for (const child of activeChildren) stopChild(child, "SIGKILL"); process.exit(code); }, 600);
  });
  await serve(process.stdin, process.stdout, controller);
}
