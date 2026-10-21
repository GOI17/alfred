import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readTree } from "./filesystem.js";
import { fail, skillMetadata } from "./model.js";

export function validateSkillDirectory(directory, { cwd = process.cwd(), now = () => new Date() } = {}) {
  if (typeof directory !== "string" || !directory) fail("E_ARGUMENT", "Provide a local skill directory to validate.");
  const sourcePath = path.resolve(cwd, directory);
  const trace = (status, reason = null) => ({ trace_id: `skill-validation-${randomUUID()}`, timestamp: new Date(now()).toISOString(),
    event: "skill_manager_operation", actor: "alfred-skills", data: { operation: "validate", source: { kind: "local", path: sourcePath },
      status, reason, approval: false, provider_calls: 0, network_access: false, provider_request_decision: "local-only" } });
  try {
    const snapshot = readTree(sourcePath, { excludeControlDirectories: true });
    const metadata = skillMetadata(snapshot.files);
    const body = snapshot.files.find((file) => file.path === "SKILL.md").bytes.toString("utf8")
      .replace(/^\uFEFF/, "").replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").trim();
    if (!body) fail("E_INVALID_SKILL", "SKILL.md needs a nonempty instruction body; frontmatter alone is not a skill.");
    return { status: "valid", ...metadata, source: { kind: "local", path: fs.realpathSync(sourcePath) }, digest: snapshot.digest,
      files: snapshot.files.map((file) => file.path).sort(), provider_calls: 0, trace: trace("valid") };
  } catch (error) { error.trace = trace("failed", error.code ?? "E_IO"); throw error; }
}
