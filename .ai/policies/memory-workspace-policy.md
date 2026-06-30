---
id: memory-workspace-policy
description: >
  Rules governing the relationship between filesystem workspaces
  and Alfred Memory tenants. Codifies that a workspace is not a
  tenant, that hierarchy grants explicit (not implicit) inherited
  access, and that operators see safety guards when workspaces or
  tenants overlap.
owner: core
status: active
applies_to: packages/memory-server/** and alfred init flows
related:
  - .ai/policies/memory-hosting-policy.md
  - .ai/policies/security.md
---

# Memory Workspace Policy

## Why this policy exists

A naive design conflates a *workspace* (a directory on disk) with a *tenant*
(a universe of data). When `alfred init` runs in a directory that contains or
descends from another initialized workspace, the naive design breaks in three
predictable ways:

1. The user creates a Postgres tenant at the root, then `alfred init` at a
   child fails silently or creates a duplicate.
2. Two agents on the same machine write to the same SQLite tenant without
   coordination and one loses data.
3. A delete at the root orphans a child that depended on inherited access.

This policy prevents all three with explicit invariants and visible safety
guards. It also keeps `alfred init` predictable when a workspace conflicts
with another workspace in the same hierarchy.

## Core Invariants

### Invariant W1 — Workspace is not a tenant

A workspace is a node in a directory tree. A tenant is a universe of data.
The relationship between them is modeled by the `tenant_access` table,
not by 1-to-1 coupling. One workspace can read zero, one, or many tenants.

### Invariant W2 — One workspace, one tenant at init time

When `alfred init` runs in a directory that has no prior `.alfred/config.json`,
it creates **one tenant** bound to that workspace. Future `alfred tenant new`
commands may add more tenants to the same workspace, but the binding on init
is exactly one.

This is enforced by:

```sql
UNIQUE (workspace_hash) ON tenants
```

### Invariant W3 — Cross-tenant duplicates are detected on init

Before creating a new tenant, `alfred init` scans:

1. All ancestor directories up to the filesystem root.
2. All descendant directories down to `--max-depth` levels (default 3).

If any workspace in either scan has a registered tenant, `alfred init` emits
a **safety guard prompt** that lists the conflicting workspaces and their
tenants. The user must explicitly choose:

| Choice | Result |
|---|---|
| **a. Promote** | Make the current workspace the parent of the descendant. Existing descendant tenant is archived (set to `kind = 'archived'`, kept on disk, no `owner` access). The descendant inherits the new parent's `tenant_access`. |
| **b. Coexist** | Keep both tenants. The new workspace is the `owner` of its tenant. If the new workspace was an ancestor of the existing one, the descendant workspace gains `reader` access to the new tenant. Optionally, the descendant may opt-in to inherit that `reader` access. |
| **c. Cancel** | Exit without creating anything. The user is informed that the operation was cancelled and the existing tenants are untouched. |

The (a)/(b)/(c) policy is the **safety guard**. Without it, `alfred init` would
silently pick a default that the user almost certainly did not intend.

### Invariant W4 — Inherited access is explicit

A workspace does NOT implicitly inherit tenants from its parent. Inheritance
happens only when:

1. The parent has a row in `tenant_access` with `inherited = true`.
2. The child was initialized or re-bound AFTER that row was inserted.
3. The child did not opt out during `alfred init`.

The `inherited` flag is audited. Changing it from `true` to `false` removes
the inherited row from descendants during the next access resolution.

### Invariant W5 — Readers block cascading deletes

If a tenant has any `reader` access from a non-archived workspace, the
tenant cannot be deleted. A TRIGGER enforces this at the DB level:

```sql
CREATE OR REPLACE FUNCTION prevent_tenant_delete_with_readers()
RETURNS TRIGGER AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM tenant_access
    WHERE tenant_id = OLD.id
      AND access = 'reader'
      AND inherited = false
  ) THEN
    RAISE EXCEPTION 'Cannot delete tenant %: has non-inherited readers', OLD.id;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
```

A TRIGGER on `tenants BEFORE DELETE` calls this function. The error message
includes the tenant id so the operator can locate the dependent workspace.

Deleting with `--force` cascades the readers too. This is logged at WARN level.

### Invariant W6 — No dual Postgres in a workspace chain

A workspace chain (root -> ... -> leaf) cannot contain two tenants with
`storage_backend = 'postgres'` and `access = 'owner'` with distinct `tenant_id`s.

This prevents the failure mode where a consultant's "client A Postgres
tenant" and "client B Postgres tenant" overlap because the consultant
forgot which Postgres server the child workspace was pointing at.

Enforced by a TRIGGER on `tenant_access` that walks the workspace chain
on every insert or update:

```sql
CREATE OR REPLACE FUNCTION check_no_dual_postgres_in_hierarchy()
RETURNS TRIGGER AS $$
DECLARE
  current_workspace workspaces%ROWTYPE;
BEGIN
  IF NEW.access = 'owner'
     AND (SELECT storage_backend FROM tenants WHERE id = NEW.tenant_id) = 'postgres' THEN
    current_workspace := (SELECT * FROM workspaces WHERE id = NEW.workspace_id);

    WHILE current_workspace.parent_workspace_id IS NOT NULL LOOP
      current_workspace := (SELECT * FROM workspaces WHERE id = current_workspace.parent_workspace_id);

      IF EXISTS (
        SELECT 1 FROM tenant_access ta
        JOIN tenants t ON t.id = ta.tenant_id
        WHERE ta.workspace_id = current_workspace.id
          AND ta.access = 'owner'
          AND t.storage_backend = 'postgres'
          AND t.id != NEW.tenant_id
      ) THEN
        RAISE EXCEPTION 'Cannot have two distinct Postgres tenants in this hierarchy';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

**Caveat**: this check is O(depth). For the consultant use case (3-5 levels
deep) it is trivial. Future versions may move this to a batched async check
if hierarchies grow.

## The three choices (a, b, c) in detail

When the safety guard in Invariant W3 fires, the user sees:

```
$ cd ~/Documents/personal/
$ alfred init

! Found existing Alfred configuration in descendant workspace:
    ~/Documents/personal/react/finance_calculator/
    - tenant: usr_t_finance_sqlite (sqlite, owner)
    - last rotated: 2 days ago

? What do you want to do?
  > a. Promote this workspace as parent
    b. Coexist (this workspace gets its own tenant, child stays independent)
    c. Cancel
```

### Choice (a) — Promote

After confirmation:

1. The current workspace is created as a parent.
2. The descendant workspace is linked (`parent_workspace_id = current.id`).
3. The descendant tenant is moved to `kind = 'archived'`, but the DB file is
   not deleted. The descendant retains `reader` access to its archived
   tenant for one additional command.
4. The descendant gains `owner` access to the new tenant created at the
   current workspace, with `inherited = true` so any further descendants
   also see it.

To reverse: run `alfred workspace restore-descendant` (planned).

### Choice (b) — Coexist

After confirmation:

1. The current workspace is created fresh.
2. The descendant workspace remains unchanged.
3. The descendant workspace is offered `reader` access to the new current
   workspace's tenant. If accepted, a `tenant_access` row is inserted with
   `access = 'reader'`, `inherited = true` (so grandchildren also see it
   unless they opt out).

### Choice (c) — Cancel

Nothing changes. The existing tenants are untouched. The user can re-run
`alfred init` in a different directory or after resolving the conflict
manually.

## Orphan config adoption

If `alfred init` runs in a directory that has a `.alfred/config.json` but
that workspace is **not** registered in the registry (orphan config):

```
! This workspace has a .alfred/config.json but it's not registered.
  Either it was orphaned (run `alfred init --adopt-existing`) or stale
  (delete it manually).

? Adopt this orphan config into the registry? [Yes / No]
```

A "Yes" registers the workspace with the tenant_id from the orphan config
and emits an audit log entry with `event = "workspace.adopt"`. A "No"
exits cleanly and suggests the user `rm <cwd>/.alfred/config.json`.

## Versioning

This policy is part of Alfred v0.3.0. Any change to the six invariants
requires:

1. A new entry in `packages/memory/CHANGELOG.md`.
2. A new eval dataset in `.ai/evals/datasets/memory-workspace-policy.yml`.
3. A regression baseline update approved by a human.

## Related Policies

- `.ai/policies/memory-hosting-policy.md` — the parallel policy governing
  storage backend selection per tenant kind.
- `.ai/policies/security.md` — deny-by-default; workspace operations
  require an existing authenticated API key.
