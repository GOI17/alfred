import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTenantService,
  createInMemoryTenantStore,
  sha256OfPath
} from "../src/index.js";

function makeService(initial = {}, opts = {}) {
  const traces = [];
  const service = createTenantService({
    store: createInMemoryTenantStore({ ...initial, skipInitialPolicyCheck: opts.skipInitialPolicyCheck === true }),
    trace: (event) => traces.push(event),
    idGenerator: () => `usr_t_${Math.random().toString(36).slice(2, 10)}`
  });
  return { service, traces };
}

function validTenantInput(overrides = {}) {
  return {
    kind: "coding_agent_only",
    storage_backend: "sqlite",
    db_path: "/tmp/test.sqlite",
    display_name: "Test",
    ...overrides
  };
}

async function makeWorkspace(service, path) {
  return service.registerWorkspace({
    workspace_hash: sha256OfPath(path),
    workspace_path: path
  });
}

function matchesDetail(regex) {
  return (err) => {
    if (!err || !Array.isArray(err.details)) return false;
    return err.details.some((d) => regex.test(d.message));
  };
}

// --------------------------------------------------------------------------
// Provisioning
// --------------------------------------------------------------------------

test("provisionTenant accepts a coding_agent_only sqlite tenant", async () => {
  const { service } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  assert.equal(tenant.kind, "coding_agent_only");
  assert.equal(tenant.storage_backend, "sqlite");
  assert.equal(tenant.db_path, "/tmp/test.sqlite");
  assert.equal(tenant.db_connection, null);
  assert.ok(tenant.id.startsWith("usr_t_"));
});

test("provisionTenant accepts a human_agent postgres tenant", async () => {
  const { service } = makeService();
  const tenant = await service.provisionTenant(
    validTenantInput({
      kind: "human_agent",
      storage_backend: "postgres",
      db_path: undefined,
      db_connection: "postgres://u:p@h/db"
    })
  );
  assert.equal(tenant.kind, "human_agent");
  assert.equal(tenant.storage_backend, "postgres");
  assert.equal(tenant.db_connection, "postgres://u:p@h/db");
});

test("provisionTenant rejects human_agent + sqlite (Rule 1)", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionTenant(validTenantInput({ kind: "human_agent" })),
    matchesDetail(/Rule 1/)
  );
});

test("provisionTenant rejects hybrid_with_human + sqlite", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionTenant(validTenantInput({ kind: "hybrid_with_human" })),
    matchesDetail(/Rule 1/)
  );
});

test("provisionTenant rejects server_managed + sqlite (Rule 3)", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionTenant(validTenantInput({ kind: "server_managed" })),
    matchesDetail(/Rule 3/)
  );
});

test("provisionTenant rejects missing db_path when storage_backend=sqlite", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionTenant(validTenantInput({ db_path: undefined })),
    matchesDetail(/db_path is required/)
  );
});

test("provisionTenant rejects mismatched db_connection when storage_backend=sqlite", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.provisionTenant(
        validTenantInput({ db_connection: "postgres://u:p@h/db" })
      ),
    matchesDetail(/db_connection must be null/)
  );
});

test("provisionTenant rejects mismatched db_path when storage_backend=postgres", async () => {
  const { service } = makeService();
  await assert.rejects(
    () =>
      service.provisionTenant({
        kind: "human_agent",
        storage_backend: "postgres",
        db_connection: "postgres://u:p@h/db",
        db_path: "/tmp/cannot-have.sqlite"
      }),
    matchesDetail(/db_path must be null/)
  );
});

test("provisionTenant emits a trace event", async () => {
  const { service, traces } = makeService();
  await service.provisionTenant(validTenantInput());
  const event = traces.find((t) => t.event === "tenant.provision");
  assert.ok(event, "expected tenant.provision event");
  assert.ok(event.tenant_id.startsWith("usr_t_"));
});

test("provisionTenant rejects empty kind", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionTenant({ kind: "", storage_backend: "sqlite", db_path: "/tmp/x.sqlite" }),
    matchesDetail(/^kind/)
  );
});

test("provisionTenant rejects unknown kind", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.provisionTenant({ kind: "made_up_kind", storage_backend: "sqlite", db_path: "/tmp/x.sqlite" }),
    matchesDetail(/kind must be one of/)
  );
});

// --------------------------------------------------------------------------
// Archive
// --------------------------------------------------------------------------

test("archiveTenant moves kind to archived and stamps archived_at", async () => {
  const { service, traces } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  const archived = await service.archiveTenant(tenant.id, { reason: "client offboarded" });
  assert.equal(archived.kind, "archived");
  assert.ok(archived.archived_at);
  assert.ok(traces.find((t) => t.event === "tenant.archive"));
});

test("archiveTenant throws TenantNotFoundError on missing id", async () => {
  const { service } = makeService();
  await assert.rejects(
    () => service.archiveTenant("usr_t_missing"),
    (err) => err.name === "TenantNotFoundError"
  );
});

