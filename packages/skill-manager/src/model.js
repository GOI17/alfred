import { createHash } from "node:crypto";

export function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

export function validName(name) {
  if (typeof name !== "string" || !/^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/.test(name)) {
    fail("E_INVALID_NAME", "Skill names must contain 1–64 lowercase letters, digits, hyphens or underscores, starting and ending with a letter or digit.");
  }
  return name;
}

export function safeRelative(value, { allowRoot = false } = {}) {
  if (allowRoot && (value === "" || value === ".")) return "";
  if (typeof value !== "string" || !value || /[\\\x00-\x1f\x7f:]/.test(value) ||
      value.split("/").some((part) => !part || part === "." || part === "..")) {
    fail("E_UNSAFE_PATH", "Expected a safe repository-relative path without traversal or absolute components.");
  }
  return value;
}

export const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export const identity = (row) => `${row.scope}:${row.harness}:${row.name}`;

// Each entry is framed independently, including executable bits. Neither path
// concatenation nor differing file boundaries can yield the same input stream.
export function digestFiles(files) {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const header = Buffer.from(JSON.stringify([file.path, file.mode & 0o111, file.bytes.length]));
    const size = Buffer.alloc(4);
    size.writeUInt32BE(header.length);
    hash.update(size).update(header).update(file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function scalar(value) {
  const text = value.trim();
  if (text.startsWith('"')) {
    try { return JSON.parse(text); } catch { fail("E_INVALID_SKILL", "Malformed quoted frontmatter value."); }
  }
  if (text.startsWith("'")) {
    if (!text.endsWith("'")) fail("E_INVALID_SKILL", "Malformed quoted frontmatter value.");
    return text.slice(1, -1).replaceAll("''", "'");
  }
  return text.replace(/\s+#.*$/, "").trim();
}

// Only metadata needed by the lifecycle is read. Skill bodies are never
// interpreted or executed. Unknown YAML keys remain opaque.
export function skillMetadata(files) {
  const skill = files.find((file) => file.path === "SKILL.md");
  if (!skill) fail("E_INVALID_SKILL", "Selected directory must contain SKILL.md.");
  const match = skill.bytes.toString("utf8").replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail("E_INVALID_SKILL", "SKILL.md must start with YAML frontmatter containing name and description.");
  const metadata = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].match(/^(name|description|version):\s*(.*)$/);
    if (!line) continue;
    const [, key, raw] = line;
    if (metadata[key] !== undefined) fail("E_INVALID_SKILL", `Duplicate ${key} frontmatter key.`);
    if (/^[|>][-+]?\s*$/.test(raw)) {
      const block = [];
      while (index + 1 < lines.length && /^(\s|$)/.test(lines[index + 1])) block.push(lines[++index].trim());
      metadata[key] = block.join(" ").trim();
    } else metadata[key] = scalar(raw);
  }
  validName(metadata.name);
  if (typeof metadata.description !== "string" || !metadata.description.trim()) fail("E_INVALID_SKILL", "SKILL.md must declare a nonempty description.");
  if (metadata.version !== undefined && (typeof metadata.version !== "string" || !metadata.version || metadata.version.length > 128)) fail("E_INVALID_SKILL", "Declared skill version must be a nonempty scalar of at most 128 characters.");
  return { name: metadata.name, description: metadata.description, declaredVersion: metadata.version ?? null };
}

const digestPattern = /^sha256:[a-f0-9]{64}$/;
const dateValid = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

export function validateLock(value, { scope, scopes = [scope], targetFor, storedTargetFor }) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.installations)) fail("E_INVALID_LOCK", "Unsupported or malformed skills-lock.json; preserve it and repair its schema before retrying.");
  const ids = new Set();
  const paths = new Set();
  for (const row of value.installations) {
    try {
      validName(row?.name);
      if (!scopes.includes(row.scope) || !["codex", "opencode"].includes(row.harness)) throw new Error("Invalid installation scope/harness");
      const target = targetFor(row.harness, row.scope, row.name);
      if (row.targetPath !== storedTargetFor(target, row.scope)) throw new Error("Stored destination differs from the supported destination");
      if (ids.has(identity(row)) || paths.has(target)) throw new Error("Duplicate installation identity or destination");
      ids.add(identity(row)); paths.add(target);
      if (!digestPattern.test(row.sourceDigest) || !digestPattern.test(row.installedDigest)) throw new Error("Invalid content digest");
      if (row.declaredVersion !== null && (typeof row.declaredVersion !== "string" || !row.declaredVersion || row.declaredVersion.length > 128)) throw new Error("Invalid declared version");
      if ((row.installedAt !== null && !dateValid(row.installedAt)) || !dateValid(row.updatedAt) ||
          (row.installedAt === null && !dateValid(row.managedSince))) throw new Error("Invalid timestamps");
      const source = row.source;
      if (source?.kind === "local") {
        if (typeof source.path !== "string" || !source.path.startsWith("/") || /[\x00-\x1f\x7f]/.test(source.path)) throw new Error("Invalid local source");
      } else if (source?.kind === "github") {
        if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repository)) throw new Error("Invalid GitHub repository");
        safeRelative(source.skillPath, { allowRoot: true });
        if (typeof source.requestedRef !== "string" || !source.requestedRef || /[\x00-\x20\x7f]/.test(source.requestedRef) || !/^[a-f0-9]{40}$/.test(source.resolvedCommit)) throw new Error("Invalid GitHub revision");
      } else throw new Error("Unknown source type");
    } catch (error) {
      fail("E_INVALID_LOCK", `Invalid skills-lock.json entry: ${error.message}`);
    }
  }
  return value;
}

export function planAction(operation, current, candidate) {
  const blocked = (code, message) => ({ status: "blocked", action: "none", blockers: [{ code, message }] });
  if (operation === "install") {
    if (!current) return { status: "preview", action: "install", blockers: [] };
    if (current.management === "unmanaged" && current.integrity !== "invalid" && current.observedDigest === candidate.installedDigest) {
      return { status: "preview", action: "adopt", blockers: [] };
    }
    return blocked("E_TARGET_EXISTS", "Destination already exists or has a receipt. Use update for a managed installation; unmanaged content must exactly match the explicit source to adopt it.");
  }
  if (!current || current.management !== "managed") return blocked("E_UNMANAGED", "This installation has no Alfred receipt. Use install with an exact matching source to adopt it first.");
  if (current.integrity !== "intact") return blocked("E_NOT_INTACT", `Managed installation is ${current.integrity}; restore its recorded content before ${operation}.`);
  if (operation === "remove") return { status: "preview", action: "remove", blockers: [] };
  if (candidate.name !== current.name) return blocked("E_SOURCE_NAME_CHANGED", "The source now declares a different skill name; install it separately.");
  if (candidate.installedDigest === current.installedDigest && JSON.stringify(candidate.source) === JSON.stringify(current.source)) {
    return { status: "unchanged", action: "none", blockers: [] };
  }
  return { status: "preview", action: "update", blockers: [] };
}
