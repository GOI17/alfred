import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repository = resolve(import.meta.dirname, "../../..");
function put(file, content) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); }

// Run the real adapters against a synthetic core module and kernel. Never
// import or read packages/core or the user's protected harness configuration.
export function adapterFixture(t, harness, { includeAlfred = true } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "alfred-chat-adapter-qa-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(join(root, "package.json"), '{"type":"module"}');
  for (const name of ["runtime.js", harness === "codex" ? "primary-instructions.js" : "chat-command.js"]) {
    put(join(root, "packages", `${harness}-adapter`, "src", name), readFileSync(join(repository, "packages", `${harness}-adapter`, "src", name)));
  }
  const stub = `
    import fs from 'node:fs';
    import path from 'node:path';
    export const loadArchitectureKernel = root => JSON.parse(fs.readFileSync(path.join(root, 'qa-kernel.json'), 'utf8'));
    export const loadAgent = (kernel,id) => kernel.agents.agents.find(agent => agent.id === id);
    export const resolveProjectIdentity = root => ({ project_root: root });
    const unused = () => { throw new Error('Unexpected core capability outside preview fixture'); };
    export const compactContext = unused, createTraceEvent = unused, detectContextUsage = unused,
      evaluateHarnessPortability = unused, loadHarnessCompatibility = unused, resolveThreshold = unused;
  `;
  put(join(root, "packages/core/src/index.js"), stub);
  const registry = JSON.parse(readFileSync(join(repository, ".ai/skills/registry.json"), "utf8"));
  const alfred = registry.skills.find(skill => skill.id === "alfred");
  if (!alfred) throw new Error("Canonical Alfred registry entry missing");
  const canonical = readFileSync(join(repository, alfred.bodyPath), "utf8");
  put(join(root, alfred.bodyPath), canonical);
  put(join(root, ".ai/manifest.json"), '{"name":"adapter-fixture"}');
  put(join(root, ".ai/agents/orchestrator.md"), "---\nid: orchestrator\n---\n# Orchestrator\nPreserve user authority.\n");
  const kernel = {
    agents: { agents: [{ id: "orchestrator", description: "Fixture primary", spec: ".ai/agents/orchestrator.md" }] },
    skills: { skills: includeAlfred ? [alfred] : [] },
    permissions: { default: "deny", agents: {} }
  };
  put(join(root, "qa-kernel.json"), JSON.stringify(kernel));
  return { root, canonical, kernel,
    async load() { return import(pathToFileURL(join(root, "packages", `${harness}-adapter`, "src/runtime.js"))); },
    noLiveTarget() { return !existsSync(join(root, harness === "codex" ? ".agents" : ".opencode")); }
  };
}
