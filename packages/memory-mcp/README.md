# @alfred-labs/memory-mcp

Thin MCP stdio adapter for Alfred Memory.

This package exposes Alfred Memory operations as Model Context Protocol tools. It intentionally keeps business behavior in the Memory API client and only adapts MCP tool calls to `@alfred-labs/memory-client`.

## Dependencies

`@modelcontextprotocol/sdk` and `zod` are runtime dependencies for the real MCP server and stdio CLI. The package keeps tool registration testable through injected server-like and schema-like adapters, so local unit tests can run with fakes and without calling the Memory API.

## CLI

```bash
ALFRED_MEMORY_BASE_URL="https://memory.example.test" \
ALFRED_MEMORY_API_KEY="..." \
alfred-memory-mcp
```

Environment variables are read only by `src/cli.js`:

- `ALFRED_MEMORY_BASE_URL`
- `ALFRED_MEMORY_API_KEY`

## Tools

| Tool | Memory client call |
| --- | --- |
| `memory_search` | `memoryClient.searchMemories(input)` |
| `memory_create` | `memoryClient.createMemory(input)` |
| `memory_update` | `memoryClient.updateMemory(id, patch)` |
| `memory_delete` | `memoryClient.deleteMemory(id)` |
| `memory_list` | `memoryClient.listMemories(input)` |

Each successful tool result returns text content and `structuredContent`.

Operational `MemoryClientError` failures return safe MCP error results:

```json
{
  "isError": true,
  "content": [{ "type": "text", "text": "{\"error\":{\"code\":\"network_error\",\"message\":\"Memory API request failed.\"}}" }],
  "structuredContent": {
    "error": {
      "code": "network_error",
      "message": "Memory API request failed."
    }
  }
}
```

Unexpected errors map to `unexpected_error`. Error responses do not include stack traces or API keys.

## Scope boundaries

- No direct imports from `packages/memory` internals.
- No `MemoryPolicy`.
- No cache.
- No retries.
- No embeddings, RAG, UI, billing, or external integrations.

## Manual E2E validation guide

This guide proves the full MVP path:

```text
MCP client -> packages/memory-mcp -> packages/memory-client -> Memory API -> memory store
```

It is intentionally manual. Do not add new product features just to make this flow look cleaner; use the friction to decide the next slice.

### 1. Start the Memory API

For local validation, run a small Memory API host that uses the in-memory store:

```js
// /tmp/alfred-memory-api.mjs
import {
  createInMemoryStore,
  createMemoryHttpServer,
  createMemoryService
} from "@alfred-labs/memory";

const service = createMemoryService({ store: createInMemoryStore() });
const server = createMemoryHttpServer({
  service,
  apiKeys: {
    "dev-api-key": "dev-user"
  }
});

server.listen(3000, () => {
  console.log("Alfred Memory API listening on http://localhost:3000");
});
```

Run it from the repo root with workspace package resolution available:

```bash
node /tmp/alfred-memory-api.mjs
```

For PostgreSQL-backed validation, run the migrations documented in `packages/memory/README.md`, create a `pg` pool in the host app, and pass it to `createPostgresMemoryStore(pool)` before starting the HTTP server.

### 2. Start the MCP server

In another terminal:

```bash
ALFRED_MEMORY_BASE_URL="http://localhost:3000" \
ALFRED_MEMORY_API_KEY="dev-api-key" \
pnpm --filter @alfred-labs/memory-mcp exec alfred-memory-mcp
```

The CLI reads only:

- `ALFRED_MEMORY_BASE_URL`
- `ALFRED_MEMORY_API_KEY`

Do not pass secrets in prompts, logs, or checked-in config.

### 3. Configure a Codex-compatible MCP client

Point the client at the stdio command above. The exact config location is client-specific, but the command shape should stay equivalent to:

```json
{
  "command": "pnpm",
  "args": ["--filter", "@alfred-labs/memory-mcp", "exec", "alfred-memory-mcp"],
  "env": {
    "ALFRED_MEMORY_BASE_URL": "http://localhost:3000",
    "ALFRED_MEMORY_API_KEY": "dev-api-key"
  }
}
```

Codex friction to validate:

- whether Codex accepts a workspace `pnpm --filter ... exec ...` command directly;
- whether Codex requires an absolute command path instead of `pnpm`;
- whether environment variables are injected per-server or globally;
- whether the MCP client displays `structuredContent` or only text content;
- whether mutating tools such as `memory_delete` require additional user confirmation.

### 4. Exercise the tools

Use a real MCP client to call the tools in this order.

#### `memory_create`

Input:

```json
{
  "type": "fact",
  "content": "Alfred Memory MCP can create and retrieve memories through the official client.",
  "source": "manual-e2e",
  "namespace": "project:alfred",
  "tags": ["mcp", "e2e"]
}
```

Expected:

- result includes a memory `id`;
- `structuredContent.namespace` is `project:alfred`;
- `structuredContent.type` is `fact`.

Save the returned `id` for update/delete.

#### `memory_search`

Input:

```json
{
  "q": "official client",
  "namespace": "project:alfred",
  "limit": 10
}
```

Expected:

- result includes the created memory in `structuredContent.items`;
- `structuredContent.pagination.total` is at least `1`.

#### `memory_list`

Input:

```json
{
  "namespace": "project:alfred",
  "tag": "mcp",
  "limit": 10
}
```

Expected:

- result includes the created memory;
- pagination is present.

#### `memory_update`

Input:

```json
{
  "id": "<memory-id-from-create>",
  "patch": {
    "content": "Alfred Memory MCP can create, search, list, update, and delete memories through the official client.",
    "tags": ["mcp", "e2e", "updated"]
  }
}
```

Expected:

- result keeps the same `id`;
- `content` and `tags` reflect the patch;
- `namespace` is not accepted in `patch`.

#### `memory_delete`

Input:

```json
{
  "id": "<memory-id-from-create>"
}
```

Expected:

```json
{
  "deleted": true
}
```

Run `memory_search` again for the same query. The deleted memory should no longer appear.

### 5. Manual E2E checklist

- [ ] Memory API starts and responds to `/health`.
- [ ] MCP server starts with `ALFRED_MEMORY_BASE_URL` and `ALFRED_MEMORY_API_KEY`.
- [ ] MCP client can list the five tools.
- [ ] `memory_create` creates a memory through the MCP server.
- [ ] `memory_search` finds the created memory.
- [ ] `memory_list` returns the created memory with pagination.
- [ ] `memory_update` updates editable fields.
- [ ] `memory_update` rejects or omits `namespace` changes.
- [ ] `memory_delete` deletes the memory.
- [ ] Operational errors are returned as `isError: true` without stack traces or API keys.
- [ ] No direct calls to `packages/memory` internals are needed by the MCP server.

### 6. Stop criteria

After this checklist passes, stop adding infrastructure and use Alfred in the daily workflow. Open new slices only from observed friction, such as namespace moves, import/export, duplicate consolidation, or search quality limits.
