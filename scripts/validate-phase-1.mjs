import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredPaths = [
  "AGENTS.md",
  "README.md",
  "docs/architecture/000-project-charter.md",
  "docs/architecture/001-ddd-glossary.md",
  "docs/architecture/002-hexagonal-architecture.md",
  "docs/architecture/003-monorepo-boundaries.md",
  "docs/architecture/004-phase-plan.md",
  "docs/architecture/005-local-first-token-economy.md",
  "docs/architecture/006-security-model.md",
  "docs/architecture/007-observability-traceability.md",
  "docs/architecture/008-evals-reproducibility.md",
  "docs/architecture/009-harness-portability.md",
  ".ai/manifest.json",
  ".ai/domain/glossary.md",
  ".ai/domain/model.md",
  ".ai/agents/registry.json",
  ".ai/agents/agent.schema.json",
  ".ai/skills/registry.json",
  ".ai/skills/registry.schema.json",
  ".ai/policies/permissions.schema.json",
  ".ai/policies/permissions.example.json",
  ".ai/policies/provider-request-policy.schema.json",
  ".ai/policies/provider-request-policy.example.json",
  ".ai/policies/provider-request-policy.md",
  ".ai/policies/security.md",
  ".ai/policies/delegation.md",
  ".ai/observability/schemas/trace-event.schema.json",
  ".ai/observability/examples/provider-request-avoided.json",
  ".ai/observability/examples/provider-request-reduced.json",
  ".ai/observability/examples/delegation-decision.json",
  ".ai/evals/schemas/eval-case.schema.json",
  ".ai/evals/schemas/eval-result.schema.json",
  ".ai/evals/suites/orchestrator.yml",
  ".ai/evals/suites/security.yml",
  ".ai/evals/suites/local-first.yml",
  ".ai/evals/datasets/simple-tasks.yml",
  ".ai/evals/datasets/unsafe-requests.yml",
  ".ai/evals/datasets/skill-routing.yml",
  ".ai/evals/baselines/phase-1-architecture-kernel.json",
  ".ai/harnesses/pi/adapter-design.md",
  ".ai/harnesses/pi/extension-design.md",
  ".ai/execution/local-capabilities.json",
  ".ai/execution/phase-1-architecture-kernel.md",
  ".ai/execution/phase-2-handoff.md"
];

const agentIds = ["orchestrator", "developer", "qa", "librarian", "architect", "reviewer"];

function fail(message) {
  throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function parseJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function assertExists(relativePath) {
  if (!fs.existsSync(path.join(root, relativePath))) {
    fail(`Missing required Phase 1 file: ${relativePath}`);
  }
}

function frontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) fail("Agent spec is missing frontmatter");
  return Object.fromEntries(
    match[1]
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const index = line.indexOf(":");
        if (index === -1) fail(`Invalid frontmatter line: ${line}`);
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
      })
  );
}

for (const relativePath of requiredPaths) assertExists(relativePath);

const jsonFiles = requiredPaths.filter((file) => file.endsWith(".json"));
for (const file of jsonFiles) parseJson(file);

const manifest = parseJson(".ai/manifest.json");
if (manifest.phase !== "phase-1-architecture-kernel") fail("Manifest phase must be phase-1-architecture-kernel");
if (manifest.status !== "complete") fail("Manifest status must be complete");
if (!Array.isArray(manifest.pillars) || manifest.pillars.length !== 8) fail("Manifest must list the 8 pillars");

const agentRegistry = parseJson(".ai/agents/registry.json");
if (agentRegistry.agents.length !== agentIds.length) fail("Agent registry must include all initial agents");

for (const id of agentIds) {
  const specPath = `.ai/agents/${id}.md`;
  assertExists(specPath);
  const metadata = frontmatter(read(specPath));
  if (metadata.id !== id) fail(`${specPath} has incorrect id frontmatter`);
  if (!metadata.role) fail(`${specPath} must declare role`);
  if (!metadata.permissions) fail(`${specPath} must declare permissions`);
  if (!agentRegistry.agents.some((agent) => agent.id === id && agent.spec === specPath)) {
    fail(`Agent registry does not point to ${specPath}`);
  }
}

const permissionPolicy = parseJson(".ai/policies/permissions.example.json");
if (permissionPolicy.default !== "deny") fail("Permission example must be deny by default");
if (permissionPolicy.agents.orchestrator.modify_permissions !== "deny") fail("Orchestrator must not broaden permissions");

const providerPolicy = parseJson(".ai/policies/provider-request-policy.example.json");
if (providerPolicy.default_strategy !== "local-first") fail("Provider policy must default to local-first");
if (!providerPolicy.required_trace_events.includes("provider_request_avoided")) fail("Provider policy must trace avoided provider calls");
if (!providerPolicy.required_trace_events.includes("provider_request_reduced")) fail("Provider policy must trace reduced provider calls");

const traceEvents = [
  [".ai/observability/examples/provider-request-avoided.json", "provider_request_avoided"],
  [".ai/observability/examples/provider-request-reduced.json", "provider_request_reduced"],
  [".ai/observability/examples/delegation-decision.json", "delegation_decision"]
];
for (const [file, event] of traceEvents) {
  const trace = parseJson(file);
  for (const field of ["trace_id", "timestamp", "event", "actor"]) {
    if (!trace[field]) fail(`${file} is missing ${field}`);
  }
  if (trace.event !== event) fail(`${file} must use event ${event}`);
}

const baseline = parseJson(".ai/evals/baselines/phase-1-architecture-kernel.json");
if (baseline.result !== "pass") fail("Phase 1 baseline must pass");
if (!baseline.reproducibility?.fixture_hash) fail("Phase 1 baseline must include reproducibility metadata");

const corePackage = parseJson("packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) fail("packages/core must remain harness-agnostic and dependency-free in Phase 1");

console.log(`phase 1 validation ok: ${requiredPaths.length} required files, ${agentIds.length} agents`);
