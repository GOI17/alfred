import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { resolve, relative, dirname, join, isAbsolute, sep } from "node:path";
import { mergePrimaryInstructions, PRIMARY_BEGIN, PRIMARY_END } from "../../packages/codex-adapter/src/primary-instructions.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = (message, code = "activation_conflict") => { throw Object.assign(new Error(message), { code }); };
const safeRelative = value => typeof value === "string" && value.length < 512 && !isAbsolute(value) && !value.split("/").some(p => !p || p === "." || p === "..") && !/[\\\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value);
function stat(path) { try { return lstatSync(path); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }
// Check every ancestor, including absent leaves. Never follow a symlink into a
// different project/configuration. Canonical roots may include OS aliases (/tmp).
function checked(root, name) {
  if (!safeRelative(name)) fail("Unsafe activation path.");
  let current = root;
  const pieces = name.split("/");
  for (let i = 0; i < pieces.length; i++) {
    current = join(current, pieces[i]);
    const s = stat(current);
    if (s && (s.isSymbolicLink() || (i < pieces.length - 1 && !s.isDirectory()))) fail(`Unsafe path or symlink: ${name}`);
  }
  return current;
}
function identity(root) {
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f\u061c]/u.test(root)) fail("Unsafe project or preview root.");
  if (realpathSync(root) !== root || !stat(root)?.isDirectory()) fail("Project identity changed.", "activation_stale");
  const s = stat(root);
  return { root, dev: s.dev, ino: s.ino };
}
function file(root, name) {
  const path = checked(root, name), s = stat(path);
  if (!s) return { digest: null, mode: null, content: null };
  if (!s.isFile() || s.size > 2 * 1024 * 1024) fail(`Expected a small regular file: ${name}`);
  const content = readFileSync(path, "utf8");
  return { digest: hash(content), mode: s.mode & 0o777, content };
}
function snapshot(f) { return { digest: f.digest, mode: f.mode }; }
function atomic(path, content, mode = 0o644) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, content, { flag: "wx", mode }); renameSync(temporary, path); }
  finally { try { unlinkSync(temporary); } catch (e) { if (e.code !== "ENOENT") throw e; } }
}

