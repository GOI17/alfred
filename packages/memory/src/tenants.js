// TenantService: domain layer for tenants, workspaces, and tenant_access.
//
// Scope:
//   * Validates inputs (hosting-policy checks are mirrored here so a buggy
//     caller cannot bypass the SQL CHECKs by going through this API).
//   * Mutates rows through the TenantStore, which encapsulates SQLite and
//     Postgres diffs.
//   * Records trace events for every state-changing operation.
//
// Not in scope:
//   * SQL TRIGGER definitions (live in migrations/000_alfred_registry.sql).
//   * HTTP transport (lives in ../memory-server/).
//   * Backend-specific file/db creation (lives in tenant-router.js).

import { randomUUID } from "node:crypto";

export const TENANT_KINDS = Object.freeze([
  "human_agent",
  "coding_agent_only",
  "hybrid_with_human",
  "server_managed",
  "archived"
]);

export const STORAGE_BACKENDS = Object.freeze(["sqlite", "postgres"]);

export const ACCESS_KINDS = Object.freeze(["owner", "reader", "none"]);

const ID_PREFIX = "usr_t_";
const WORKSPACE_ID_PREFIX = "usr_ws_";

function generateTenantId() {
  return `${ID_PREFIX}${randomUUID().replace(/-/g, "")}`;
}

function generateWorkspaceId() {
  return `${WORKSPACE_ID_PREFIX}${randomUUID().replace(/-/g, "")}`;
}

export class TenantValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "TenantValidationError";
    this.code = "validation_error";
    this.status = 400;
    this.details = details;
  }
}

export class TenantNotFoundError extends Error {
  constructor(message = "Tenant was not found.") {
    super(message);
    this.name = "TenantNotFoundError";
    this.code = "not_found";
    this.status = 404;
  }
}

export class TenantConflictError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "TenantConflictError";
    this.code = "tenant_conflict";
    this.status = 409;
    this.details = details;
  }
}

export class TenantPolicyError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "TenantPolicyError";
    this.code = "policy_violation";
    this.status = 422;
    this.details = details;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value, field, details, { allowUndefined = false } = {}) {
  if (value === undefined || value === null) {
    if (!allowUndefined) details.push({ field, message: `${field} is required.` });
    return undefined;
  }
  if (typeof value !== "string" || value.trim() === "") {
    details.push({ field, message: `${field} must be a non-empty string.` });
    return undefined;
  }
  return value.trim();
}

function optionalString(value, field, details) {
  if (value === undefined || value === null) return undefined;
  return requireString(value, field, details);
}

function requireEnum(value, field, allowed, details) {
  if (!Array.isArray(allowed) || allowed.length === 0) {
    throw new TypeError("requireEnum requires a non-empty allowed list.");
  }
  if (value === undefined || value === null || value === "") {
    details.push({ field, message: `${field} is required.` });
    return undefined;
  }
  if (typeof value !== "string" || !allowed.includes(value)) {
    details.push({ field, message: `${field} must be one of: ${allowed.join(", ")}.` });
    return undefined;
  }
  return value;
}

function enforceStoragePolicy(kind, storage_backend, details) {
  if ((kind === "human_agent" || kind === "hybrid_with_human") && storage_backend !== "postgres") {
    details.push({
      field: "storage_backend",
      message: `Tenants of kind '${kind}' MUST use Postgres (hosting-policy Rule 1).`
    });
  }
  if (kind === "server_managed" && storage_backend !== "postgres") {
    details.push({
      field: "storage_backend",
      message: `Tenants of kind 'server_managed' MUST use Postgres (hosting-policy Rule 3).`
    });
  }
}

function enforcePathConsistency(storage_backend, db_path, db_connection, details) {
  if (storage_backend === "sqlite" && (db_path === undefined || db_path === null || db_path === "")) {
    details.push({ field: "db_path", message: `db_path is required when storage_backend = 'sqlite'.` });
  }
  if (storage_backend === "sqlite" && db_connection) {
    details.push({ field: "db_connection", message: `db_connection must be null when storage_backend = 'sqlite'.` });
  }
  if (storage_backend === "postgres" && (db_connection === undefined || db_connection === null || db_connection === "")) {
    details.push({ field: "db_connection", message: `db_connection is required when storage_backend = 'postgres'.` });
  }
  if (storage_backend === "postgres" && db_path) {
    details.push({ field: "db_path", message: `db_path must be null when storage_backend = 'postgres'.` });
  }
}

