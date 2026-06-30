import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { createSqliteRegistryStore } = await import("../src/registry/sqlite-registry-store.js");

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "alfred-reg-"));
  const path = join(dir, "registry.sqlite");
  return { dir, path };
}

function cleanup({ dir, store }) {
  try { store && store.close(); } catch {}
  if (dir) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

async function openTestStore() {
  const ctx = freshDir();
  try {
    const store = await createSqliteRegistryStore({ dbPath: ctx.path });
    return Object.assign(ctx, { store });
  } catch (err) {
    cleanup(ctx);
    throw err;
  }
}

test("applySchema creates all expected tables and triggers", async () => {
  const { store } = await openTestStore();
  try {
    const tables = store.rawHandle.prepare(`
      SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name
    `).all().map((r) => r.name);
    for (const expected of [
      "tenants", "workspaces", "tenant_access",
      "tenant_api_keys", "tenant_trace", "__tenants_update_buffer",
      "tenant_delete_block", "tenant_access_no_dual_pg_insert",
      "tenant_access_no_dual_pg_update"
    ]) {
      assert.ok(tables.includes(expected), `expected schema piece: ${expected}`);
    }
  } finally { cleanup({ dir: null, store }); }
});

test("createTenant + listTenants roundtrip", async () => {
  const ctx = await openTestStore();
  try {
    const tenant = await ctx.store.tenants.createTenant({
      kind: "coding_agent_only", storage_backend: "sqlite",
      db_path: "/tmp/a.sqlite", display_name: "A"
    });
    assert.ok(tenant.id.startsWith("usr_t_"));
    const list = await ctx.store.tenants.listTenants({});
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].id, tenant.id);
  } finally { cleanup(ctx); }
});

test("CHECK: human_agent + sqlite is rejected", async () => {
  const ctx = await openTestStore();
  try {
    await assert.rejects(
      () => ctx.store.tenants.createTenant({ kind: "human_agent", storage_backend: "sqlite", db_path: "/tmp/x.sqlite" }),
      /CHECK/i
    );
  } finally { cleanup(ctx); }
});

test("CHECK: server_managed + sqlite is rejected", async () => {
  const ctx = await openTestStore();
  try {
    await assert.rejects(
      () => ctx.store.tenants.createTenant({ kind: "server_managed", storage_backend: "sqlite", db_path: "/tmp/x.sqlite" }),
      /CHECK/i
    );
  } finally { cleanup(ctx); }
});

test("CHECK: db_path required when storage=sqlite", async () => {
  const ctx = await openTestStore();
  try {
    await assert.rejects(
      () => ctx.store.tenants.createTenant({ kind: "coding_agent_only", storage_backend: "sqlite" }),
      /CHECK/i
    );
  } finally { cleanup(ctx); }
});

test("CHECK: db_connection required when storage=postgres", async () => {
  const ctx = await openTestStore();
  try {
    await assert.rejects(
      () => ctx.store.tenants.createTenant({ kind: "human_agent", storage_backend: "postgres" }),
      /CHECK/i
    );
  } finally { cleanup(ctx); }
});

test("TRIGGER 1: tenant with non-inherited reader blocks delete", async () => {
  const ctx = await openTestStore();
  try {
    const tenant = await ctx.store.tenants.createTenant({
      kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
    });
    const ws = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_owner_t1", workspace_path: "/owner"
    });
    const ws2 = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_reader_t1", workspace_path: "/reader"
    });
    await ctx.store.tenants.createTenantAccess({
      workspace_id: ws.id, tenant_id: tenant.id, access: "owner", inherited: false
    });
    await ctx.store.tenants.createTenantAccess({
      workspace_id: ws2.id, tenant_id: tenant.id, access: "reader", inherited: false
    });
    await assert.rejects(
      () => ctx.store.tenants.deleteTenant(tenant.id),
      /non-inherited readers/i
    );
  } finally { cleanup(ctx); }
});

test("TRIGGER 1: tenant with only inherited reader can be deleted", async () => {
  const ctx = await openTestStore();
  try {
    const tenant = await ctx.store.tenants.createTenant({
      kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
    });
    const ws = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_owner_t2", workspace_path: "/owner"
    });
    const ws2 = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_inh_t2", workspace_path: "/inh"
    });
    await ctx.store.tenants.createTenantAccess({
      workspace_id: ws.id, tenant_id: tenant.id, access: "owner", inherited: false
    });
    await ctx.store.tenants.createTenantAccess({
      workspace_id: ws2.id, tenant_id: tenant.id, access: "reader", inherited: true
    });
    const res = await ctx.store.tenants.deleteTenant(tenant.id);
    assert.equal(res, true);
  } finally { cleanup(ctx); }
});

