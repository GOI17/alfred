import fs from "node:fs";
import path from "node:path";
import { runPiSkillLoadingSpike } from "../packages/pi-adapter/src/runtime.js";

const root = process.cwd();
const traceOutputPath = path.join(root, ".ai/observability/generated/phase-6-skill-activation.json");

function fail(message) {
  throw new Error(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const requiredPaths = [
  ".ai/skills/registry.json",
  ".ai/skills/registry.schema.json",
  ".ai/skills/project/typescript-project/SKILL.md",
  ".ai/skills/project/architecture-docs/SKILL.md",
  ".ai/evals/suites/skill-loading.yml",
  ".ai/evals/datasets/skill-loading.yml",
  ".ai/evals/baselines/phase-6-skill-packs-lazy-loading.json",
  "packages/core/src/index.js",
  "packages/pi-adapter/src/runtime.js"
];

for (const relativePath of requiredPaths) {
  if (!fs.existsSync(path.join(root, relativePath))) fail(`Missing required Phase 6 file: ${relativePath}`);
}

const registry = readJson(".ai/skills/registry.json");
if (registry.policy?.loading !== "lazy") fail("Phase 6 skill registry must use lazy loading");
if (registry.policy?.default !== "do-not-load") fail("Phase 6 skill registry must default to do-not-load");
if (registry.policy?.load_bodies_globally !== false) fail("Phase 6 must forbid global skill body loading");
if (!registry.policy?.scope.includes("project")) fail("Phase 6 must keep skills project-scoped by default");
if (registry.skills.length < 2) fail("Phase 6 must register concrete skill packs");

for (const skill of registry.skills) {
  if (skill.scope !== "project") fail(`Skill must be project-scoped: ${skill.id}`);
  if (skill.loadsBodyByDefault !== false) fail(`Skill body must not load by default: ${skill.id}`);
  if (!skill.bodyPath?.startsWith(".ai/skills/project/")) fail(`Skill body must live under project skills: ${skill.id}`);
  if (!fs.existsSync(path.join(root, skill.bodyPath))) fail(`Missing skill body: ${skill.bodyPath}`);
  if (!skill.allowedAgents?.includes("orchestrator")) fail(`Orchestrator must be allowed to activate skill metadata: ${skill.id}`);
  const body = readText(skill.bodyPath);
  if (!body.startsWith("---")) fail(`Skill must contain normalized frontmatter: ${skill.id}`);
  if (!body.includes(`id: ${skill.id}`)) fail(`Skill frontmatter id must match registry: ${skill.id}`);
  if (!body.includes("scope: project")) fail(`Skill frontmatter must remain project-scoped: ${skill.id}`);
}

const result = runPiSkillLoadingSpike({ root, traceOutputPath });
if (result.manifest_phase !== "phase-1-architecture-kernel") fail("Phase 6 must load the architecture kernel");
if (result.orchestrator.id !== "orchestrator") fail("Phase 6 must activate through the Orchestrator");
if (result.loaded_skill_bodies !== 0) fail("Phase 6 must not load skill bodies during metadata activation");
if (result.trace.data.provider_calls !== 0) fail("Phase 6 must not call providers");
if (result.activation_decisions.length !== 2) fail("Phase 6 fixture must select both project skills");
for (const decision of result.activation_decisions) {
  if (decision.load_body !== false) fail(`Selected skill body was loaded eagerly: ${decision.skill_id}`);
  if (decision.scope !== "project") fail(`Selected skill must remain project-scoped: ${decision.skill_id}`);
  if (!decision.allowed_agent) fail(`Selected skill must be allowed for orchestrator: ${decision.skill_id}`);
}

if (!fs.existsSync(traceOutputPath)) fail("Phase 6 generated trace file was not written");
const trace = readJson(".ai/observability/generated/phase-6-skill-activation.json");
if (trace.event !== "skill_activation_decision") fail("Phase 6 trace must be skill_activation_decision");
if (trace.data.provider_calls !== 0) fail("Phase 6 trace must record zero provider calls");
if (trace.data.loaded_skill_bodies !== 0) fail("Phase 6 trace must record zero loaded skill bodies");
if (trace.data.selected_skill_ids.length !== 2) fail("Phase 6 trace must include selected skills");
if (trace.data.policy.load_bodies_globally !== false) fail("Phase 6 trace must preserve lazy body policy");

const baseline = readJson(".ai/evals/baselines/phase-6-skill-packs-lazy-loading.json");
if (baseline.result !== "pass") fail("Phase 6 baseline must pass");
if (baseline.registered_skills !== registry.skills.length) fail("Phase 6 baseline must match registered skills");
if (baseline.project_scoped_skills !== registry.skills.length) fail("Phase 6 baseline must record project-scoped skills");
if (baseline.loaded_skill_bodies !== 0) fail("Phase 6 baseline must record zero loaded skill bodies");
if (baseline.provider_calls !== 0) fail("Phase 6 baseline must record zero provider calls");
if (!baseline.reproducibility?.runtime_entrypoint) fail("Phase 6 baseline must include runtime entrypoint metadata");

const corePackage = readJson("packages/core/package.json");
if (corePackage.dependencies || corePackage.devDependencies) {
  fail("packages/core must remain dependency-free and harness-agnostic during Phase 6");
}

console.log("phase 6 validation ok: skill packs are project-scoped, lazy-loaded, observable, and local-only");