function normalizeMetadata(value, details) {
  if (value === undefined) return {};
  if (value === null) return {};
  if (!isPlainObject(value)) {
    details.push({ field: "metadata", message: "metadata must be a JSON object." });
    return undefined;
  }
  return value;
}

export function normalizeProvisionTenantInput(input) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) {
    details.push({ field: "body", message: "Request body must be a JSON object." });
    return { valid: false, details };
  }
  // Default id FIRST, then validate the rest. This way callers may omit id.
  const id = (typeof body.id === "string" && body.id.trim() !== "")
    ? body.id.trim()
    : generateTenantId();
  const kind = requireEnum(body.kind, "kind", TENANT_KINDS, details);
  const storage_backend = requireEnum(body.storage_backend, "storage_backend", STORAGE_BACKENDS, details);
  const display_name = body.display_name === undefined ? null : optionalString(body.display_name, "display_name", details);
  const workspace_init_id = body.workspace_init_id === undefined ? null : optionalString(body.workspace_init_id, "workspace_init_id", details);
  const db_path = body.db_path === undefined ? null : optionalString(body.db_path, "db_path", details);
  const db_connection = body.db_connection === undefined ? null : optionalString(body.db_connection, "db_connection", details);
  const metadata = normalizeMetadata(body.metadata, details) ?? {};

  // Hosting-policy checks. These accumulate ALL violations so the user sees
  // every problem at once instead of fixing-then-re-submitting.
  if (kind && storage_backend) {
    enforceStoragePolicy(kind, storage_backend, details);
    enforcePathConsistency(storage_backend, db_path, db_connection, details);
  } else if (storage_backend) {
    // Even without kind, db_path/db_connection consistency still applies.
    enforcePathConsistency(storage_backend, db_path, db_connection, details);
  }

  if (details.length > 0) return { valid: false, details };

  return {
    valid: true,
    value: {
      id,
      kind,
      storage_backend,
      display_name,
      workspace_init_id,
      db_path,
      db_connection,
      metadata
    }
  };
}

export function normalizeArchiveInput(input) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) {
    details.push({ field: "body", message: "Request body must be a JSON object." });
    return { valid: false, details };
  }
  const reason = body.reason === undefined ? null : optionalString(body.reason, "reason", details);
  if (details.length > 0) return { valid: false, details };
  return { valid: true, value: { reason } };
}

export function normalizeWorkspaceInput(input) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) {
    details.push({ field: "body", message: "Request body must be a JSON object." });
    return { valid: false, details };
  }
  const id = (typeof body.id === "string" && body.id.trim() !== "")
    ? body.id.trim()
    : generateWorkspaceId();
  const workspace_hash = requireString(body.workspace_hash, "workspace_hash", details);
  const workspace_path = requireString(body.workspace_path, "workspace_path", details);
  const parent_workspace_id = body.parent_workspace_id === undefined
    ? null
    : optionalString(body.parent_workspace_id, "parent_workspace_id", details);
  const metadata = normalizeMetadata(body.metadata, details) ?? {};

  if (workspace_hash && !/^[a-f0-9]{64}$/.test(workspace_hash)) {
    details.push({ field: "workspace_hash", message: "workspace_hash must be a sha256 hex string." });
  }

  if (details.length > 0) return { valid: false, details };

  return {
    valid: true,
    value: {
      id,
      workspace_hash,
      workspace_path,
      parent_workspace_id,
      metadata
    }
  };
}

