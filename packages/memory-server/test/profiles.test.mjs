import { test } from "node:test";
import assert from "node:assert/strict";

const {
  PROFILES,
  resolveProfile,
  listProfiles,
  buildInitPlan,
  nextStepsFor
} = await import("../src/profiles/init-profiles.js");

test("PROFILES defines coding, web, both", () => {
  assert.ok(PROFILES.coding);
  assert.ok(PROFILES.web);
  assert.ok(PROFILES.both);
  assert.equal(PROFILES.coding.tenant_kind, "coding_agent_only");
  assert.equal(PROFILES.web.tenant_kind, "human_agent");
  assert.equal(PROFILES.both.tenant_kind, "hybrid_with_human");
  assert.equal(PROFILES.coding.write_workspace_config, true);
  assert.equal(PROFILES.web.write_workspace_config, false);
  assert.equal(PROFILES.both.write_workspace_config, true);
});

test("resolveProfile defaults to coding", () => {
  assert.equal(resolveProfile().name, "coding");
  assert.equal(resolveProfile(undefined).name, "coding");
});

test("resolveProfile returns null for unknown", () => {
  assert.equal(resolveProfile("nope"), null);
});

test("listProfiles returns all 3 profiles", () => {
  const all = listProfiles();
  assert.equal(all.length, 3);
  const names = all.map((p) => p.name);
  assert.ok(names.includes("coding"));
  assert.ok(names.includes("web"));
  assert.ok(names.includes("both"));
});

test("buildInitPlan coding profile defaults to sqlite", () => {
  const r = buildInitPlan({ profileName: "coding", name: "test" });
  assert.equal(r.ok, true);
  assert.equal(r.plan.tenant_kind, "coding_agent_only");
  assert.equal(r.plan.storage, "sqlite");
  assert.equal(r.plan.write_workspace_config, true);
  assert.ok(r.plan.db_path);
  assert.equal(r.plan.db_connection, null);
});

test("buildInitPlan web profile defaults to postgres", () => {
  const r = buildInitPlan({ profileName: "web", name: "test", db_connection: "postgres://x" });
  assert.equal(r.ok, true);
  assert.equal(r.plan.tenant_kind, "human_agent");
  assert.equal(r.plan.storage, "postgres");
  assert.equal(r.plan.write_workspace_config, false);
  assert.equal(r.plan.db_path, null);
  assert.equal(r.plan.db_connection, "postgres://x");
});

test("buildInitPlan both profile defaults to postgres", () => {
  const r = buildInitPlan({ profileName: "both", name: "test", db_connection: "postgres://x" });
  assert.equal(r.ok, true);
  assert.equal(r.plan.tenant_kind, "hybrid_with_human");
  assert.equal(r.plan.storage, "postgres");
  assert.equal(r.plan.write_workspace_config, true);
});

test("buildInitPlan web + sqlite is rejected (hosting policy)", () => {
  const r = buildInitPlan({ profileName: "web", name: "test", storage: "sqlite" });
  assert.equal(r.ok, false);
  assert.match(r.error, /requires Postgres/);
});

test("buildInitPlan coding + postgres requires --db-connection", () => {
  const r = buildInitPlan({ profileName: "coding", name: "test", storage: "postgres" });
  assert.equal(r.ok, false);
  assert.match(r.error, /--db-connection/);
});

test("buildInitPlan unknown profile returns error", () => {
  const r = buildInitPlan({ profileName: "made-up" });
  assert.equal(r.ok, false);
});

test("nextStepsFor: coding returns config-based steps", () => {
  const lines = nextStepsFor("coding", { api_key: "alk_test" });
  const text = lines.join("\n");
  assert.match(text, /Your config is already in/);
  assert.match(text, /ALFRED_MEMORY_BASE_URL/);
  assert.match(text, /alk_test/);
});

test("nextStepsFor: web returns ChatGPT/Claude/Gemini steps", () => {
  const lines = nextStepsFor("web", { api_key: "alk_xyz" });
  const text = lines.join("\n");
  assert.match(text, /ChatGPT/);
  assert.match(text, /Claude/);
  assert.match(text, /Gemini/);
  assert.match(text, /alk_xyz/);
  assert.match(text, /openapi\.json/);
});

test("nextStepsFor: both includes both", () => {
  const lines = nextStepsFor("both", { api_key: "alk_q" });
  const text = lines.join("\n");
  assert.match(text, /coding \+ web/);
  assert.match(text, /adapters instructions/);
});

test("nextStepsFor: unknown kind returns placeholder", () => {
  const lines = nextStepsFor("made-up");
  assert.match(lines.join("\n"), /No next steps/);
});
