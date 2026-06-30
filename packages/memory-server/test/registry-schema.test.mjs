// Tests the alfred_registry schema + its two TRIGGERs using SQLite via
// `node:sqlite` (built-in, available since Node 22). Postgres compatibility
// is verified separately by running the canonical migration against psql
// when the operator has access to a Postgres instance.
//
// We exercise the schema in SQL form because the policy lives there. If a
// future bug tries to remove or weaken a CHECK, the cross-tenant snapshot
// test must fail.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const postgresMigrationPath = resolve(here, "..", "migrations", "000_alfred_registry.sql");
const sqliteMigrationPath = resolve(here, "sqlite_registry.sql");

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(sqliteMigrationPath, "utf8"));
  return db;
}

test("tenants table accepts a coding_agent_only sqlite tenant", () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO tenants (id, workspace_init_id, display_name, kind, storage_backend, db_path)
    VALUES ('t1', 'w1', 'Personal', 'coding_agent_only', 'sqlite', '/tmp/t1.sqlite')
  `).run();
  const row = db.prepare("SELECT * FROM tenants WHERE id = 't1'").get();
  assert.equal(row.kind, "coding_agent_only");
  assert.equal(row.storage_backend, "sqlite");
  assert.equal(row.db_path, "/tmp/t1.sqlite");
  assert.equal(row.db_connection, null);
});

test("tenants table accepts a human_agent postgres tenant", () => {
  const db = makeDb();
  db.prepare(`
    INSERT INTO tenants (id, workspace_init_id, display_name, kind, storage_backend, db_connection)
    VALUES ('t2', 'w2', 'Cliente A', 'human_agent', 'postgres', 'postgres://u:p@h/db')
  `).run();
  const row = db.prepare("SELECT * FROM tenants WHERE id = 't2'").get();
  assert.equal(row.kind, "human_agent");
  assert.equal(row.storage_backend, "postgres");
  assert.equal(row.db_connection, "postgres://u:p@h/db");
});

test("CHECK: human agent + sqlite is rejected by the table-level CHECK", () => {
  const db = makeDb();
  assert.throws(
    () => db.prepare(`
      INSERT INTO tenants (id, kind, storage_backend, db_path)
      VALUES ('t3', 'human_agent', 'sqlite', '/tmp/t3.sqlite')
    `).run(),
    /CHECK constraint/i
  );
});

test("CHECK: server_managed + sqlite is rejected by the table-level CHECK", () => {
  const db = makeDb();
  assert.throws(
    () => db.prepare(`
      INSERT INTO tenants (id, kind, storage_backend, db_path)
      VALUES ('t4', 'server_managed', 'sqlite', '/tmp/t4.sqlite')
    `).run(),
    /CHECK constraint/i
  );
});

test("CHECK: db_path must be set when storage_backend = sqlite", () => {
  const db = makeDb();
  assert.throws(
    () => db.prepare(`
      INSERT INTO tenants (id, kind, storage_backend)
      VALUES ('t5', 'coding_agent_only', 'sqlite')
    `).run(),
    /CHECK constraint/i
  );
});

test("TRIGGER 1: tenant cannot be deleted while a non-inherited reader exists", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t1', 'coding_agent_only', 'postgres', 'pg://x')`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path) VALUES ('w_a', 'hash_a', '/a')`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path) VALUES ('w_b', 'hash_b', '/b')`).run();
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access, inherited) VALUES ('w_a', 't1', 'owner', 0)`).run();
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access, inherited) VALUES ('w_b', 't1', 'reader', 0)`).run();

  // Removing the reader should succeed
  db.prepare(`DELETE FROM tenant_access WHERE workspace_id = 'w_b' AND tenant_id = 't1'`).run();

  // Re-add a reader and try to delete the tenant -> should fail
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access, inherited) VALUES ('w_b', 't1', 'reader', 0)`).run();

  assert.throws(
    () => db.prepare(`DELETE FROM tenants WHERE id = 't1'`).run(),
    /non-inherited readers/i
  );
});

test("TRIGGER 1: deleting a tenant with only inherited readers succeeds", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t1', 'coding_agent_only', 'postgres', 'pg://x')`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path) VALUES ('w_c', 'hash_c', '/c')`).run();
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access, inherited) VALUES ('w_c', 't1', 'owner', 0)`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path) VALUES ('w_c2', 'hash_c2', '/c2')`).run();
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access, inherited) VALUES ('w_c2', 't1', 'reader', 1)`).run();

  db.prepare(`DELETE FROM tenants WHERE id = 't1'`).run();
  const remaining = db.prepare("SELECT * FROM tenants WHERE id = 't1'").get();
  assert.equal(remaining, undefined);
});

