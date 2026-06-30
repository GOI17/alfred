import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { loadArchitectureKernel } from "../src/index.js";

function writeJson(root, relativePath, value) {
  const filePath = join(root, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function withKernelFixture(manifest, fn) {
  const root = mkdtempSync(join(tmpdir(), "alfred-core-kernel-"));
  try {
    writeJson(root, ".ai/manifest.json", manifest);
    writeJson(root, ".ai/agents/registry.json", { agents: [] });
    writeJson(root, ".ai/agents/routing-policy.json", {});
    writeJson(root, ".ai/skills/registry.json", { skills: [] });
    writeJson(root, ".ai/policies/permissions.example.json", { default: "deny", agents: {} });
    writeJson(root, ".ai/policies/provider-request-policy.example.json", { default_strategy: "local-first" });
    writeJson(root, ".ai/policies/model-assignment.example.json", { ownership: { assignment_owner: "user" } });
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("loadArchitectureKernel accepts later complete manifests", () => {
  withKernelFixture(
    { name: "alfred", phase: "phase-12-docs-foundation", status: "complete", source_of_truth: { agent_system: ".ai" } },
    (root) => {
      const kernel = loadArchitectureKernel(root);
      assert.equal(kernel.manifest.phase, "phase-12-docs-foundation");
      assert.equal(kernel.permissions.default, "deny");
    }
  );
});

test("loadArchitectureKernel rejects incomplete manifests", () => {
  withKernelFixture(
    { name: "alfred", phase: "phase-12-docs-foundation", status: "draft", source_of_truth: { agent_system: ".ai" } },
    (root) => {
      assert.throws(() => loadArchitectureKernel(root), /complete architecture manifest/);
    }
  );
});
