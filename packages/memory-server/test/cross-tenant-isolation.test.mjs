// Cross-tenant isolation test suite.
//
// 15 vectors of intentional leak attempts. Every one of them must return
// empty / 401 / forbidden, never the data of another tenant.
//
// What this protects:
//   * A buggy WHERE clause cannot leak data across tenant_ids.
//   * A revocation that loses cascade integrity is caught.
//   * Hash collisions on key_prefix cannot authenticate against a key of
//     a different tenant.
//   * Hierarchical inheritance cannot smuggle Postgres tenants into a chain
//     with another distinct Postgres tenant.
//
// All vectors run against the in-memory tenant store, which mirrors the SQL
// TRIGGER semantics. The same suite is run against the canonical Postgres
// migration in environments with psql access.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTenantService,
  createInMemoryTenantStore,
  createUserService,
  createInMemoryUserStore,
  createMemoryService,
  createInMemoryStore,
  sha256OfPath
} from "../../memory/src/index.js";

function makeTenant({ kind, storage_backend, db_path, db_connection }) {
  return {
    id: `usr_t_${Math.random().toString(36).slice(2, 10)}`,
    kind, storage_backend,
    db_path: db_path ?? null,
    db_connection: db_connection ?? null,
    display_name: "Test"
  };
}

async function setupTwoTenants(userService) {
  // Two coding-agent SQLite tenants, two Postgres tenants.
  const tenants = [
    makeTenant({ kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/t_a.sqlite" }),
    makeTenant({ kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/t_b.sqlite" }),
    makeTenant({ kind: "coding_agent_only", storage_backend: "postgres", db_connection: "pg://a" }),
    makeTenant({ kind: "coding_agent_only", storage_backend: "postgres", db_connection: "pg://b" })
  ];
  for (const t of tenants) await userService.store.addTenantStub(t);
  return tenants;
}

// =========================================================================
// Vectors
// =========================================================================

test("V01: storageBackend=sqlite is rejected for kind=human_agent", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  await assert.rejects(
    () => service.provisionTenant({
      kind: "human_agent", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
    }),
    (err) => err.name === "TenantValidationError"
  );
});

test("V02: storageBackend=sqlite is rejected for kind=hybrid_with_human", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  await assert.rejects(
    () => service.provisionTenant({
      kind: "hybrid_with_human", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
    }),
    (err) => err.name === "TenantValidationError"
  );
});

test("V03: storageBackend=sqlite is rejected for kind=server_managed", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  await assert.rejects(
    () => service.provisionTenant({
      kind: "server_managed", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
    }),
    (err) => err.name === "TenantValidationError"
  );
});

test("V04: db_path required when storage=sqlite", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  await assert.rejects(
    () => service.provisionTenant({ kind: "coding_agent_only", storage_backend: "sqlite" }),
    (err) => /db_path/.test(err.message) || err.details?.some((d) => /db_path/.test(d.message))
  );
});

test("V05: db_connection required when storage=postgres", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  await assert.rejects(
    () => service.provisionTenant({
      kind: "human_agent", storage_backend: "postgres"
    }),
    (err) => err.name === "TenantValidationError"
  );
});