test("TRIGGER 2: dual postgres in a workspace chain is blocked", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t_a', 'coding_agent_only', 'postgres', 'pg://a')`).run();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t_b', 'coding_agent_only', 'postgres', 'pg://b')`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path) VALUES ('w_root', 'hash_root', '/root')`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path, parent_workspace_id) VALUES ('w_child', 'hash_child', '/root/child', 'w_root')`).run();

  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access) VALUES ('w_root', 't_a', 'owner')`).run();

  // Same tenant_id is OK
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access, inherited) VALUES ('w_child', 't_a', 'reader', 1)`).run();

  // Add a different Postgres tenant as reader in the root. Now the child
  // trying to make t_b its owner must be blocked.
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access) VALUES ('w_root', 't_b', 'reader')`).run();

  assert.throws(
    () => db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access) VALUES ('w_child', 't_b', 'owner')`).run(),
    /two distinct Postgres tenants/i
  );
});

test("TRIGGER 2: dual postgres across non-hierarchical workspaces is allowed", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t_a', 'coding_agent_only', 'postgres', 'pg://a')`).run();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t_b', 'coding_agent_only', 'postgres', 'pg://b')`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path) VALUES ('w_x', 'hash_x', '/x')`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path) VALUES ('w_y', 'hash_y', '/y')`).run();

  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access) VALUES ('w_x', 't_a', 'owner')`).run();
  // Two workspaces with no parent relationship -> allowed
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access) VALUES ('w_y', 't_b', 'owner')`).run();

  const all = db.prepare("SELECT * FROM tenant_access ORDER BY tenant_id").all();
  assert.equal(all.length, 2);
});

test("tenant_api_keys enforces uniqueness on (tenant_id, key_prefix)", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t1', 'coding_agent_only', 'postgres', 'pg://x')`).run();
  db.prepare(`
    INSERT INTO tenant_api_keys (id, tenant_id, key_prefix, key_hash)
    VALUES ('k1', 't1', 'alk_7f3a', 'hash_a')
  `).run();
  assert.throws(
    () => db.prepare(`
      INSERT INTO tenant_api_keys (id, tenant_id, key_prefix, key_hash)
      VALUES ('k2', 't1', 'alk_7f3a', 'hash_b')
    `).run(),
    /UNIQUE/i
  );
});

test("CASCADE: deleting a workspace removes its tenant_access rows", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t1', 'coding_agent_only', 'postgres', 'pg://x')`).run();
  db.prepare(`INSERT INTO workspaces (id, workspace_hash, workspace_path) VALUES ('w_d', 'hash_d', '/d')`).run();
  db.prepare(`INSERT INTO tenant_access (workspace_id, tenant_id, access) VALUES ('w_d', 't1', 'owner')`).run();

  db.prepare(`DELETE FROM workspaces WHERE id = 'w_d'`).run();
  const remaining = db.prepare("SELECT * FROM tenant_access WHERE workspace_id = 'w_d'").all();
  assert.equal(remaining.length, 0);
});

test("CASCADE: deleting a tenant removes its api_keys", () => {
  const db = makeDb();
  db.prepare(`INSERT INTO tenants (id, kind, storage_backend, db_connection) VALUES ('t1', 'coding_agent_only', 'postgres', 'pg://x')`).run();
  db.prepare(`INSERT INTO tenant_api_keys (id, tenant_id, key_prefix, key_hash) VALUES ('kk1', 't1', 'alk_z', 'h')`).run();

  db.prepare(`DELETE FROM tenants WHERE id = 't1'`).run();

  const keys = db.prepare("SELECT * FROM tenant_api_keys WHERE tenant_id = 't1'").all();
  assert.equal(keys.length, 0);
});

test("canonical Postgres migration references every CHECK we expect", () => {
  const migration = readFileSync(postgresMigrationPath, "utf8");
  const expectedSnippets = [
    "kind NOT IN ('human_agent', 'hybrid_with_human')",
    "storage_backend = 'postgres'",
    "kind <> 'server_managed'",
    "prevent_tenant_delete_with_readers",
    "tenant_delete_block",
    "check_no_dual_postgres_in_hierarchy",
    "tenant_access_no_dual_pg",
    "CREATE INDEX IF NOT EXISTS tenant_api_keys_prefix_idx",
    "CREATE INDEX IF NOT EXISTS tenant_trace_tenant_idx"
  ];
  for (const snippet of expectedSnippets) {
    assert.ok(migration.includes(snippet), `migration must include: ${snippet}`);
  }
});
