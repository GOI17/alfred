# Alfred Memory MVP

Alfred Memory is a small, local-first memory service package for storing user-scoped memories that future Alfred adapters, APIs, or SDKs can consume without coupling `packages/core` to storage or HTTP concerns.

## Quick path

1. Use the in-memory store for tests and local development.
2. Run the SQL migration before using PostgreSQL.
3. Protect every API call with an API key that resolves to exactly one `userId`.

```js
import { createInMemoryStore, createMemoryService } from "@alfred-labs/memory";

const service = createMemoryService({ store: createInMemoryStore() });
const memory = await service.createMemory("user-123", {
  namespace: "work",
  type: "preference",
  content: "Prefer deterministic local work before provider calls.",
  tags: ["local-first"],
  source: "codex"
});
```

## What this package includes

| Area | MVP decision |
| --- | --- |
| Architecture | Isolated package under `packages/memory`; no adapter imports and no `packages/core` changes. |
| Storage | Store interface with in-memory and PostgreSQL implementations. |
| Search | Plain deterministic text search using in-memory matching or PostgreSQL `ILIKE`. |
| Auth | API-key resolver maps each request to one user; store operations always scope by `userId`. |
| Namespace | Contextual partition inside a user; list/search can filter by it while get/update/delete remain secured by `id + userId`. |
| Policy | Internal deterministic decision engine for future adapters to decide when to search, persist, classify, and suggest namespaces. |
| API | Framework-agnostic Node HTTP handler/server. |
| SDK | Framework-agnostic fetch client. |

## Memory model

Required fields:

- `id`
- `userId`
- `namespace`
- `type`
- `content`
- `tags`
- `source`
- `createdAt`
- `updatedAt`

Optional fields:

- `projectId`
- `metadata`
- `confidence` (`0` to `1`)
- `expiresAt`

Allowed `type` values: `preference`, `fact`, `decision`, `workflow`, `project`, `correction`, `source`.

### Namespace behavior

`namespace` is the public partition name. It is contextual metadata inside `userId`; it is not a team, workspace, or billing boundary.

Defaults and compatibility:

| Input | Stored namespace |
| --- | --- |
| `namespace` provided | Use it exactly after validation. |
| No `namespace`, `projectId: "alfred"` provided | `project:alfred` |
| Neither `namespace` nor `projectId` provided | `personal` |

Validation is intentionally flexible but safe:

- Allowed examples: `personal`, `work`, `project:alfred`, `team:platform`, `custom:name_1`.
- Allowed characters: lowercase letters, numbers, `-`, `_`, and `:`.
- Rejected: empty strings, whitespace, uppercase letters, path-like or unusual characters, and values longer than 120 characters.

`namespace` is not editable through `PATCH /memories/:id`. If a memory was stored in the wrong namespace, use a future explicit move endpoint rather than mutating the partition accidentally. `projectId` remains optional compatibility metadata; it is not the primary partition.

## MemoryPolicy

`MemoryPolicy` is an internal decision engine for future Alfred adapters. It does not store memories, authenticate users, call providers, summarize conversations, or change REST/SDK behavior.

Use it when a caller needs a local-only recommendation for:

- whether prior memory search is useful for a task;
- whether a candidate is durable enough to persist;
- which existing memory type best fits a candidate;
- which namespace should be suggested from explicit context, `projectId`, or the `personal` fallback.

Policy decisions are intentionally conservative and include a human-readable `reason`. Search decisions may include a `query` when the policy can derive one safely.

```js
import { createMemoryPolicy } from "@alfred-labs/memory";

const policy = createMemoryPolicy();

const searchDecision = policy.shouldSearch({
  task: "Recall the previous architecture decision for packages/core."
});

const persistDecision = policy.shouldPersist({
  content: "Decision: packages/core remains harness-agnostic.",
  source: "codex"
});
```

`MemoryPolicy` only suggests namespaces. Callers must still pass writes through the existing memory validation and persistence flow; the policy must not bypass namespace validation or mutate existing memories.

## Local setup

```bash
pnpm --filter @alfred-labs/memory check
pnpm --filter @alfred-labs/memory test
```

No external dependency is required for the in-memory path. PostgreSQL support expects a `pg`-style client or pool supplied by the caller.

## Environment variables