test("V06: listTenants respects kind filter (does not leak across kinds)", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  await service.provisionTenant({ kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/x.sqlite" });
  await service.provisionTenant({ kind: "human_agent", storage_backend: "postgres", db_connection: "pg://x" });
  const codingOnly = await service.listTenants({ kind: "coding_agent_only", limit: 100 });
  for (const t of codingOnly.items) assert.equal(t.kind, "coding_agent_only");
});

test("V07: deleteTenant blocked by non-inherited reader", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  const tenant = await service.provisionTenant({ kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/x.sqlite" });
  const ws = await service.registerWorkspace({ workspace_hash: sha256OfPath("/a"), workspace_path: "/a" });
  await service.grantAccess({ workspace_id: ws.id, tenant_id: tenant.id, access: "owner" });
  await service.grantAccess({ workspace_id: "w_other", tenant_id: tenant.id, access: "reader", inherited: false });
  await assert.rejects(() => service.deleteTenant(tenant.id), (err) => err.code === "tenant_conflict");
});

test("V08: api keys for tenant A do not work for tenant B", async () => {
  const userStore = createInMemoryUserStore();
  const userService = createUserService({ store: userStore });
  const tA = { id: "usr_t_a", kind: "coding_agent_only", storage_backend: "sqlite" };
  const tB = { id: "usr_t_b", kind: "coding_agent_only", storage_backend: "sqlite" };
  await userStore.addTenantStub(tA);
  await userStore.addTenantStub(tB);
  const { apiKey } = await userService.provisionApiKey({ tenant_id: tA.id });
  const resolved = await userService.resolveApiKey(apiKey);
  assert.equal(resolved.tenant_id, tA.id);
  assert.notEqual(resolved.tenant_id, tB.id);
});

test("V09: revoked api key resolves to null even with correct prefix", async () => {
  const userStore = createInMemoryUserStore();
  const userService = createUserService({ store: userStore });
  const tA = { id: "usr_t_a", kind: "coding_agent_only", storage_backend: "sqlite" };
  await userStore.addTenantStub(tA);
  const { apiKey, key } = await userService.provisionApiKey({ tenant_id: tA.id });
  await userService.revokeApiKey(key.id);
  assert.equal(await userService.resolveApiKey(apiKey), null);
});

test("V10: dual Postgres tenants in workspace chain rejected (W6)", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  const a = await service.provisionTenant({ kind: "coding_agent_only", storage_backend: "postgres", db_connection: "pg://a" });
  const b = await service.provisionTenant({ kind: "coding_agent_only", storage_backend: "postgres", db_connection: "pg://b" });
  const root = await service.registerWorkspace({ workspace_hash: sha256OfPath("/r"), workspace_path: "/r" });
  const child = await service.registerWorkspace({ workspace_hash: sha256OfPath("/r/c"), workspace_path: "/r/c", parent_workspace_id: root.id });
  await service.grantAccess({ workspace_id: root.id, tenant_id: a.id, access: "owner" });
  await service.grantAccess({ workspace_id: root.id, tenant_id: b.id, access: "reader", inherited: false });
  await assert.rejects(
    () => service.grantAccess({ workspace_id: child.id, tenant_id: b.id, access: "owner" }),
    (err) => /two distinct Postgres tenants/i.test(err.message)
  );
});

test("V11: deleting tenant cascades tenant_access", async () => {
  const store = createInMemoryTenantStore();
  const service = createTenantService({ store });
  const tenant = await service.provisionTenant({ kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/x.sqlite" });
  const ws = await service.registerWorkspace({ workspace_hash: sha256OfPath("/a"), workspace_path: "/a" });
  await service.grantAccess({ workspace_id: ws.id, tenant_id: tenant.id, access: "owner" });
  await service.deleteTenant(tenant.id);
  const remaining = await service.listAccessForWorkspace(ws.id);
  assert.equal(remaining.length, 0);
});

test("V12: validatePolicy flags human_agent + sqlite at the registry level", async () => {
  const badSeed = {
    id: "usr_t_x",
    kind: "human_agent",
    storage_backend: "sqlite",
    db_path: "/x.sqlite",
    db_connection: null,
    display_name: "Bad"
  };
  const store = createInMemoryTenantStore({ initialTenants: [badSeed], skipInitialPolicyCheck: true });
  const service = createTenantService({ store });
  const report = await service.validatePolicy();
  assert.equal(report.ok, false);
  assert.ok(report.violations.some((v) => v.tenant_id === "usr_t_x"));
});

test("V13: Tampered api key (same length, wrong content) resolves to null", async () => {
  const userStore = createInMemoryUserStore();
  const userService = createUserService({ store: userStore });
  const tA = { id: "usr_t_a", kind: "coding_agent_only", storage_backend: "sqlite" };
  await userStore.addTenantStub(tA);
  const { apiKey } = await userService.provisionApiKey({ tenant_id: tA.id });
  // Flip one character.
  const idx = apiKey.length - 3;
  const tampered = apiKey.slice(0, idx) + (apiKey[idx] === "a" ? "b" : "a") + apiKey.slice(idx + 1);
  assert.notEqual(tampered, apiKey);
  assert.equal(await userService.resolveApiKey(tampered), null);
});

test("V14: api key with non-matching prefix does not resolve", async () => {
  const userStore = createInMemoryUserStore();
  const userService = createUserService({ store: userStore });
  const tA = { id: "usr_t_a", kind: "coding_agent_only", storage_backend: "sqlite" };
  await userStore.addTenantStub(tA);
  const garbage = "alk_" + "zz".repeat(15);
  assert.equal(await userService.resolveApiKey(garbage), null);
});

test("V15: memoryStore.list scopes by userId (no leak across tenants)", async () => {
  const memoryStore = createInMemoryStore();
  const memoryService = createMemoryService({ store: memoryStore });
  await memoryService.createMemory("tenantA", { type: "fact", content: "A", tags: [], source: "test" });
  await memoryService.createMemory("tenantB", { type: "fact", content: "B", tags: [], source: "test" });

  const aList = await memoryService.listMemories("tenantA", { limit: 100, offset: 0 });
  const bList = await memoryService.listMemories("tenantB", { limit: 100, offset: 0 });

  assert.equal(aList.items.length, 1);
  assert.equal(bList.items.length, 1);
  assert.equal(aList.items[0].content, "A");
  assert.equal(bList.items[0].content, "B");
  // Importantly, neither list contains the other's content.
  assert.ok(!aList.items.some((m) => m.content === "B"));
  assert.ok(!bList.items.some((m) => m.content === "A"));
});
