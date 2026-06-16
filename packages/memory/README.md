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
| Search | Plain deterministic text search using in-memory matching or PostgreSQL `ILIKE` plus `tsvector`. |
| Auth | API-key resolver maps each request to one user; store operations always scope by `userId`. |
| API | Framework-agnostic Node HTTP handler/server. |
| SDK | Framework-agnostic fetch client. |

## Memory model

Required fields:

- `id`
- `userId`
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

Run the migration once:

```bash
psql "$MEMORY_DATABASE_URL" -f packages/memory/migrations/001_create_memory_tables.sql
```

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
  -d '{"type":"decision","content":"Keep core harness agnostic.","tags":["architecture"],"source":"codex"}'

curl -H 'x-api-key: dev-api-key' 'http://localhost:3000/memories?limit=20&offset=0'
curl -H 'x-api-key: dev-api-key' 'http://localhost:3000/memories/search?q=harness'
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
  type: "workflow",
  content: "Run package-level tests before root checks.",
  tags: ["testing"],
  source: "codex"
});

const results = await client.searchMemories({ q: "package-level tests", limit: 10 });
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
