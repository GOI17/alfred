import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import { buildRuntime } from "../../../scripts/build-runtime.mjs";
import { inspectRuntime } from "../../../scripts/runtime-archive.mjs";
import { fixture, put } from "./helpers.js";

const repository = resolve(import.meta.dirname, "../../..");

test("runtime archive includes chat skill and command/search implementations through existing production allowlist patterns", (t) => {
  const f = fixture(t);
  const root = join(f.root, "runtime-source"), dependencies = join(f.root, "runtime-deps/node_modules"), output = join(f.root, "runtime-output");
  const policy = JSON.parse(readFileSync(join(repository, "packaging/runtime/allowlist.json"), "utf8"));
  const packages = ["skill-manager", "codex-adapter", "opencode-adapter"];
  const includes = policy.includes.filter(pattern => pattern === ".ai/skills/registry.json" || pattern === ".ai/skills/project/*/SKILL.md" || packages.some(name => pattern.startsWith(`packages/${name}/src/`)));
  put(join(root, "package.json"), '{"version":"1.2.3"}');
  for (const name of packages) {
    const directory = join(repository, "packages", name, "src");
    for (const file of readdirSync(directory).filter(file => file.endsWith(".js"))) put(join(root, "packages", name, "src", file), readFileSync(join(directory, file)));
    put(join(root, "packages", name, "package.json"), readFileSync(join(repository, "packages", name, "package.json")));
  }
  for (const file of [".ai/skills/registry.json", ".ai/skills/project/alfred/SKILL.md"]) put(join(root, file), readFileSync(join(repository, file)));
  mkdirSync(dependencies, { recursive: true });
  const lock = JSON.stringify({ lockfileVersion: 3, packages: {} });
  put(join(f.root, "runtime-deps/package-lock.json"), lock);
  put(join(f.root, "package-lock.json"), lock);
  const allowlist = join(f.root, "allowlist.json");
  put(allowlist, JSON.stringify({ schema: policy.schema, includes, packageMetadata: policy.packageMetadata.filter(name => packages.includes(name)), dependencies: {}, workspaceModules: {} }));
  const built = buildRuntime({ root, dependencies, output, allowlist, sourceRevision: "a".repeat(40), builderRevision: "b".repeat(40) });
  const archived = inspectRuntime(readFileSync(built.archive), readFileSync(join(output, "runtime-manifest.json")));
  for (const file of [".ai/skills/project/alfred/SKILL.md", ".ai/skills/registry.json", "packages/opencode-adapter/src/chat-command.js", "packages/skill-manager/src/catalog.js", "packages/skill-manager/src/validation.js"]) {
    assert.ok(archived.files.has(file), `Required chat runtime artifact missing: ${file}`);
    assert.deepEqual(archived.files.get(file).bytes, readFileSync(join(repository, file)));
  }
  assert.equal([...archived.files.keys()].some(file => file.includes("/test/") || file.endsWith("agents/openai.yaml")), false);
});
