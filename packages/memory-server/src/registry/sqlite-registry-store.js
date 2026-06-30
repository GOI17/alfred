// SQLite-backed registry store. Implements the full TenantStore + UserStore
// contracts against the canonical migrations in ../migrations/.
//
// One `DatabaseSync` per process. WAL mode enabled for concurrent reads.
// busy_timeout=5000 lets writes from concurrent agents queue rather than
// fail with SQLITE_BUSY.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";

const here = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = resolve(here, "..", "..", "migrations");
const DEFAULT_REGISTRY_DB = process.env.ALFRED_MEMORY_REGISTRY ?? "/tmp/alfred/registry.sqlite";

function nowIso() {
  return new Date().toISOString();
}

function genId(prefix = "usr_t") {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

function applySchema(db) {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  const sql = readFileSync(resolve(MIG_DIR, "sqlite_registry.sql"), "utf8");
  db.exec(sql);
}

// =============================================================================
// TenantStore contract
// =============================================================================

function tenantFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspace_init_id: row.workspace_init_id ?? null,
    display_name: row.display_name ?? null,
    kind: row.kind,
    storage_backend: row.storage_backend,
    db_path: row.db_path ?? null,
    db_connection: row.db_connection ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
  };
}

function workspaceFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspace_hash: row.workspace_hash,
    workspace_path: row.workspace_path,
    parent_workspace_id: row.parent_workspace_id ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    metadata: row.metadata ? JSON.parse(row.metadata) : {}
  };
}

function accessFromRow(row) {
  if (!row) return null;
  return {
    workspace_id: row.workspace_id,
    tenant_id: row.tenant_id,
    access: row.access,
    inherited: Boolean(row.inherited),
    created_at: row.created_at
  };
}

function apiKeyFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    key_prefix: row.key_prefix,
    key_hash: row.key_hash,
    key_algorithm: row.key_algorithm,
    label: row.label ?? null,
    created_at: row.created_at,
    last_used_at: row.last_used_at ?? null,
    revoked_at: row.revoked_at ?? null
  };
}