// --------------------------------------------------------------------------
// Delete with reader safety (Invariant W5)
// --------------------------------------------------------------------------

test("deleteTenant succeeds when no readers exist", async () => {
  const { service } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  const deleted = await service.deleteTenant(tenant.id);
  assert.equal(deleted, true);
  await assert.rejects(() => service.getTenant(tenant.id), (err) => err.name === "TenantNotFoundError");
});

test("deleteTenant blocks when a non-inherited reader exists (W5)", async () => {
  const { service } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  const ws = await makeWorkspace(service, "/a");
  await service.grantAccess({ workspace_id: ws.id, tenant_id: tenant.id, access: "owner" });
  await service.grantAccess({ workspace_id: "w_other", tenant_id: tenant.id, access: "reader", inherited: false });

  await assert.rejects(
    () => service.deleteTenant(tenant.id),
    (err) => {
      assert.equal(err.code, "tenant_conflict");
      assert.match(err.message, /non-inherited readers/i);
      return true;
    }
  );
});

test("deleteTenant succeeds with only inherited readers", async () => {
  const { service } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  const ws = await makeWorkspace(service, "/a");
  await service.grantAccess({ workspace_id: ws.id, tenant_id: tenant.id, access: "owner" });
  await service.grantAccess({ workspace_id: "w_inh", tenant_id: tenant.id, access: "reader", inherited: true });
  const deleted = await service.deleteTenant(tenant.id);
  assert.equal(deleted, true);
});

test("deleteTenant cascades tenant_access rows", async () => {
  const { service } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  const ws = await makeWorkspace(service, "/a");
  await service.grantAccess({ workspace_id: ws.id, tenant_id: tenant.id, access: "owner" });
  await service.deleteTenant(tenant.id);
  const remaining = await service.listAccessForWorkspace(ws.id);
  assert.equal(remaining.length, 0);
});

// --------------------------------------------------------------------------
// Workspaces
// --------------------------------------------------------------------------

test("registerWorkspace enforces UNIQUE workspace_hash", async () => {
  const { service } = makeService();
  const a = await makeWorkspace(service, "/a");
  assert.ok(a.id);
  await assert.rejects(
    () => service.registerWorkspace({ workspace_hash: sha256OfPath("/a"), workspace_path: "/a-copy" }),
    (err) => err.code === "tenant_conflict"
  );
});

test("listDescendantWorkspaces traverses via parent_workspace_id", async () => {
  const { service } = makeService();
  const w1 = await makeWorkspace(service, "/root");
  const w2 = await service.registerWorkspace({
    workspace_hash: sha256OfPath("/root/a"),
    workspace_path: "/root/a",
    parent_workspace_id: w1.id
  });
  const w3 = await service.registerWorkspace({
    workspace_hash: sha256OfPath("/root/a/b"),
    workspace_path: "/root/a/b",
    parent_workspace_id: w2.id
  });
  const descendants = await service.listDescendantWorkspaces(w1.id, { maxDepth: 3 });
  const ids = descendants.map((d) => d.id).sort();
  assert.deepEqual(ids, [w2.id, w3.id].sort());
});

test("listAncestorWorkspaces traverses up via parent_workspace_id", async () => {
  const { service } = makeService();
  const w1 = await makeWorkspace(service, "/root");
  const w2 = await service.registerWorkspace({
    workspace_hash: sha256OfPath("/root/a"),
    workspace_path: "/root/a",
    parent_workspace_id: w1.id
  });
  const w3 = await service.registerWorkspace({
    workspace_hash: sha256OfPath("/root/a/b"),
    workspace_path: "/root/a/b",
    parent_workspace_id: w2.id
  });
  const ancestors = await service.listAncestorWorkspaces(w3.id);
  const ids = ancestors.map((d) => d.id);
  assert.deepEqual(ids, [w2.id, w1.id]);
});

// --------------------------------------------------------------------------
// tenant_access (Invariant W6)
// --------------------------------------------------------------------------

test("grantAccess accepts owner access on a coding_agent_only sqlite tenant", async () => {
  const { service } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  const ws = await makeWorkspace(service, "/a");
  const row = await service.grantAccess({ workspace_id: ws.id, tenant_id: tenant.id, access: "owner" });
  assert.equal(row.access, "owner");
  assert.equal(row.inherited, false);
});

