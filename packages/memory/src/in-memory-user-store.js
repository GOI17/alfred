// In-memory UserStore. Mirrors the storage layer for tenant_api_keys:
//
//   * UNIQUE(tenant_id, key_prefix)
//   * Lookup by prefix for hash comparison
//   * Cascade on tenant delete (caller is responsible for invoking
//     deleteApiKeysForTenant before deleting the tenant)
//
// Initial-state checks are relaxed for tests that seed pre-existing rows.

import { randomUUID } from "node:crypto";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function nowIso() {
  return new Date().toISOString();
}

export function createInMemoryUserStore({
  initialTenants = [],
  initialKeys = [],
  skipInitialPolicyCheck = false
} = {}) {
  const tenants = new Map();
  const keys = new Map(); // id -> row
  const keysByPrefix = new Map(); // prefix -> Set<id>
  const keysByTenant = new Map(); // tenant_id -> Set<id>

  for (const t of initialTenants) {
    if (!skipInitialPolicyCheck) {
      // hosts the basic shape required. Real policy lives in tenant store.
      if (typeof t.id !== "string" || t.id.trim() === "") {
        throw new Error("Tenant id is required.");
      }
    }
    tenants.set(t.id, { ...t });
  }
  for (const k of initialKeys) {
    keys.set(k.id, { ...k });
    if (!keysByPrefix.has(k.key_prefix)) keysByPrefix.set(k.key_prefix, new Set());
    keysByPrefix.get(k.key_prefix).add(k.id);
    if (!keysByTenant.has(k.tenant_id)) keysByTenant.set(k.tenant_id, new Set());
    keysByTenant.get(k.tenant_id).add(k.id);
  }

  function indexKey(row) {
    if (!keysByPrefix.has(row.key_prefix)) keysByPrefix.set(row.key_prefix, new Set());
    keysByPrefix.get(row.key_prefix).add(row.id);
    if (!keysByTenant.has(row.tenant_id)) keysByTenant.set(row.tenant_id, new Set());
    keysByTenant.get(row.tenant_id).add(row.id);
  }

  function deindexKey(row) {
    keysByPrefix.get(row.key_prefix)?.delete(row.id);
    if (keysByPrefix.get(row.key_prefix)?.size === 0) keysByPrefix.delete(row.key_prefix);
    keysByTenant.get(row.tenant_id)?.delete(row.id);
    if (keysByTenant.get(row.tenant_id)?.size === 0) keysByTenant.delete(row.tenant_id);
  }

  return {
    async getTenant(tenantId) {
      return clone(tenants.get(tenantId));
    },
    async requireTenant(tenantId) {
      const t = tenants.get(tenantId);
      if (!t) {
        const e = new Error("Tenant not found.");
        e.code = "tenant_conflict";
        throw e;
      }
      return clone(t);
    },

    async createApiKey(row) {
      if (keys.has(row.id)) {
        const e = new Error("Key id already exists.");
        e.code = "tenant_conflict";
        throw e;
      }
      const existingByPrefix = keysByPrefix.get(row.key_prefix);
      if (existingByPrefix && existingByPrefix.size > 0) {
        // Mimic UNIQUE(tenant_id, key_prefix). On a single tenant a prefix
        // collision is impossible because we generate a random base64url.
        for (const id of existingByPrefix) {
          const k = keys.get(id);
          if (k.tenant_id === row.tenant_id) {
            const e = new Error("UNIQUE constraint failed: tenant_id+key_prefix");
            e.code = "tenant_conflict";
            throw e;
          }
        }
      }
      keys.set(row.id, { ...row });
      indexKey({ ...row });
      return clone(row);
    },

    async getApiKey(id) {
      return clone(keys.get(id));
    },

    async updateApiKey(id, patch) {
      const existing = keys.get(id);
      if (!existing) return undefined;
      deindexKey(existing);
      const next = { ...existing, ...patch };
      keys.set(id, next);
      indexKey(next);
      return clone(next);
    },

    async findApiKeysByPrefix(prefix) {
      const set = keysByPrefix.get(prefix);
      if (!set) return [];
      const out = [];
      for (const id of set) {
        if (keys.has(id)) out.push(clone(keys.get(id)));
      }
      return out;
    },

    async listApiKeys({ tenant_id, active_only = true } = {}) {
      const set = keysByTenant.get(tenant_id);
      if (!set) return [];
      const out = [];
      for (const id of set) {
        const k = keys.get(id);
        if (!k) continue;
        if (active_only && k.revoked_at) continue;
        out.push(clone(k));
      }
      return out;
    },

    async deleteApiKeysForTenant(tenantId) {
      const set = keysByTenant.get(tenantId);
      if (!set) return 0;
      let n = 0;
      for (const id of [...set]) {
        const k = keys.get(id);
        if (k) {
          deindexKey(k);
          keys.delete(id);
          n += 1;
        }
      }
      keysByTenant.delete(tenantId);
      return n;
    },

    async addTenantStub(tenant) {
      tenants.set(tenant.id, { ...tenant });
    }
  };
}
