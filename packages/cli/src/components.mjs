import { createHash, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const componentIds = ["workspace", "memory", "harness"];
export const componentLabels = { workspace: "Workspace", memory: "Memory", harness: "Agent Harness" };
export const preferencesPath = ".alfred/setup/components.json";
const hash = value => createHash("sha256").update(value).digest("hex");
export function normalizeComponents(components, edition = "coding") {
  if (components === undefined) {
    const legacy = { coding: ["harness"], memory: ["memory"], full: ["memory", "harness"], workspace: ["workspace"], custom: [] };
    components = legacy[edition];
  }
  if (!Array.isArray(components) || !components.length || components.length > 3 || new Set(components).size !== components.length || components.some(id => !componentIds.includes(id))) throw new Error("Choose at least one supported Alfred capability.");
  return componentIds.filter(id => components.includes(id));
}
export function legacyEdition(components) {
  const selected = normalizeComponents(components);
  if (selected.includes("harness")) return selected.includes("memory") ? "full" : "coding";
  return selected.includes("memory") ? "memory" : "workspace";
}
export function componentPlan(components, profiles = true) {
  const selected = normalizeComponents(components), result = [];
  if (selected.includes("workspace")) result.push("workspace");
  if (selected.includes("harness")) result.push("core", "agents", "skills", ...(profiles ? ["profile-manager"] : []), "opencode-adapter", "codex-adapter", "evals");
  if (selected.includes("memory")) result.push("memory", "memory-server", "memory-client", "memory-mcp", "memory-openapi", "chatgpt-adapter", "anthropic-adapter", "gemini-adapter", "console", "console-web");
  return result;
}
function safePath(project) {
  project = realpathSync(project);
  let cursor = project;
  for (const [index, part] of preferencesPath.split("/").entries()) {
    cursor = join(cursor, part);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (stat && (stat.isSymbolicLink() || (index < 2 ? !stat.isDirectory() : !stat.isFile()))) throw new Error("Unsafe product preferences path.");
  }
  return { project, path: cursor };
}
export function readComponentPreferences(project) {
  const identity = safePath(project);
  const stat = lstatSync(identity.path, { throwIfNoEntry: false });
  if (!stat) return { ...identity, digest: null, value: null };
  if (stat.size > 8192) throw new Error("Invalid product preferences size.");
  const content = readFileSync(identity.path, "utf8");
  let value;
  try { value = JSON.parse(content); } catch { throw new Error("Invalid product preferences JSON."); }
  if (!value || value.schema !== "alfred.setup.components/v1" || value.project !== identity.project || typeof value.version !== "string" || !/^[0-9A-Za-z.+-]{1,80}$/.test(value.version) || Object.keys(value).some(key => !["schema", "project", "version", "components"].includes(key))) throw new Error("Invalid product preferences.");
  value.components = normalizeComponents(value.components);
  return { ...identity, digest: hash(content), value };
}
export function saveComponentPreferences(project, components, version, expectedDigest) {
  const before = readComponentPreferences(project);
  if (before.digest !== expectedDigest) throw new Error("Product choices changed since review. Review setup again.");
  const value = { schema: "alfred.setup.components/v1", project: before.project, version, components: normalizeComponents(components) };
  mkdirSync(dirname(before.path), { recursive: true });
  safePath(project);
  const temporary = `${before.path}.${randomBytes(12).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    if (readComponentPreferences(project).digest !== expectedDigest) throw new Error("Product choices changed during preparation.");
    renameSync(temporary, before.path);
  } finally { rmSync(temporary, { force: true }); }
  return value;
}
