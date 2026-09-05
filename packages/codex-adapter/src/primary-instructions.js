import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export const PRIMARY_BEGIN = "<!-- alfred:codex-primary:begin -->";
export const PRIMARY_END = "<!-- alfred:codex-primary:end -->";

export function mergePrimaryInstructions(existing, block) {
  const start = existing.indexOf(PRIMARY_BEGIN);
  const end = existing.indexOf(PRIMARY_END);
  if (start === -1 && end === -1) {
    return existing + (existing.endsWith("\n\n") || !existing ? "" : existing.endsWith("\n") ? "\n" : "\n\n") + block;
  }
  if (start === -1 || end < start ||
      start !== existing.lastIndexOf(PRIMARY_BEGIN) || end !== existing.lastIndexOf(PRIMARY_END)) {
    throw new Error("Malformed Alfred Codex instruction markers; preserve and repair the existing file first");
  }
  return existing.slice(0, start) + block.trimEnd() + existing.slice(end + PRIMARY_END.length);
}

function readInstructionFile(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile()) throw new Error(`Instruction target must be a regular file, not a symlink: ${filePath}`);
  return { content: fs.readFileSync(filePath, "utf8"), mode: stat.mode };
}

export function applyCodexPrimaryInstructions({ previewRoot, projectRoot, approval = false }) {
  if (!approval) throw new Error("Human approval required before writing Codex project instructions");
  const block = fs.readFileSync(path.join(previewRoot, "AGENTS.md"), "utf8");
  if (!block.startsWith(PRIMARY_BEGIN + "\n") || !block.trimEnd().endsWith(PRIMARY_END) ||
      block.indexOf(PRIMARY_BEGIN) !== block.lastIndexOf(PRIMARY_BEGIN) ||
      block.indexOf(PRIMARY_END) !== block.lastIndexOf(PRIMARY_END)) {
    throw new Error("Invalid Alfred Codex primary instruction preview");
  }
  const overridePath = path.join(projectRoot, "AGENTS.override.md");
  const override = readInstructionFile(overridePath);
  const targetPath = override?.content.trim() ? overridePath : path.join(projectRoot, "AGENTS.md");
  const existing = targetPath === overridePath ? override : readInstructionFile(targetPath);
  const content = mergePrimaryInstructions(existing?.content ?? "", block);
  const changed = content !== existing?.content;
  if (changed) {
    const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, content, { flag: "wx", mode: existing?.mode ?? 0o644 });
      fs.renameSync(temporaryPath, targetPath);
    } finally {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
  }
  return {
    event: "codex_primary_instructions_applied",
    target_path: targetPath,
    changed,
    human_approval: true,
    provider_calls: 0
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  const [previewRoot, projectRoot, approvalFlag] = process.argv.slice(2);
  const result = applyCodexPrimaryInstructions({ previewRoot, projectRoot, approval: approvalFlag === "--approved" });
  console.log(JSON.stringify(result));
}
