// Minimal stub adapter for the Postgres-backed TenantStore. Mirrors the
// in-memory store's contract so production deployments can swap one for
// the other. The actual SQL is left as TODO until the operator has access
// to a Postgres instance; the canonical SQL lives in
// migrations/000_alfred_registry.sql.

export function createPostgresTenantStore(client) {
  if (!client || typeof client.query !== "function") {
    throw new TypeError("createPostgresTenantStore requires a pg-style client.");
  }
  const notImpl = (op) => () => {
    const e = new Error(`postgres tenant store: ${op} not implemented`);
    e.code = "not_implemented";
    throw e;
  };
  return {
    createTenant: notImpl("createTenant"),
    archiveTenant: notImpl("archiveTenant"),
    deleteTenant: notImpl("deleteTenant"),
    listTenants: notImpl("listTenants"),
    getTenant: notImpl("getTenant"),
    findTenantByWorkspaceHash: notImpl("findTenantByWorkspaceHash"),
    createWorkspace: notImpl("createWorkspace"),
    getWorkspace: notImpl("getWorkspace"),
    findWorkspaceByHash: notImpl("findWorkspaceByHash"),
    findDescendantWorkspaces: notImpl("findDescendantWorkspaces"),
    findAncestorWorkspaces: notImpl("findAncestorWorkspaces"),
    createTenantAccess: notImpl("createTenantAccess"),
    deleteTenantAccess: notImpl("deleteTenantAccess"),
    listTenantAccessForWorkspace: notImpl("listTenantAccessForWorkspace"),
    listTenantAccessForTenant: notImpl("listTenantAccessForTenant")
  };
}
