import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { writePreviewManifest } from "./activation.mjs";
import { PRIMARY_BEGIN, PRIMARY_END } from "../../packages/codex-adapter/src/primary-instructions.js";
export function put(path, value) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
const agents = ["developer", "qa", "librarian", "architect", "reviewer"];
export function generate(previewRoot, harness) {
  const output = join(previewRoot, `${harness}-install`);
  const definitions = harness === "codex" ? {
    "AGENTS.md": `${PRIMARY_BEGIN}\n# Alfred Orchestrator\nKeep human authority.\n${PRIMARY_END}\n`,
    ".agents/skills/alfred/SKILL.md": "---\nname: alfred\n---\nAlfred skill\n",
    ...Object.fromEntries(agents.map(a => [`.codex/agents/${a}.toml`, `name = "${a}"\ninstructions = "Alfred ${a}"\n`]))
  } : {
    "opencode.json": JSON.stringify({ $schema: "https://opencode.ai/config.json", default_agent: "orchestrator", instructions: ["AGENTS.md"], permission: { edit: "ask", bash: { "*": "ask" } } }, null, 2) + "\n",
    ".opencode/skills/alfred/SKILL.md": "---\nname: alfred\n---\nAlfred skill\n",
    ".opencode/commands/alfred.md": "Run Alfred skills CLI.\n",
    ...Object.fromEntries([...agents, "orchestrator"].map(a => [`.opencode/agents/${a}.md`, `# Alfred ${a}\n`]))
  };
  const files = Object.entries(definitions).map(([target, content]) => {
    const path = join(output, target === "opencode.json" ? "opencode.json.preview" : target);
    put(path, content);
    return { path, install_path: target, content };
  });
  writePreviewManifest({ root: previewRoot, preview: { harness, output_dir: output, files } });
  return output;
}
export function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "alfred-activation-test-")));
  const projectRoot = join(root, "project"), previewRoot = join(projectRoot, ".alfred/setup/previews/fresh"), installRoot = join(root, "runtime");
  mkdirSync(previewRoot, { recursive: true }); mkdirSync(installRoot);
  put(join(installRoot, "install.sh"), "# fixture installer\n");
  put(join(installRoot, "package.json"), '{"version":"1.0.0"}');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, projectRoot, previewRoot, installRoot, harnesses: ["codex-cli", "opencode"] };
}
