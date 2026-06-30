// alfred init: prepare a workspace for memory storage.
//
//   1. Scan for existing workspaces in ancestor / descendant trees.
//   2. If conflict detected, prompt the user with (a)/(b)/(c).
//   3. Provision a tenant + workspace.
//   4. Generate an API key and return it ONCE.
//   5. Write a local `.alfred/config.json` for the IDE agent to pick up.
//
// Pure function: returns a structured `outcome` describing what was done;
// CLI binds stdin/stdout to prompts and writes config.

import { createHash, randomBytes } from "node:crypto";

export function sha256OfPath(absolutePath) {
  return createHash("sha256").update(String(absolutePath)).digest("hex");
}

const STORAGE_BY_KIND = {
  human_agent: "postgres",
  hybrid_with_human: "postgres",
  server_managed: "postgres",
  coding_agent_only: ["sqlite", "postgres"]
};

export function defaultStorageBackendFor(kind) {
  return STORAGE_BY_KIND[kind];
}

export class InitConflictError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "InitConflictError";
    this.code = "init_conflict";
    this.details = details;
  }
}

export function normalizeInitInput(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return { valid: false, errors: [{ field: "body", message: "body required." }] };
  }
  const cwd = input.cwd;
  if (typeof cwd !== "string" || cwd.trim() === "") errors.push({ field: "cwd", message: "cwd is required." });
  const display_name = typeof input.display_name === "string" ? input.display_name.trim() : "";
  if (!display_name) errors.push({ field: "display_name", message: "display_name is required." });
  const kind = typeof input.kind === "string" ? input.kind : "coding_agent_only";
  if (!["human_agent", "coding_agent_only", "hybrid_with_human", "server_managed"].includes(kind)) {
    errors.push({ field: "kind", message: "unknown kind." });
  }
  const storage_backend = input.storage_backend ?? defaultStorageBackendFor(kind);
  if (!["sqlite", "postgres"].includes(storage_backend)) {
    errors.push({ field: "storage_backend", message: "must be sqlite or postgres." });
  }
  if (kind !== "coding_agent_only" && storage_backend !== "postgres") {
    errors.push({ field: "storage_backend", message: `${kind} requires postgres.` });
  }
  const description = typeof input.description === "string" ? input.description : "";
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    value: {
      cwd: cwd.trim(),
      display_name,
      kind,
      storage_backend,
      description
    }
  };
}

export function findConflictingWorkspaces(tenants, workspaces, cwdHash, ancestorHashes, descendantHashes) {
  const conflicts = { ancestors: [], descendants: [] };
  for (const ws of workspaces) {
    if (ancestorHashes.includes(ws.workspace_hash)) conflicts.ancestors.push(ws);
    if (descendantHashes.includes(ws.workspace_hash)) conflicts.descendants.push(ws);
  }
  // Pull each conflict's tenant by workspace_id via join in caller.
  return conflicts;
}

/**
 * Pick the (a/b/c) resolution based on the kind of conflicts found.
 * Pure function: caller is responsible for executing the resolution.
 */
export function planInitResolution({ hasAncestorConflict, hasDescendantConflict, choice }) {
  if (!hasAncestorConflict && !hasDescendantConflict) {
    return { action: "create", orphan: false };
  }
  if (choice === "cancel") return { action: "cancel" };
  if (choice === "promote") {
    return { action: "promote", archiveDescendants: true };
  }
  if (choice === "coexist") {
    return { action: "coexist", inheritDescendants: true };
  }
  return { action: "ask" };
}

export function initOutcome({ input, tenant, workspace, apiKey, conflicts, orphan } = {}) {
  return {
    workspace_id: workspace?.id ?? null,
    workspace_path: workspace?.workspace_path ?? null,
    workspace_hash: workspace?.workspace_hash ?? null,
    tenant_id: tenant?.id ?? null,
    display_name: tenant?.display_name ?? null,
    kind: tenant?.kind ?? null,
    storage_backend: tenant?.storage_backend ?? null,
    db_path: tenant?.db_path ?? null,
    db_connection: tenant?.db_connection ?? null,
    api_key: apiKey ?? null,
    conflicts: conflicts ?? null,
    orphan: Boolean(orphan)
  };
}

// Convenience: write a workspace config to .alfred/config.json
export function buildWorkspaceConfig({ tenant, apiKey, registryPath }) {
  return {
    registry: registryPath,
    tenant: {
      id: tenant.id,
      kind: tenant.kind,
      storage_backend: tenant.storage_backend,
      db_path: tenant.db_path,
      db_connection: tenant.db_connection
    },
    api_key: apiKey,
    created_at: new Date().toISOString()
  };
}