test("TRIGGER 2: dual distinct Postgres rejected in workspace chain", async () => {
  const ctx = await openTestStore();
  try {
    const a = await ctx.store.tenants.createTenant({
      kind: "coding_agent_only", storage_backend: "postgres", db_connection: "pg://a"
    });
    const b = await ctx.store.tenants.createTenant({
      kind: "coding_agent_only", storage_backend: "postgres", db_connection: "pg://b"
    });
    const root = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_root_t3", workspace_path: "/r"
    });
    const child = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_child_t3", workspace_path: "/r/c", parent_workspace_id: root.id
    });
    await ctx.store.tenants.createTenantAccess({
      workspace_id: root.id, tenant_id: a.id, access: "owner", inherited: false
    });
    await ctx.store.tenants.createTenantAccess({
      workspace_id: root.id, tenant_id: b.id, access: "reader", inherited: false
    });
    await assert.rejects(
      () => ctx.store.tenants.createTenantAccess({
        workspace_id: child.id, tenant_id: b.id, access: "owner", inherited: false
      }),
      /two distinct Postgres tenants/i
    );
  } finally { cleanup(ctx); }
});

test("TRIGGER 2: same Postgres tenant_id across levels allowed", async () => {
  const ctx = await openTestStore();
  try {
    const a = await ctx.store.tenants.createTenant({
      kind: "coding_agent_only", storage_backend: "postgres", db_connection: "pg://a"
    });
    const root = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_root_t4", workspace_path: "/r"
    });
    const child = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_child_t4", workspace_path: "/r/c", parent_workspace_id: root.id
    });
    await ctx.store.tenants.createTenantAccess({
      workspace_id: root.id, tenant_id: a.id, access: "owner", inherited: false
    });
    const row = await ctx.store.tenants.createTenantAccess({
      workspace_id: child.id, tenant_id: a.id, access: "reader", inherited: true
    });
    assert.equal(row.tenant_id, a.id);
  } finally { cleanup(ctx); }
});

test("UNIQUE workspace_hash enforced", async () => {
  const ctx = await openTestStore();
  try {
    await ctx.store.tenants.createWorkspace({
      workspace_hash: "dup_unique_t5", workspace_path: "/a"
    });
    await assert.rejects(
      () => ctx.store.tenants.createWorkspace({
        workspace_hash: "dup_unique_t5", workspace_path: "/b"
      }),
      (err) => /hash already|UNIQUE/i.test(err.message)
    );
  } finally { cleanup(ctx); }
});

test("CASCADE: deleting tenant removes API keys", async () => {
  const ctx = await openTestStore();
  try {
    const tenant = await ctx.store.tenants.createTenant({
      kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
    });
    await ctx.store.users.createApiKey({
      id: "k1", tenant_id: tenant.id, key_prefix: "alk_aaa",
      key_hash: "scrypt$1$1$1$aa$bb",
      key_algorithm: "scrypt",
      label: "smoke",
      created_at: "2026-01-01T00:00:00Z"
    });
    const ws = await ctx.store.tenants.createWorkspace({
      workspace_hash: "h_owner_cascade_t6", workspace_path: "/owner"
    });
    await ctx.store.tenants.createTenantAccess({
      workspace_id: ws.id, tenant_id: tenant.id, access: "owner", inherited: false
    });
    await ctx.store.tenants.deleteTenant(tenant.id);
    const keys = await ctx.store.users.listApiKeys({ tenant_id: tenant.id, active_only: false });
    assert.equal(keys.length, 0);
  } finally { cleanup(ctx); }
});

test("TenantService over SQLite registry enforces policy and lists", async () => {
  const ctx = await openTestStore();
  try {
    const { createTenantService } = await import("../../memory/src/index.js");
    const svc = createTenantService({ store: ctx.store.tenants });
    await svc.provisionTenant({
      kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
    });
    await assert.rejects(
      () => svc.provisionTenant({
        kind: "human_agent", storage_backend: "sqlite", db_path: "/tmp/y.sqlite"
      }),
      (err) => err.name === "TenantValidationError"
    );
  } finally { cleanup(ctx); }
});

test("UserService over SQLite registry: provision, rotate, revoke, resolve", async () => {
  const ctx = await openTestStore();
  try {
    const tenant = await ctx.store.tenants.createTenant({
      kind: "coding_agent_only", storage_backend: "sqlite", db_path: "/tmp/x.sqlite"
    });
    const { createUserService } = await import("../../memory/src/index.js");
    const svc = createUserService({ store: ctx.store.users });
    const r1 = await svc.provisionApiKey({ tenant_id: tenant.id, label: "first" });
    const r2 = await svc.rotateApiKey({ tenant_id: tenant.id, label: "rotated" });
    assert.notEqual(r2.apiKey, r1.apiKey);
    const r3 = await svc.resolveApiKey(r1.apiKey);
    assert.equal(r3, null);
    const r4 = await svc.resolveApiKey(r2.apiKey);
    assert.equal(r4.tenant_id, tenant.id);
  } finally { cleanup(ctx); }
});
