#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, lstatSync } from "node:fs";
import { dirname, delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildActivationPlan, describeActivation, activatePlan } from "./activation.mjs";
import { inspectIntegration, activationReceipt, saveActivationReceipt, generateIntegrationPreview, buildIntegrationPlan, describeIntegration, applyIntegration } from "./integration.mjs";
import { checkForUpdates, handoffRuntimeUpgrade } from "./releases.mjs";

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
export function createSession({ installRoot = root, cwd = process.cwd(), env = process.env, execute = runInstaller, signal, check = checkForUpdates, handoff = handoffRuntimeUpgrade, prepareIntegration = generateIntegrationPreview } = {}) {
  installRoot = realpathSync(installRoot); cwd = realpathSync(cwd);
  const packaged = env.ALFRED_DISTRIBUTION === "homebrew";
  const version = JSON.parse(readFileSync(join(installRoot, "package.json"))).version;
  let approval = null, activation = null, updateApproval = null, release = null;
  // Fresh generation directory avoids consuming previews from an earlier selection.
  const previewRoot = join(cwd, ".alfred/setup/previews", randomBytes(12).toString("hex"));
  const seen = new Set();
  let busy = false;
  const context = { installRoot, cwd, env, signal };
  signal?.addEventListener("abort", () => { approval = null; activation = null; updateApproval = null; }, { once: true });
  const notCancelled = () => { if (signal?.aborted) throw fault("cancelled", "Setup was cancelled."); };
  const fingerprint = () => digest(readFileSync(join(installRoot, "install.sh")) + readFileSync(join(installRoot, "package.json"), "utf8"));
  function argv(selection, apply = false) {
    return [`--edition=${selection.edition}`, `--harness=${selection.harnesses.join(",") || "none"}`, `--memory=${selection.memory}`, `--name=${selection.name}`, `--path=${selection.path}`, "--no-clone", `--preview-output=${previewRoot}`, ...(selection.profiles ? [] : ["--skip-profile-manager"]), ...(apply ? ["--apply"] : [])];
  }
  return async request => {
    let id = "";
    if (busy) { approval = null; activation = null; updateApproval = null; return { schema, id, ok: false, error: { code: "busy", message: "Another setup operation is in progress." } }; }
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
        const integration = inspectIntegration(cwd, version);
        const defaults = normalizeSelection({ edition: "coding", memory: "decide-later", name: "default", profiles: true, ...(integration.selection ?? {}), harnesses: integration.harnesses ?? [], path: installRoot }, { packaged, installRoot });
        const project = { status: integration.status, version: integration.version, text: safeText(integration.text), canUpdate: integration.canUpdate };
        return { schema, id, ok: true, data: { version, packaged, defaults, project, resume: env.ALFRED_SETUP_RESUME === "1", capabilities: { platform: process.platform, arch: process.arch, node: process.version, harnesses } } };
      }
      if (request.operation === "check-update") {
        keys(request, ["schema", "id", "operation"]);
        // Release metadata does not change an already reviewed project plan.
        // Resume can enqueue check-update and project-preview in either order.
        if (updateApproval?.kind === "runtime") updateApproval = null;
        release = await check({ currentVersion: version, packaged, env, signal });
        notCancelled();
        return { schema, id, ok: true, data: { ...release, text: safeText(release.text) } };
      }
      if (!["preview", "apply", "activate", "decline", "runtime-preview", "runtime-approve", "project-preview", "project-apply", "project-decline"].includes(request.operation)) throw fault("invalid_request", "Unknown setup operation.");
      const selection = normalizeSelection(request.selection, { packaged, installRoot });
      if (!existsSync(selection.path) || lstatSync(selection.path).isSymbolicLink() || realpathSync(selection.path) !== selection.path || !existsSync(join(selection.path, "install.sh"))) throw fault("invalid_selection", "Use an existing Alfred installation; setup does not download source.");
      const binding = JSON.stringify({ selection, cwd, installRoot, previewRoot, installer: fingerprint() });
      const trace = (event, status, humanApproval) => [{ event, status, project: cwd, harnesses: selection.harnesses, human_approval: humanApproval, provider_calls: 0 }];
      if (["runtime-preview", "project-preview"].includes(request.operation)) {
        approval = null; activation = null; updateApproval = null;
        keys(request, ["schema", "id", "operation", "selection"]);
        if (request.operation === "runtime-preview") {
          if (!release?.canUpgrade) return { schema, id, ok: true, data: { status: "runtime_blocked", text: safeText(release?.text || "Check for a stable Homebrew update first.") } };
          const token = randomBytes(32).toString("hex");
          updateApproval = { kind: "runtime", binding, token, latestVersion: release.latestVersion };
          return { schema, id, ok: true, data: { status: "runtime_review", previewToken: token, text: `Update Alfred ${version} → ${release.latestVersion} with Homebrew.\n\nCommands: brew update; brew upgrade GOI17/alfred/alfred\nProject: ${cwd}\n\nAfter verifying the new CLI, setup reopens from this project to review its integration update. Your saved harness choices are reused. Project files require a separate review; an upgrade failure stops before that step.` } };
        }
        try {
          const integration = inspectIntegration(cwd, version);
          if (!integration.canUpdate) throw fault("project_blocked", integration.text);
          if (JSON.stringify([...selection.harnesses].sort()) !== JSON.stringify([...integration.harnesses].sort())) throw fault("project_blocked", "Use the saved project harness selection for updates.");
          if (packaged && (cwd === installRoot || cwd.startsWith(installRoot + "/"))) throw fault("project_blocked", "Run setup in the project, not the shared installation.");
          const generated = await prepareIntegration({ installRoot, projectRoot: cwd, harnesses: integration.harnesses });
          notCancelled();
          const plan = buildIntegrationPlan({ projectRoot: cwd, previewRoot: generated, version, selection });
          if (plan.current) return { schema, id, ok: true, data: { status: "project_current", text: `Project integration ${version} is already current. Verified managed files; no writes were needed.` } };
          const token = randomBytes(32).toString("hex");
          updateApproval = { kind: "project", binding, token, plan };
          return { schema, id, ok: true, data: { status: "project_review", previewToken: token, text: safeText(describeIntegration(plan)), traceEvents: trace("setup_project_update_reviewed", "pending_approval", false) } };
        } catch (error) {
          notCancelled();
          return { schema, id, ok: true, data: { status: "project_blocked", text: safeText(`Project integration update is blocked. No live files were written.\n${error.code?.startsWith("E") ? "Cannot inspect update paths." : error.message}`), traceEvents: trace("setup_project_update_blocked", "blocked", false) } };
        }
      }
      if (["runtime-approve", "project-apply", "project-decline"].includes(request.operation)) {
        const current = updateApproval; updateApproval = null; approval = null; activation = null;
        const expected = request.operation === "runtime-approve" ? "runtime" : "project";
        if (!current || current.kind !== expected || request.previewToken !== current.token || current.binding !== binding) throw fault("consent_required", "Review this exact update and explicitly approve it first.");
        if (request.operation === "project-decline") return { schema, id, ok: true, data: { status: "project_declined", text: "Project update declined. No live harness files were changed.", traceEvents: trace("setup_project_update_declined", "declined", false) } };
        if (request.confirmed !== true) throw fault("consent_required", "Explicit approval is required for the reviewed update.");
        notCancelled();
        if (expected === "runtime") {
          handoff({ currentVersion: version, latestVersion: current.latestVersion, cwd, installRoot, env });
          return { schema, id, ok: true, data: { status: "runtime_upgrade_approved", text: "Homebrew update approved. Restoring the terminal before upgrading Alfred.", traceEvents: trace("setup_runtime_upgrade_approved", "approved", true) } };
        }
        const result = applyIntegration(current.plan, { signal });
        return { schema, id, ok: true, data: { status: result.status, text: safeText(result.text), traceEvents: trace("setup_project_update_finished", result.status, true) } };
      }
      if (["activate", "decline"].includes(request.operation)) {
        const current = activation; activation = null; approval = null;
        if (!current || request.previewToken !== current.token || binding !== current.binding) throw fault("consent_required", "Review this exact activation plan first.");
        if (request.operation === "decline") return { schema, id, ok: true, data: { text: "Activation declined. Previews were generated; no live harness files were written.", status: "activation_declined", traceEvents: trace("setup_activation_declined", "declined", false) } };
        if (request.confirmed !== true) throw fault("consent_required", "Explicitly approve installation of the reviewed harness files.");
        notCancelled();
        const receipt = activationReceipt(current.plan, { version, selection });
        const result = activatePlan(current.plan, { signal });
        if (result.status === "activation_verified") {
          try { saveActivationReceipt(current.plan, receipt); }
          catch { result.status = "activation_partial"; result.text += "\nInstallation receipt could not be saved. Integration version is not recorded; reopen setup to review recovery."; }
        }
        return { schema, id, ok: true, data: { text: result.text, status: result.status, traceEvents: trace("setup_activation_finished", result.status, true) } };
      }
      if (request.operation === "preview") {
        approval = null; activation = null; updateApproval = null;
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
      notCancelled();
      if (selection.harnesses.some(h => h === "opencode" || h.startsWith("codex-"))) {
        try {
          if (packaged && (cwd === installRoot || cwd.startsWith(installRoot + "/"))) throw fault("activation_conflict", "Run setup from the project, not the shared Homebrew installation.");
          const plan = buildActivationPlan({ projectRoot: cwd, previewRoot, harnesses: selection.harnesses });
          const token = randomBytes(32).toString("hex");
          activation = { plan, token, binding };
          const piNote = selection.harnesses.includes("pi") ? "\nPi is preview-only; no Pi activation is available in this setup." : "";
          return { schema, id, ok: true, data: { text: safeText(describeActivation(plan) + piNote), previewToken: token, status: "activation_review", traceEvents: trace("setup_activation_reviewed", "pending_approval", false) } };
        } catch (error) {
          return { schema, id, ok: true, data: { text: safeText(`Previews generated, but harness activation is blocked. No live harness files were written.\n${error.code?.startsWith("E") ? "Cannot inspect activation paths." : error.message}\nResolve the conflict and start a new setup review.`), status: "activation_blocked", traceEvents: trace("setup_activation_blocked", "blocked", false) } };
        }
      }
      return { schema, id, ok: true, data: { text: safeText(text + "\nPreparation complete. No harness files were activated. Pi, if selected, remains preview-only."), status: "previews_only", traceEvents: trace("setup_previews_prepared", "previews_only", false) } };
    } catch (error) {
      approval = null; activation = null; updateApproval = null;
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