export function normalizeTenantAccessInput(input) {
  const details = [];
  const body = isPlainObject(input) ? input : {};
  if (!isPlainObject(input)) {
    details.push({ field: "body", message: "Request body must be a JSON object." });
    return { valid: false, details };
  }
  const workspace_id = requireString(body.workspace_id, "workspace_id", details);
  const tenant_id = requireString(body.tenant_id, "tenant_id", details);
  const access = requireEnum(body.access, "access", ACCESS_KINDS, details);
  const inherited = body.inherited === undefined ? false : Boolean(body.inherited);

  if (details.length > 0) return { valid: false, details };

  return {
    valid: true,
    value: {
      workspace_id,
      tenant_id,
      access,
      inherited
    }
  };
}

function throwIfInvalid(details, ErrorClass = TenantValidationError) {
  if (details.length > 0) throw new ErrorClass("Tenant input is invalid.", details);
}

export function createTenantService({
  store,
  trace = () => {},
  now = () => new Date(),
  idGenerator = generateTenantId
} = {}) {
  if (!store) throw new TypeError("createTenantService requires a store.");

  return {
    async provisionTenant(input, { traceContext } = {}) {
      const result = normalizeProvisionTenantInput(input);
      if (!result.valid) throwIfInvalid(result.details);
      const tenant = await store.createTenant(result.value);
      trace({
        event: "tenant.provision",
        tenant_id: tenant.id,
        kind: tenant.kind,
        storage_backend: tenant.storage_backend,
        ctx: traceContext
      });
      return tenant;
    },

    async archiveTenant(tenantId, { reason, traceContext } = {}) {
      const details = [];
      requireString(tenantId, "tenantId", details);
      throwIfInvalid(details);
      const result = normalizeArchiveInput({ reason });
      if (!result.valid) throwIfInvalid(result.details);
      const tenant = await store.archiveTenant(tenantId, { reason: result.value.reason, archived_at: now().toISOString() });
      if (!tenant) throw new TenantNotFoundError();
      trace({
        event: "tenant.archive",
        tenant_id: tenant.id,
        reason: result.value.reason,
        ctx: traceContext
      });
      return tenant;
    },

    async deleteTenant(tenantId, { force = false, traceContext } = {}) {
      const details = [];
      requireString(tenantId, "tenantId", details);
      throwIfInvalid(details);
      try {
        const deleted = await store.deleteTenant(tenantId);
        trace({ event: "tenant.delete", tenant_id: tenantId, forced: force, ctx: traceContext });
        return deleted;
      } catch (error) {
        trace({
          event: "tenant.delete.blocked",
          tenant_id: tenantId,
          message: error.message,
          ctx: traceContext
        });
        throw error;
      }
    },

    async listTenants({ kind, storage_backend, limit = 50, offset = 0 } = {}) {
      return store.listTenants({
        kind,
        storage_backend,
        limit: Math.max(1, Math.min(100, Number(limit) || 50)),
        offset: Math.max(0, Number(offset) || 0)
      });
    },

    async getTenant(tenantId) {
      const details = [];
      requireString(tenantId, "tenantId", details);
      throwIfInvalid(details);
      const tenant = await store.getTenant(tenantId);
      if (!tenant) throw new TenantNotFoundError();
      return tenant;
    },

    async findTenantByWorkspaceHash(workspaceHash) {
      const details = [];
      requireString(workspaceHash, "workspaceHash", details);
      throwIfInvalid(details);
      return store.findTenantByWorkspaceHash(workspaceHash);
    },

    // ---- workspaces ----

    async registerWorkspace(input, { traceContext } = {}) {
      const result = normalizeWorkspaceInput(input);
      if (!result.valid) throwIfInvalid(result.details);
      const ws = await store.createWorkspace({
        ...result.value
      });
      trace({ event: "workspace.register", workspace_id: ws.id, ctx: traceContext });
      return ws;
    },

    async getWorkspace(id) {
      const details = [];
      requireString(id, "id", details);
      throwIfInvalid(details);
      const ws = await store.getWorkspace(id);
      if (!ws) throw new TenantNotFoundError();
      return ws;
    },

    async findWorkspaceByHash(workspaceHash) {
      const details = [];
      requireString(workspaceHash, "workspaceHash", details);
      throwIfInvalid(details);
      return store.findWorkspaceByHash(workspaceHash);
    },

    async listDescendantWorkspaces(workspaceId, { maxDepth = 3 } = {}) {
      const details = [];
      requireString(workspaceId, "workspaceId", details);
      throwIfInvalid(details);
      return store.findDescendantWorkspaces(workspaceId, { maxDepth });
    },

    async listAncestorWorkspaces(workspaceId) {
      const details = [];
      requireString(workspaceId, "workspaceId", details);
      throwIfInvalid(details);
      return store.findAncestorWorkspaces(workspaceId);
    },

    async adoptWorkspace(input, { traceContext } = {}) {
      const result = normalizeWorkspaceInput(input);
      if (!result.valid) throwIfInvalid(result.details);
      const ws = await store.createWorkspace({
        ...result.value,
        metadata: { ...(result.value.metadata || {}), adopted: true }
      });
      trace({
        event: "workspace.adopt",
        workspace_id: ws.id,
        workspace_path: ws.workspace_path,
        ctx: traceContext
      });
      return ws;
    },

    // ---- tenant_access ----

    async grantAccess(input, { traceContext } = {}) {
      const result = normalizeTenantAccessInput(input);
      if (!result.valid) throwIfInvalid(result.details);
      try {
        const row = await store.createTenantAccess(result.value);
        trace({
          event: "tenant_access.grant",
          workspace_id: row.workspace_id,
          tenant_id: row.tenant_id,
          access: row.access,
          inherited: row.inherited,
          ctx: traceContext
        });
        return row;
      } catch (error) {
        trace({
          event: "tenant_access.grant.blocked",
          workspace_id: result.value.workspace_id,
          tenant_id: result.value.tenant_id,
          message: error.message,
          ctx: traceContext
        });
        throw error;
      }
    },

    async revokeAccess(workspaceId, tenantId, { traceContext } = {}) {
      const details = [];
      requireString(workspaceId, "workspaceId", details);
      requireString(tenantId, "tenantId", details);
      throwIfInvalid(details);
      const deleted = await store.deleteTenantAccess(workspaceId, tenantId);
      trace({
        event: "tenant_access.revoke",
        workspace_id: workspaceId,
        tenant_id: tenantId,
        deleted,
        ctx: traceContext
      });
      return { deleted };
    },

    async listAccessForWorkspace(workspaceId, { includeInherited = false } = {}) {
      const details = [];
      requireString(workspaceId, "workspaceId", details);
      throwIfInvalid(details);
      return store.listTenantAccessForWorkspace(workspaceId, { includeInherited });
    },

    async listAccessForTenant(tenantId) {
      const details = [];
      requireString(tenantId, "tenantId", details);
      throwIfInvalid(details);
      return store.listTenantAccessForTenant(tenantId);
    },

    async validatePolicy() {
      const tenants = await store.listTenants({ limit: 100, offset: 0 });
      const list = tenants.items ?? tenants;
      const violations = [];
      for (const t of list) {
        if ((t.kind === "human_agent" || t.kind === "hybrid_with_human") && t.storage_backend !== "postgres") {
          violations.push({
            tenant_id: t.id,
            rule: "hosting-policy Rule 1",
            detail: `kind=${t.kind} requires storage_backend=postgres, got ${t.storage_backend}`
          });
        }
        if (t.kind === "server_managed" && t.storage_backend !== "postgres") {
          violations.push({
            tenant_id: t.id,
            rule: "hosting-policy Rule 3",
            detail: `kind=server_managed requires storage_backend=postgres, got ${t.storage_backend}`
          });
        }
        if (t.kind !== "archived" && t.storage_backend === "sqlite" && !t.db_path) {
          violations.push({
            tenant_id: t.id,
            rule: "hosting-policy Rule 5",
            detail: `storage_backend=sqlite requires db_path`
          });
        }
        if (t.kind !== "archived" && t.storage_backend === "postgres" && !t.db_connection) {
          violations.push({
            tenant_id: t.id,
            rule: "hosting-policy Rule 5",
            detail: `storage_backend=postgres requires db_connection`
          });
        }
      }
      return { ok: violations.length === 0, violations };
    }
  };
}
