import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { adapterFixture } from "../../skill-manager/test/adapter-fixture.js";
import { validateSkillDirectory } from "../../skill-manager/src/index.js";

test("OpenCode writes a native command plus canonical skill into a preview without changing live configuration", async (t) => {
  const f = adapterFixture(t, "opencode");
  const adapter = await f.load();
  const preview = adapter.writeOpencodeInstallPreview({ root: f.root, projectRoot: f.root, outputDir: ".ai/generated/chat-preview" });
  const command = preview.files.find(file => file.install_path === ".opencode/commands/alfred.md");
  const skill = preview.files.find(file => file.install_path === ".opencode/skills/alfred/SKILL.md");
  assert.ok(command && skill);
  assert.equal(command.kind, "command");
  assert.equal(readFileSync(join(f.root, command.path), "utf8"), command.content);
  assert.ok(command.content.includes("$ARGUMENTS"), "Arguments stay literal task input for OpenCode");
  assert.match(command.content, /load.*skill.*alfred/i);
  assert.doesNotMatch(command.content, /!`|^model:|^agent:|^permission:|\$\(/m);
  assert.ok(command.content.length < 1500, "The wrapper routes to the skill rather than duplicating its lifecycle");
  const body = readFileSync(join(f.root, skill.path), "utf8");
  assert.ok(body.endsWith(`${f.canonical.replace(/^---\n[\s\S]*?\n---\n?/, "").trim()}\n`));
  const source = join(f.root, ".ai/generated/chat-preview/.opencode/skills/alfred");
  assert.equal(validateSkillDirectory(source, { cwd: f.root }).name, "alfred");
  assert.equal(preview.provider_calls, 0);
  assert.equal(preview.writes_harness_config_by_default, false);
  assert.ok(f.noLiveTarget());
  assert.equal(existsSync(join(f.root, ".alfred/skills-lock.json")), false);
});

test("OpenCode does not advertise an Alfred command when the skill is absent", async (t) => {
  const f = adapterFixture(t, "opencode", { includeAlfred: false });
  const adapter = await f.load();
  const preview = adapter.buildOpencodeInstallPreview({ root: f.root, projectRoot: f.root });
  assert.equal(preview.files.some(file => file.install_path === ".opencode/commands/alfred.md"), false);
  assert.ok(f.noLiveTarget());
});
