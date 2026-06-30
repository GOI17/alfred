# Alfred Memory v0.3.0

Alfred Memory is a multi-tenant, harness-agnostic memory store for agent operations. v0.3.0 introduces the **TenantService** layer (workspaces, tenant_access, hosting policy enforcement) and the **UserService** layer (API keys with scrypt hashing) on top of the v0.2.0 memory MVP.

## Hosting modes

See `.ai/architecture/memory-hosting-modes.md` for the full matrix. Summary:

| Mode | Backend | Operator |
|---|---|---|
| `local-only` | SQLite per tenant | Solo dev |
| `self-hosted` | Postgres per tenant | VPS / cloud / on-prem |

Switch at runtime with `ALFRED_MEMORY_HOSTING=local|self-hosted`.

## Storage backend selection

`tenant.kind` is the gate:

- `human_agent`, `hybrid_with_human`, `server_managed` → **must use Postgres**.
- `coding_agent_only` → ask the user at `alfred init` time (SQLite or Postgres).

A failing selection is rejected at three independent layers:

1. The `tenants` table CHECK constraints in `migrations/000_alfred_registry.sql`.
2. The `TenantService.provisionTenant` validation in `src/tenants.js`.
3. The CLI prompts in `../memory-server/scripts/init.mjs`.

Defense in depth. See `.ai/policies/memory-hosting-policy.md`.

## Workspaces vs tenants

A **workspace** is a directory on disk. A **tenant** is a universe of data. They are linked through `tenant_access`, which is many-to-many with explicit `inherited = true|false`.

When `alfred init` runs in a directory that contains or descends from another initialized workspace, it emits the (a)/(b)/(c) safety guard. See `.ai/policies/memory-workspace-policy.md`.

## Quick path

```js
import {
  createMemoryService,
  createInMemoryStore,
  createTenantService,
  createInMemoryTenantStore,
  createUserService,
  createInMemoryUserStore,
  sha256OfPath
} from "@alfred-labs/memory";

// Provision a tenant
const tenantService = createTenantService({ store: createInMemoryTenantStore() });
const tenant = await tenantService.provisionTenant({
  kind: "coding_agent_only",
  storage_backend: "sqlite",
  db_path: "/tmp/tenant.sqlite",
  display_name: "Personal"
});

// Provision an API key for an agent
const userService = createUserService({
  store: createInMemoryUserStore({ initialTenants: [tenant] })
});
const { apiKey, key } = await userService.provisionApiKey({
  tenant_id: tenant.id,
  label: "laptop"
});
// apiKey is shown ONCE. Save it now.

// Use the memory service scoped to tenant_id
const memoryService = createMemoryService({ store: createInMemoryStore() });
const memory = await memoryService.createMemory(tenant.id, {
  namespace: "personal",
  type: "preference",
  content: "Local-first by default.",
  tags: ["policy"],
  source: "codex"
});
```

## API surface

| Module | Public exports |
|---|---|
| `domain.js` | `ALLOWED_MEMORY_TYPES`, `createMemoryService`, normalize helpers, `MemoryValidationError`, `MemoryNotFoundError` |
| `in-memory-store.js` | `createInMemoryStore` |
| `postgres-store.js` | `createPostgresMemoryStore(client)` |
| `sqlite-memory-store.js` | `createSqliteMemoryStore(db)`, `openSqliteMemoryStore(path)` |
| `http.js` | `createMemoryHttpHandler`, `createMemoryHttpServer` |
| `sdk.js` | `createMemoryClient` |
| `policy.js` | `MemoryPolicy`, `createMemoryPolicy` |
| `tenants.js` | `createTenantService`, normalize helpers, `TenantValidationError`, `TenantNotFoundError`, `TenantConflictError`, `TenantPolicyError` |
| `in-memory-tenant-store.js` | `createInMemoryTenantStore`, `sha256OfPath` |
| `users.js` | `createUserService`, `verifyApiKey`, `UserValidationError`, `UserNotFoundError`, `ApiKeyInvalidError` |
| `in-memory-user-store.js` | `createInMemoryUserStore` |

## Tests

```bash
npm run check
npm test
```

Test counts:

- `policy.test.js` — 9 tests, MemoryPolicy decisions.
- `memory.test.js` — HTTP/SDK lifecycle (requires loopback).
- `tenants.test.js` — 28 tests, covering policy invariants W5/W6.
- `users.test.js` — 17 tests, covering scrypt hashing and rotation.
- `sqlite-memory-store.test.js` — 9 tests, parity with Postgres.

## Migrations

| File | Purpose |
|---|---|
| `migrations/001_create_memory_tables.sql` | Initial tables. |
| `migrations/002_add_memory_namespace.sql` | Adds `namespace` column. |
| `migrations/sqlite/001_memory.sqlite.sql` | SQLite twin for local tenants. |

For multi-tenant SQLite, the `alfred_registry` lives separately in `../memory-server/migrations/000_alfred_registry.sql`.

## Versioning

v0.3.0 is the multi-tenant milestone. See `../memory-server/CHANGELOG.md` for release notes.