// Called only by adapter generation; explicit enumeration prevents stale files in
// a reused preview directory from becoming install candidates.
export function writePreviewManifest({ root, preview }) {
  const output = resolve(root, preview.output_dir);
  const files = preview.files.map(f => {
    const source = relative(output, resolve(root, f.path)).split(sep).join("/");
    if (!safeRelative(source) || !safeRelative(f.install_path)) fail("Invalid generated manifest path.");
    return { source, target: f.install_path, sha256: hash(f.content) };
  });
  atomic(join(output, "activation-manifest.json"), JSON.stringify({ schema: "alfred.activation-preview/v1", harness: preview.harness, files }, null, 2) + "\n");
}
const agents = ["developer", "qa", "librarian", "architect", "reviewer"];
function allowed(h, p) {
  if (h === "codex") return p === "AGENTS.md" || agents.some(a => p === `.codex/agents/${a}.toml`) || /^\.agents\/skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/.test(p);
  return p === "opencode.json" || [...agents, "orchestrator"].some(a => p === `.opencode/agents/${a}.md`) || /^\.opencode\/skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/.test(p) || p === ".opencode/commands/alfred.md";
}
function required(h) {
  return h === "codex"
    ? ["AGENTS.md", ".agents/skills/alfred/SKILL.md", ...agents.map(a => `.codex/agents/${a}.toml`)]
    : ["opencode.json", ".opencode/skills/alfred/SKILL.md", ".opencode/commands/alfred.md", ...[...agents, "orchestrator"].map(a => `.opencode/agents/${a}.md`)];
}
function parseJSON(text) {
  try { const value = JSON.parse(text); if (value && typeof value === "object" && !Array.isArray(value)) return value; } catch {}
  fail("Existing OpenCode configuration is not a JSON object. Preserve it and resolve JSON/JSONC ambiguity before retrying.");
}
function mergeDefaults(existing, defaults) {
  const output = { ...existing };
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(output, key)) Object.defineProperty(output, key, { value, enumerable: true, writable: true, configurable: true });
    else if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])) output[key] = mergeDefaults(output[key], value);
  }
  return output;
}
export function buildActivationPlan({ projectRoot, previewRoot, harnesses }) {
  const project = identity(projectRoot), preview = identity(previewRoot);
  const selected = [...new Set(harnesses.map(h => h.startsWith("codex-") ? "codex" : h).filter(h => ["codex", "opencode"].includes(h)))].sort();
  const entries = [], dependencies = [];
  for (const harness of selected) {
    const prefix = `${harness}-install/`;
    const mf = file(previewRoot, prefix + "activation-manifest.json");
    let manifest;
    try { manifest = JSON.parse(mf.content); } catch { fail(`Missing fresh ${harness} manifest; prepare previews again.`); }
    if (manifest.schema !== "alfred.activation-preview/v1" || manifest.harness !== harness || !Array.isArray(manifest.files) || manifest.files.length > 512) fail("Invalid activation manifest.");
    dependencies.push({ root: "preview", path: prefix + "activation-manifest.json", ...snapshot(mf) });
    const seen = new Set();
    for (const item of manifest.files) {
      if (!safeRelative(item.source) || !safeRelative(item.target) || !allowed(harness, item.target) || seen.has(item.target)) fail("Invalid or duplicate manifest destination.");
      seen.add(item.target);
      const source = prefix + item.source, from = file(previewRoot, source);
      if (from.digest !== item.sha256 || from.content === null) fail(`Preview changed: ${source}`, "activation_stale");
      let target = item.target, content = from.content, action = "create";
      if (harness === "codex" && target === "AGENTS.md") {
        const override = file(projectRoot, "AGENTS.override.md");
        dependencies.push({ root: "project", path: "AGENTS.override.md", ...snapshot(override) });
        if (override.content?.trim()) target = "AGENTS.override.md";
        if (!content.startsWith(PRIMARY_BEGIN + "\n") || !content.trimEnd().endsWith(PRIMARY_END) || content.indexOf(PRIMARY_BEGIN) !== content.lastIndexOf(PRIMARY_BEGIN) || content.indexOf(PRIMARY_END) !== content.lastIndexOf(PRIMARY_END)) fail("Invalid primary instruction preview.");
        try { content = mergePrimaryInstructions(file(projectRoot, target).content ?? "", content); } catch { fail("Malformed Alfred markers; preserve and repair project instructions first."); }
        action = "merge managed Alfred instruction block; preserve other text";
      }
      if (harness === "opencode" && target === "opencode.json") {
        const jsonc = file(projectRoot, "opencode.jsonc");
        dependencies.push({ root: "project", path: "opencode.jsonc", ...snapshot(jsonc) });
        if (jsonc.content !== null) fail("opencode.jsonc exists. Resolve the configuration explicitly before activating; no live files were written.");
        const old = file(projectRoot, target);
        if (old.content !== null) {
          const current = parseJSON(old.content), defaults = parseJSON(content);
          const merged = mergeDefaults(current, defaults);
          if (current.instructions !== undefined && (!Array.isArray(current.instructions) || current.instructions.some(v => typeof v !== "string"))) fail("OpenCode instructions must be an array of strings.");
          merged.instructions = [...new Set([...(current.instructions ?? []), ...(defaults.instructions ?? [])])];
          content = JSON.stringify(merged, null, 2) + "\n";
        }
        action = "add missing defaults/instructions; preserve existing settings";
      }
      const before = file(projectRoot, target);
      if (before.content !== null && before.content !== content && !["AGENTS.md", "AGENTS.override.md", "opencode.json"].includes(target)) fail(`Existing file differs: ${target}. Preserve it and resolve the collision before retrying.`);
      if (before.content === content) action = "unchanged";
      entries.push({ harness, source, target, sourceHash: from.digest, content, sha256: hash(content), before: snapshot(before), action });
    }
    for (const target of required(harness)) if (!seen.has(target)) fail(`Missing required ${harness} artifact: ${target}`);
  }
  entries.sort((a,b) => a.target.localeCompare(b.target));
  const plan = { project, preview, harnesses: selected, entries, dependencies };
  return { ...plan, digest: hash(JSON.stringify(plan)) };
}
export function describeActivation(plan) {
  return ["Previews generated. Harness files are NOT installed yet.", `Activation target: ${plan.project.root}`, `Reviewed preview files: ${plan.preview.root}`, "", "Only the following files will be installed after a separate explicit approval:", ...plan.entries.flatMap(e => [`${e.target} — ${e.action}`, `  SHA-256 ${e.sha256}`]), "", "Existing unrelated settings are preserved. Conflicting files require manual resolution.", "Verification checks files on disk. Start a new harness session afterward."].join("\n");
}
export function activatePlan(plan, { signal, write = atomic } = {}) {
  const written = [];
  try {
    if (signal?.aborted) fail("Activation cancelled.", "cancelled");
    const fresh = buildActivationPlan({ projectRoot: plan.project.root, previewRoot: plan.preview.root, harnesses: plan.harnesses.map(h => h === "codex" ? "codex-cli" : h) });
    if (fresh.digest !== plan.digest) fail("Activation plan changed. Review a fresh plan.", "activation_stale");
    for (const entry of plan.entries) {
      if (signal?.aborted) fail("Activation cancelled.", "cancelled");
      if (entry.action === "unchanged") continue;
      identity(plan.project.root);
      const target = checked(plan.project.root, entry.target);
      if (JSON.stringify(snapshot(file(plan.project.root, entry.target))) !== JSON.stringify(entry.before)) fail(`Target changed: ${entry.target}`, "activation_stale");
      mkdirSync(dirname(target), { recursive: true });
      checked(plan.project.root, entry.target);
      write(target, entry.content, entry.before.mode ?? 0o644);
      written.push(entry.target);
    }
    for (const entry of plan.entries) if (file(plan.project.root, entry.target).digest !== entry.sha256) fail(`Verification failed: ${entry.target}`, "activation_verification_failed");
    return { status: "activation_verified", written, harnesses: plan.harnesses, text: `Harness files verified in ${plan.project.root}: ${plan.harnesses.join(", ")}.\n${plan.entries.length} files checked; ${written.length} written.\nAlfred skill and expected agents/commands are present. Start a NEW harness session to load them.\nThis verifies disk installation, not what an already running session has loaded.` };
  } catch (error) {
    // Do not roll back over concurrent user changes or disguise partial success.
    return { status: written.length ? "activation_partial" : "activation_failed", written, harnesses: [], text: `Harness activation was NOT verified. ${error.code?.startsWith("E") ? "Filesystem write failed." : error.message}\nFiles written before failure: ${written.length ? written.join(", ") : "none"}.\nPreviews remain available. Review a new plan before retrying.` };
  }
}

// Shared deterministic guards for the setup update lifecycle.
export { hash, fail, safeRelative, stat, checked, identity, file, snapshot, atomic, allowed, required, parseJSON };