function createTenantStoreContract(db) {
  return {
    async createTenant(input) {
      const row = {
        id: input.id ?? genId(),
        workspace_init_id: input.workspace_init_id ?? null,
        display_name: input.display_name ?? null,
        kind: input.kind,
        storage_backend: input.storage_backend,
        db_path: input.db_path ?? null,
        db_connection: input.db_connection ?? null,
        archived_at: null,
        metadata: JSON.stringify(input.metadata ?? {})
      };
      try {
        db.prepare(`
          INSERT INTO tenants (id, workspace_init_id, display_name, kind, storage_backend, db_path, db_connection, archived_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(row.id, row.workspace_init_id, row.display_name, row.kind, row.storage_backend, row.db_path, row.db_connection, row.archived_at, row.metadata);
      } catch (err) {
        if (err.message.includes("UNIQUE")) {
          const e = new Error("Tenant id already exists.");
          e.code = "tenant_conflict";
          throw e;
        }
        if (err.message.includes("CHECK")) {
          // App-level invariant. Re-throw as conflict; the domain layer will
          // build a helpful error. (TenantService does its own validation
          // first; this is a safety net.)
          throw err;
        }
        throw err;
      }
      const got = db.prepare("SELECT * FROM tenants WHERE id = ?").get(row.id);
      return tenantFromRow(got);
    },

    async archiveTenant(tenantId, { archived_at }) {
      const existing = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
      if (!existing) return undefined;
      db.prepare("UPDATE tenants SET kind = 'archived', archived_at = ? WHERE id = ?").run(archived_at ?? nowIso(), tenantId);
      const got = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
      return tenantFromRow(got);
    },

    async deleteTenant(tenantId) {
      const stmt = db.prepare("DELETE FROM tenants WHERE id = ?");
      const res = stmt.run(tenantId);
      return res.changes > 0;
    },

    async listTenants({ kind, storage_backend, limit = 50, offset = 0 } = {}) {
      const where = [];
      const params = [];
      if (kind) { where.push("kind = ?"); params.push(kind); }
      if (storage_backend) { where.push("storage_backend = ?"); params.push(storage_backend); }
      const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
      const items = db.prepare(`
        SELECT * FROM tenants ${whereClause}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset).map(tenantFromRow);
      const total = db.prepare(`SELECT COUNT(*) AS c FROM tenants ${whereClause}`).get(...params).c;
      return { items, pagination: { limit, offset, total } };
    },

    async getTenant(tenantId) {
      const row = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
      return tenantFromRow(row);
    },

    async findTenantByWorkspaceHash(workspaceHash) {
      const row = db.prepare(`
        SELECT t.* FROM tenants t
        JOIN workspaces w ON w.id = t.workspace_init_id
        WHERE w.workspace_hash = ?
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 1
      `).get(workspaceHash);
      return tenantFromRow(row);
    },

    async createWorkspace(input) {
      const row = {
        id: input.id ?? genId("usr_ws"),
        workspace_hash: input.workspace_hash,
        workspace_path: input.workspace_path,
        parent_workspace_id: input.parent_workspace_id ?? null,
        metadata: JSON.stringify(input.metadata ?? {})
      };
      try {
        db.prepare(`
          INSERT INTO workspaces (id, workspace_hash, workspace_path, parent_workspace_id, metadata)
          VALUES (?, ?, ?, ?, ?)
        `).run(row.id, row.workspace_hash, row.workspace_path, row.parent_workspace_id, row.metadata);
      } catch (err) {
        if (err.message.includes("UNIQUE")) {
          const e = new Error("Workspace hash already registered.");
          e.code = "tenant_conflict";
          throw e;
        }
        throw err;
      }
      const got = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(row.id);
      return workspaceFromRow(got);
    },

    async getWorkspace(id) {
      const row = db.prepare("SELECT * FROM workspaces WHERE id = ?").get(id);
      return workspaceFromRow(row);
    },

    async findWorkspaceByHash(workspaceHash) {
      const row = db.prepare("SELECT * FROM workspaces WHERE workspace_hash = ? ORDER BY created_at DESC, id DESC LIMIT 1").get(workspaceHash);
      return workspaceFromRow(row);
    },

    async findDescendantWorkspaces(workspaceId, { maxDepth = 3 } = {}) {
      const rows = db.prepare(`
        WITH RECURSIVE chain(id, depth) AS (
          SELECT id, 0 FROM workspaces WHERE id = ?
          UNION ALL
          SELECT w.id, c.depth + 1 FROM workspaces w
          JOIN chain c ON w.parent_workspace_id = c.id
          WHERE c.depth < ?
        )
        SELECT w.* FROM workspaces w
        JOIN chain c ON c.id = w.id
        WHERE c.depth > 0
        ORDER BY c.depth
      `).all(workspaceId, maxDepth);
      return rows.map(workspaceFromRow);
    },

    async findAncestorWorkspaces(workspaceId) {
      const rows = db.prepare(`
        WITH RECURSIVE chain(id, depth) AS (
          SELECT id, 0 FROM workspaces WHERE id = ?
          UNION ALL
          SELECT w.parent_workspace_id, c.depth + 1 FROM workspaces w
          JOIN chain c ON c.id = w.id
          WHERE w.parent_workspace_id IS NOT NULL
        )
        SELECT w.* FROM workspaces w
        JOIN chain c ON c.id = w.id
        WHERE c.depth > 0
        ORDER BY c.depth ASC
      `).all(workspaceId);
      return rows.map(workspaceFromRow);
    },

    async createTenantAccess(input) {
      db.prepare(`
        INSERT OR REPLACE INTO tenant_access (workspace_id, tenant_id, access, inherited)
        VALUES (?, ?, ?, ?)
      `).run(input.workspace_id, input.tenant_id, input.access, input.inherited ? 1 : 0);
      const row = db.prepare(`
        SELECT * FROM tenant_access WHERE workspace_id = ? AND tenant_id = ?
      `).get(input.workspace_id, input.tenant_id);
      return accessFromRow(row);
    },

    async deleteTenantAccess(workspaceId, tenantId) {
      const res = db.prepare("DELETE FROM tenant_access WHERE workspace_id = ? AND tenant_id = ?")
        .run(workspaceId, tenantId);
      return res.changes > 0;
    },

    async listTenantAccessForWorkspace(workspaceId, { includeInherited = false } = {}) {
      const own = db.prepare("SELECT * FROM tenant_access WHERE workspace_id = ?")
        .all(workspaceId).map(accessFromRow);
      if (!includeInherited) return own;
      const ancestors = db.prepare(`
        WITH RECURSIVE up(id) AS (
          SELECT id FROM workspaces WHERE id = ?
          UNION ALL
          SELECT w.parent_workspace_id FROM workspaces w JOIN up u ON w.id = u.id
          WHERE w.parent_workspace_id IS NOT NULL
        )
        SELECT id FROM up WHERE id != ?
      `).all(workspaceId, workspaceId);
      if (ancestors.length === 0) return own;
      const placeholders = ancestors.map(() => "?").join(", ");
      const inherited = db.prepare(`
        SELECT * FROM tenant_access
        WHERE workspace_id IN (${placeholders})
          AND inherited = 1
      `).all(...ancestors.map((a) => a.id)).map(accessFromRow);
      return [...own, ...inherited];
    },

    async listTenantAccessForTenant(tenantId) {
      return db.prepare("SELECT * FROM tenant_access WHERE tenant_id = ?").all(tenantId).map(accessFromRow);
    }
  };
}

// =============================================================================
// UserStore contract
// =============================================================================

function createUserStoreContract(db) {
  return {
    async getTenant(tenantId) {
      const row = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId);
      return tenantFromRow(row);
    },
    async addTenantStub(tenant) {
      // Used by tests to seed a tenant without provisioning. No-op in production.
      // TenantService uses createTenant() on the registry store.
    },

    async createApiKey(row) {
      try {
        db.prepare(`
          INSERT INTO tenant_api_keys (id, tenant_id, key_prefix, key_hash, key_algorithm, label, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(row.id, row.tenant_id, row.key_prefix, row.key_hash, row.key_algorithm, row.label, row.created_at);
      } catch (err) {
        if (err.message.includes("UNIQUE")) {
          const e = new Error("Key prefix collision for this tenant.");
          e.code = "tenant_conflict";
          throw e;
        }
        throw err;
      }
      const got = db.prepare("SELECT * FROM tenant_api_keys WHERE id = ?").get(row.id);
      return apiKeyFromRow(got);
    },

    async getApiKey(id) {
      const row = db.prepare("SELECT * FROM tenant_api_keys WHERE id = ?").get(id);
      return apiKeyFromRow(row);
    },

    async updateApiKey(id, patch) {
      const existing = db.prepare("SELECT * FROM tenant_api_keys WHERE id = ?").get(id);
      if (!existing) return undefined;
      const next = { ...apiKeyFromRow(existing), ...patch };
      db.prepare(`
        UPDATE tenant_api_keys
        SET last_used_at = ?, revoked_at = ?
        WHERE id = ?
      `).run(next.last_used_at, next.revoked_at, id);
      const got = db.prepare("SELECT * FROM tenant_api_keys WHERE id = ?").get(id);
      return apiKeyFromRow(got);
    },

    async findApiKeysByPrefix(prefix) {
      return db.prepare("SELECT * FROM tenant_api_keys WHERE key_prefix = ? AND revoked_at IS NULL")
        .all(prefix).map(apiKeyFromRow);
    },

    async listApiKeys({ tenant_id, active_only = true }) {
      const sql = active_only
        ? "SELECT * FROM tenant_api_keys WHERE tenant_id = ? AND revoked_at IS NULL ORDER BY created_at DESC"
        : "SELECT * FROM tenant_api_keys WHERE tenant_id = ? ORDER BY created_at DESC";
      return db.prepare(sql).all(tenant_id).map(apiKeyFromRow);
    },

    async deleteApiKeysForTenant(tenantId) {
      const res = db.prepare("DELETE FROM tenant_api_keys WHERE tenant_id = ?").run(tenantId);
      return res.changes;
    }
  };
}

// =============================================================================
// Factory
// =============================================================================

export async function createSqliteRegistryStore({ dbPath, applyMigrations = true, db = null } = {}) {
  // Lazy import node:sqlite
  const { DatabaseSync } = await import("node:sqlite");
  const path = dbPath || DEFAULT_REGISTRY_DB;
  const handle = db ?? new DatabaseSync(path);
  if (applyMigrations) applySchema(handle);
  return {
    dbPath: path,
    close() { try { handle.close(); } catch {} },
    tenants: createTenantStoreContract(handle),
    users: createUserStoreContract(handle),
    rawHandle: handle
  };
}

export { applySchema as applySqliteRegistrySchema };
