// In-memory TenantStore. Mirrors the SQL semantics closely enough to be used
// in tests. Notably, this implementation replicates the two TRIGGER
// behaviors from migrations/000_alfred_registry.sql:
//
//   * tenants BEFORE DELETE: refuse if any non-inherited reader exists.
//   * tenant_access INSERT: refuse owner-postgres if an ancestor has a
//     distinct owner-postgres.
//
// Initial-state policy checks are deliberately relaxed so tests can seed
// "already-violating" rows when explicitly testing the validatePolicy flow.

import { createHash } from "node:crypto";

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeTenantRow(row) {
  return {
    ...row,
    metadata: row.metadata ?? {},
    archived_at: row.archived_at ?? null
  };
}

function normalizeWorkspaceRow(row) {
  return {
    ...row,
    metadata: row.metadata ?? {}
  };
}

function defaultTenantSort(left, right) {
  return right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

function assertCreatePolicy(tenant) {
  if ((tenant.kind === "human_agent" || tenant.kind === "hybrid_with_human") && tenant.storage_backend !== "postgres") {
    const error = new Error("Tenants of kind '" + tenant.kind + "' MUST use Postgres (hosting-policy Rule 1).");
    error.code = "hosting_policy_violation";
    throw error;
  }
  if (tenant.kind === "server_managed" && tenant.storage_backend !== "postgres") {
    const error = new Error("Tenants of kind 'server_managed' MUST use Postgres (hosting-policy Rule 3).");
    error.code = "hosting_policy_violation";
    throw error;
  }
  if (tenant.storage_backend === "sqlite" && !tenant.db_path) {
    const error = new Error("db_path is required when storage_backend = 'sqlite'.");
    error.code = "hosting_policy_violation";
    throw error;
  }
  if (tenant.storage_backend === "sqlite" && tenant.db_connection) {
    const error = new Error("db_connection must be null when storage_backend = 'sqlite'.");
    error.code = "hosting_policy_violation";
    throw error;
  }
  if (tenant.storage_backend === "postgres" && !tenant.db_connection) {
    const error = new Error("db_connection is required when storage_backend = 'postgres'.");
    error.code = "hosting_policy_violation";
    throw error;
  }
  if (tenant.storage_backend === "postgres" && tenant.db_path) {
    const error = new Error("db_path must be null when storage_backend = 'postgres'.");
    error.code = "hosting_policy_violation";
    throw error;
  }
}

function assertNoDualPostgres(tenants, workspaces, tenantAccess, newRow) {
  if (newRow.access !== "owner") return;
  const newTenant = tenants.get(newRow.tenant_id);
  if (!newTenant || newTenant.storage_backend !== "postgres") return;

  let cursor = workspaces.get(newRow.workspace_id);
  while (cursor && cursor.parent_workspace_id) {
    cursor = workspaces.get(cursor.parent_workspace_id);
    if (!cursor) break;
    for (const ta of tenantAccess.values()) {
      if (ta.workspace_id !== cursor.id) continue;
      if (ta.access !== "owner") continue;
      if (ta.tenant_id === newRow.tenant_id) continue;
      const other = tenants.get(ta.tenant_id);
      if (other && other.storage_backend === "postgres") {
        const error = new Error("Cannot have two distinct Postgres tenants in this hierarchy");
        error.code = "hosting_policy_violation";
        throw error;
      }
    }
  }
}

export function createInMemoryTenantStore({
  initialTenants = [],
  initialWorkspaces = [],
  initialAccess = [],
  skipInitialPolicyCheck = false,
  now = () => new Date().toISOString()
} = {}) {
  const tenants = new Map();
  const workspaces = new Map();
  const tenantAccess = new Map();
  const accessByWorkspace = new Map();
  const accessByTenant = new Map();

  function indexAccess(row) {
    if (!accessByWorkspace.has(row.workspace_id)) accessByWorkspace.set(row.workspace_id, []);
    accessByWorkspace.get(row.workspace_id).push(row);
    if (!accessByTenant.has(row.tenant_id)) accessByTenant.set(row.tenant_id, []);
    accessByTenant.get(row.tenant_id).push(row);
  }

  for (const t of initialTenants) {
    const row = normalizeTenantRow({ ...t, created_at: t.created_at ?? now(), updated_at: t.updated_at ?? now() });
    if (!skipInitialPolicyCheck) assertCreatePolicy(row);
    tenants.set(row.id, row);
  }
  for (const w of initialWorkspaces) {
    const row = normalizeWorkspaceRow({ ...w, created_at: w.created_at ?? now(), updated_at: w.updated_at ?? now() });
    workspaces.set(row.id, row);
  }
  for (const ta of initialAccess) {
    const row = {
      workspace_id: ta.workspace_id,
      tenant_id: ta.tenant_id,
      access: ta.access,
      inherited: Boolean(ta.inherited),
      created_at: ta.created_at ?? now()
    };
    tenantAccess.set(`${row.workspace_id}::${row.tenant_id}`, row);
    indexAccess(row);
  }

  function findWorkspace(idOrHash) {
    if (workspaces.has(idOrHash)) return workspaces.get(idOrHash);
    for (const w of workspaces.values()) if (w.workspace_hash === idOrHash) return w;
    return undefined;
  }

  function descendantClosure(rootId, maxDepth) {
    const out = [];
    const queue = [{ id: rootId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      for (const w of workspaces.values()) {
        if (w.parent_workspace_id === id) {
          if (depth < maxDepth) {
            queue.push({ id: w.id, depth: depth + 1 });
            out.push(w);
          }
        }
      }
    }
    return out;
  }

  function ancestorChain(rootId) {
    const out = [];
    let cursor = workspaces.get(rootId);
    while (cursor && cursor.parent_workspace_id) {
      cursor = workspaces.get(cursor.parent_workspace_id);
      if (cursor) out.push(cursor);
    }
    return out;
  }

  return {
    async createTenant(input) {
      const row = normalizeTenantRow({
        ...input,
        created_at: now(),
        updated_at: now(),
        archived_at: null
      });
      assertCreatePolicy(row);
      if (tenants.has(row.id)) {
        const error = new Error("Tenant id already exists.");
        error.code = "tenant_conflict";
        throw error;
      }
      tenants.set(row.id, row);
      return clone(row);
    },

    async archiveTenant(tenantId, { archived_at }) {
      const tenant = tenants.get(tenantId);
      if (!tenant) return undefined;
      const next = normalizeTenantRow({
        ...tenant,
        kind: "archived",
        archived_at: archived_at ?? now(),
        updated_at: now()
      });
      tenants.set(tenantId, next);
      return clone(next);
    },

    async deleteTenant(tenantId) {
      const tenant = tenants.get(tenantId);
      if (!tenant) return false;

      for (const ta of tenantAccess.values()) {
        if (ta.tenant_id === tenantId && ta.access === "reader" && !ta.inherited) {
          const error = new Error("Cannot delete tenant: has non-inherited readers");
          error.code = "tenant_conflict";
          throw error;
        }
      }

      for (const key of [...tenantAccess.keys()]) {
        const ta = tenantAccess.get(key);
        if (ta.tenant_id === tenantId) tenantAccess.delete(key);
      }
      accessByTenant.delete(tenantId);
      for (const [wsId, rows] of accessByWorkspace.entries()) {
        accessByWorkspace.set(
          wsId,
          rows.filter((r) => r.tenant_id !== tenantId)
        );
      }

      tenants.delete(tenantId);
      return true;
    },

    async listTenants({ kind, storage_backend, limit = 50, offset = 0 } = {}) {
      const all = [...tenants.values()]
        .filter((t) => !kind || t.kind === kind)
        .filter((t) => !storage_backend || t.storage_backend === storage_backend)
        .sort(defaultTenantSort);
      return {
        items: all.slice(offset, offset + limit).map(clone),
        pagination: { limit, offset, total: all.length }
      };
    },

    async getTenant(tenantId) {
      return clone(tenants.get(tenantId));
    },

    async findTenantByWorkspaceHash(workspaceHash) {
      for (const t of tenants.values()) {
        if (t.workspace_init_id) {
          const ws = workspaces.get(t.workspace_init_id);
          if (ws && ws.workspace_hash === workspaceHash) return clone(t);
        }
      }
      return undefined;
    },

    async createWorkspace(input) {
      const row = normalizeWorkspaceRow({
        ...input,
        created_at: now(),
        updated_at: now()
      });
      if (workspaces.has(row.id)) {
        const error = new Error("Workspace id already exists.");
        error.code = "tenant_conflict";
        throw error;
      }
      if ([...workspaces.values()].some((w) => w.workspace_hash === row.workspace_hash)) {
        const error = new Error("Workspace hash already exists.");
        error.code = "tenant_conflict";
        throw error;
      }
      workspaces.set(row.id, row);
      return clone(row);
    },

    async getWorkspace(id) {
      return clone(findWorkspace(id));
    },

    async findWorkspaceByHash(workspaceHash) {
      return clone(findWorkspace(workspaceHash));
    },

    async findDescendantWorkspaces(workspaceId, { maxDepth = 3 } = {}) {
      return descendantClosure(workspaceId, maxDepth).map(clone);
    },

    async findAncestorWorkspaces(workspaceId) {
      return ancestorChain(workspaceId).map(clone);
    },

    async createTenantAccess(input) {
      const tenant = tenants.get(input.tenant_id);
      if (!tenant) {
        const error = new Error("Tenant not found.");
        error.code = "tenant_conflict";
        throw error;
      }
      assertNoDualPostgres(tenants, workspaces, tenantAccess, {
        workspace_id: input.workspace_id,
        tenant_id: input.tenant_id,
        access: input.access
      });

      const row = {
        workspace_id: input.workspace_id,
        tenant_id: input.tenant_id,
        access: input.access,
        inherited: Boolean(input.inherited),
        created_at: now()
      };
      tenantAccess.set(`${row.workspace_id}::${row.tenant_id}`, row);
      indexAccess(row);
      return clone(row);
    },

    async deleteTenantAccess(workspaceId, tenantId) {
      const key = `${workspaceId}::${tenantId}`;
      const existed = tenantAccess.delete(key);
      if (existed) {
        const wsList = accessByWorkspace.get(workspaceId) || [];
        accessByWorkspace.set(workspaceId, wsList.filter((r) => !(r.workspace_id === workspaceId && r.tenant_id === tenantId)));
        const tList = accessByTenant.get(tenantId) || [];
        accessByTenant.set(tenantId, tList.filter((r) => !(r.workspace_id === workspaceId && r.tenant_id === tenantId)));
      }
      return existed;
    },

    async listTenantAccessForWorkspace(workspaceId, { includeInherited = false } = {}) {
      const owned = (accessByWorkspace.get(workspaceId) || []).filter(Boolean).slice();
      if (!includeInherited) return owned.map(clone);
      const inherited = [];
      const ancestors = ancestorChain(workspaceId);
      for (const a of ancestors) {
        for (const ta of accessByWorkspace.get(a.id) || []) {
          if (ta.inherited) inherited.push({ ...ta });
        }
      }
      return [...owned, ...inherited].map(clone);
    },

    async listTenantAccessForTenant(tenantId) {
      return (accessByTenant.get(tenantId) || []).map(clone);
    }
  };
}

export function sha256OfPath(absolutePath) {
  return createHash("sha256").update(String(absolutePath)).digest("hex");
}
