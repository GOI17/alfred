import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTenantService,
  createInMemoryTenantStore,
  createUserService,
  createInMemoryUserStore,
  sha256OfPath
} from "../../memory/src/index.js";
import {
  normalizeInitInput,
  initOutcome,
  buildWorkspaceConfig,
  defaultStorageBackendFor,
  planInitResolution
} from "../src/init.js";

const stubUserStore = createInMemoryUserStore({ initialTenants: [{ id: "usr_t_a" }] });
const userService = createUserService({ store: stubUserStore });

function makeTenantService({ initialWorkspaces = [], initialTenants = [] } = {}) {
  return createTenantService({
    store: createInMemoryTenantStore({ initialTenants, initialWorkspaces })
  });
}

test("defaultStorageBackendFor returns postgres for human_agent", () => {
  assert.equal(defaultStorageBackendFor("human_agent"), "postgres");
  assert.equal(defaultStorageBackendFor("hybrid_with_human"), "postgres");
  assert.equal(defaultStorageBackendFor("server_managed"), "postgres");
});

test("defaultStorageBackendFor returns both options for coding_agent_only", () => {
  const v = defaultStorageBackendFor("coding_agent_only");
  assert.ok(Array.isArray(v));
  assert.ok(v.includes("sqlite"));
  assert.ok(v.includes("postgres"));
});

test("normalizeInitInput rejects missing cwd", () => {
  const r = normalizeInitInput({ display_name: "X" });
  assert.equal(r.valid, false);
});

test("normalizeInitInput rejects human_agent + sqlite", () => {
  const r = normalizeInitInput({
    cwd: "/x",
    display_name: "X",
    kind: "human_agent",
    storage_backend: "sqlite"
  });
  assert.equal(r.valid, false);
});

test("normalizeInitInput accepts coding_agent_only + sqlite", () => {
  const r = normalizeInitInput({
    cwd: "/x",
    display_name: "X",
    kind: "coding_agent_only",
    storage_backend: "sqlite"
  });
  assert.equal(r.valid, true);
});

test("planInitResolution returns action=create when no conflicts", () => {
  const r = planInitResolution({ hasAncestorConflict: false, hasDescendantConflict: false });
  assert.equal(r.action, "create");
});

test("planInitResolution returns action=cancel on choice=cancel", () => {
  const r = planInitResolution({ hasAncestorConflict: false, hasDescendantConflict: true, choice: "cancel" });
  assert.equal(r.action, "cancel");
});

test("planInitResolution returns action=promote on choice=promote", () => {
  const r = planInitResolution({ hasAncestorConflict: false, hasDescendantConflict: true, choice: "promote" });
  assert.equal(r.action, "promote");
  assert.equal(r.archiveDescendants, true);
});

test("planInitResolution returns action=coexist on choice=coexist", () => {
  const r = planInitResolution({ hasAncestorConflict: true, hasDescendantConflict: false, choice: "coexist" });
  assert.equal(r.action, "coexist");
  assert.equal(r.inheritDescendants, true);
});

test("initOutcome produces a complete payload", () => {
  const out = initOutcome({
    workspace: { id: "ws_a", workspace_path: "/a", workspace_hash: "h_a" },
    tenant: {
      id: "usr_t_a",
      kind: "coding_agent_only",
      storage_backend: "sqlite",
      db_path: "/tmp/x.sqlite"
    },
    apiKey: "alk_xyz"
  });
  assert.equal(out.tenant_id, "usr_t_a");
  assert.equal(out.api_key, "alk_xyz");
  assert.equal(out.workspace_hash, "h_a");
  assert.equal(out.kind, "coding_agent_only");
});

test("buildWorkspaceConfig includes tenant + api_key + registry path", () => {
  const cfg = buildWorkspaceConfig({
    tenant: { id: "t_a", kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite" },
    apiKey: "alk_secret",
    registryPath: "/tmp/registry.sqlite"
  });
  assert.equal(cfg.registry, "/tmp/registry.sqlite");
  assert.equal(cfg.tenant.id, "t_a");
  assert.equal(cfg.api_key, "alk_secret");
});