test("grantAccess rejects dual distinct Postgres tenants in workspace chain (W6)", async () => {
  const { service } = makeService();
  const a = await service.provisionTenant(
    validTenantInput({ kind: "coding_agent_only", storage_backend: "postgres", db_path: undefined, db_connection: "pg://a" })
  );
  const b = await service.provisionTenant(
    validTenantInput({ kind: "coding_agent_only", storage_backend: "postgres", db_path: undefined, db_connection: "pg://b" })
  );

  const root = await makeWorkspace(service, "/root");
  const child = await service.registerWorkspace({
    workspace_hash: sha256OfPath("/root/c"),
    workspace_path: "/root/c",
    parent_workspace_id: root.id
  });

  await service.grantAccess({ workspace_id: root.id, tenant_id: a.id, access: "owner" });
  await service.grantAccess({ workspace_id: root.id, tenant_id: b.id, access: "reader", inherited: false });

  await assert.rejects(
    () => service.grantAccess({ workspace_id: child.id, tenant_id: b.id, access: "owner" }),
    (err) => /two distinct Postgres tenants/i.test(err.message) || /two distinct Postgres tenants/i.test(JSON.stringify(err.details || []))
  );
});

test("grantAccess allows the same Postgres tenant_id at multiple workspaces", async () => {
  const { service } = makeService();
  const a = await service.provisionTenant(
    validTenantInput({ kind: "coding_agent_only", storage_backend: "postgres", db_path: undefined, db_connection: "pg://a" })
  );
  const root = await makeWorkspace(service, "/root");
  const child = await service.registerWorkspace({
    workspace_hash: sha256OfPath("/root/c"),
    workspace_path: "/root/c",
    parent_workspace_id: root.id
  });
  await service.grantAccess({ workspace_id: root.id, tenant_id: a.id, access: "owner" });
  await service.grantAccess({ workspace_id: child.id, tenant_id: a.id, access: "reader", inherited: true });
  const rows = await service.listAccessForTenant(a.id);
  assert.equal(rows.length, 2);
});

test("grantAccess allows Postgres tenants in non-hierarchical workspaces", async () => {
  const { service } = makeService();
  const a = await service.provisionTenant(
    validTenantInput({ kind: "coding_agent_only", storage_backend: "postgres", db_path: undefined, db_connection: "pg://a" })
  );
  const b = await service.provisionTenant(
    validTenantInput({ kind: "coding_agent_only", storage_backend: "postgres", db_path: undefined, db_connection: "pg://b" })
  );
  const x = await makeWorkspace(service, "/x");
  const y = await makeWorkspace(service, "/y");
  await service.grantAccess({ workspace_id: x.id, tenant_id: a.id, access: "owner" });
  await service.grantAccess({ workspace_id: y.id, tenant_id: b.id, access: "owner" });
  const aAccess = await service.listAccessForTenant(a.id);
  const bAccess = await service.listAccessForTenant(b.id);
  assert.equal(aAccess.length, 1);
  assert.equal(bAccess.length, 1);
});

test("revokeAccess removes a row and emits a trace event", async () => {
  const { service, traces } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  const ws = await makeWorkspace(service, "/a");
  await service.grantAccess({ workspace_id: ws.id, tenant_id: tenant.id, access: "owner" });
  const result = await service.revokeAccess(ws.id, tenant.id);
  assert.equal(result.deleted, true);
  assert.ok(traces.find((t) => t.event === "tenant_access.revoke"));
});

test("listAccessForWorkspace with includeInherited=true walks ancestors", async () => {
  const { service } = makeService();
  const tenant = await service.provisionTenant(validTenantInput());
  const root = await makeWorkspace(service, "/root");
  const child = await service.registerWorkspace({
    workspace_hash: sha256OfPath("/root/c"),
    workspace_path: "/root/c",
    parent_workspace_id: root.id
  });
  await service.grantAccess({ workspace_id: root.id, tenant_id: tenant.id, access: "owner", inherited: true });

  const onlyOwn = await service.listAccessForWorkspace(child.id);
  assert.equal(onlyOwn.length, 0);
  const withInherited = await service.listAccessForWorkspace(child.id, { includeInherited: true });
  assert.equal(withInherited.length, 1);
  assert.equal(withInherited[0].access, "owner");
  assert.equal(withInherited[0].inherited, true);
});

// --------------------------------------------------------------------------
// Validate policy
// --------------------------------------------------------------------------

test("validatePolicy passes when no violations exist", async () => {
  const { service } = makeService({
    initialTenants: [
      {
        id: "usr_t_a",
        kind: "coding_agent_only",
        storage_backend: "sqlite",
        db_path: "/tmp/a.sqlite",
        db_connection: null
      }
    ]
  });
  const report = await service.validatePolicy();
  assert.equal(report.ok, true);
  assert.equal(report.violations.length, 0);
});

test("validatePolicy flags human_agent + sqlite", async () => {
  const { service } = makeService(
    {
      initialTenants: [
        {
          id: "usr_t_x",
          kind: "human_agent",
          storage_backend: "sqlite",
          db_path: "/tmp/x.sqlite",
          db_connection: null
        }
      ]
    },
    { skipInitialPolicyCheck: true }
  );
  const report = await service.validatePolicy();
  assert.equal(report.ok, false);
  const v = report.violations[0];
  assert.equal(v.tenant_id, "usr_t_x");
  assert.match(v.rule, /Rule 1/);
});