This package does not read environment variables directly. Applications usually provide:

| Variable | Purpose |
| --- | --- |
| `MEMORY_DATABASE_URL` | Used by the host app to create its PostgreSQL client/pool. |
| `MEMORY_API_KEYS` | Used by the host app to map API keys to user IDs. Prefer a secret manager in production. |

## PostgreSQL setup

For a fresh database, run migrations in order:

```bash
psql "$MEMORY_DATABASE_URL" -f packages/memory/migrations/001_create_memory_tables.sql
psql "$MEMORY_DATABASE_URL" -f packages/memory/migrations/002_add_memory_namespace.sql
```

For an existing database that already applied the initial MVP migration, run only the additive migration:

```bash
psql "$MEMORY_DATABASE_URL" -f packages/memory/migrations/002_add_memory_namespace.sql
```

`002_add_memory_namespace.sql` backfills `namespace` from safe `project_id` values or `personal`, and removes the retired generated search vector from early local databases.

Then pass a `pg`-style client or pool:

```js
import pg from "pg";
import { createMemoryService, createPostgresMemoryStore } from "@alfred-labs/memory";

const pool = new pg.Pool({ connectionString: process.env.MEMORY_DATABASE_URL });
const service = createMemoryService({ store: createPostgresMemoryStore(pool) });
```

The migration includes `alfred_memory_users` for ownership and `alfred_memories` for memory records. API-key hashing and user provisioning belong to the host application.

## REST API

Create a server:

```js
import { createMemoryHttpServer, createMemoryService, createInMemoryStore } from "@alfred-labs/memory";

const service = createMemoryService({ store: createInMemoryStore() });
const server = createMemoryHttpServer({
  service,
  apiKeys: {
    "dev-api-key": "user-123"
  }
});

server.listen(3000);
```

Every `/memories` route requires either `x-api-key: <key>` or `Authorization: Bearer <key>`.

```bash
curl -X POST http://localhost:3000/memories \
  -H 'content-type: application/json' \
  -H 'x-api-key: dev-api-key' \
  -d '{"namespace":"work","type":"decision","content":"Keep core harness agnostic.","tags":["architecture"],"source":"codex"}'

curl -H 'x-api-key: dev-api-key' 'http://localhost:3000/memories?namespace=work&limit=20&offset=0'
curl -H 'x-api-key: dev-api-key' 'http://localhost:3000/memories/search?namespace=work&q=harness'
curl -H 'x-api-key: dev-api-key' 'http://localhost:3000/memories/<id>'
curl -X PATCH -H 'content-type: application/json' -H 'x-api-key: dev-api-key' \
  -d '{"tags":["architecture","core"]}' 'http://localhost:3000/memories/<id>'
curl -X DELETE -H 'x-api-key: dev-api-key' 'http://localhost:3000/memories/<id>'
curl http://localhost:3000/health
```

Errors are predictable JSON:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Memory input is invalid.",
    "details": [{ "field": "type", "message": "type must be one of: preference, fact, decision, workflow, project, correction, source." }]
  }
}
```

## SDK example

```js
import { createMemoryClient } from "@alfred-labs/memory";

const client = createMemoryClient({
  baseUrl: "http://localhost:3000",
  apiKey: "dev-api-key"
});

await client.createMemory({
  namespace: "project:alfred",
  type: "workflow",
  content: "Run package-level tests before root checks.",
  tags: ["testing"],
  source: "codex"
});

const results = await client.searchMemories({ namespace: "project:alfred", q: "package-level tests", limit: 10 });
```

## Codex workflow

- Keep changes inside `packages/memory/**` unless a future task explicitly expands ownership.
- Prefer TDD through the public HTTP/API/SDK interface.
- Run `pnpm --filter @alfred-labs/memory check` and `pnpm --filter @alfred-labs/memory test` before handing off.
- Do not modify `packages/core` for memory storage, auth, HTTP, or PostgreSQL behavior.

## Explicitly out of scope

This MVP intentionally does not implement:

- OpenCode, Claude, Copilot, Codex, VSCode, or Pi integrations.
- Agent orchestration.
- RAG, embeddings, vector databases, or semantic ranking.
- Billing or team workspaces.
- Scheduling, notifications, or background jobs.
- Knowledge graphs.
- LLM extraction.
- Automatic tagging.
