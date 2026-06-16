# @alfred-labs/memory-client

Official ESM JavaScript client for Alfred Memory HTTP APIs.

This package is intentionally small and stable:

- no dependency on `@alfred-labs/memory` internals;
- no MCP implementation;
- no retries, caching, embeddings, RAG, UI, billing, or external integrations;
- one client error type: `MemoryClientError`.

## Install

```sh
pnpm add @alfred-labs/memory-client
```

## Usage

```js
import { createMemoryClient, MemoryClientError } from "@alfred-labs/memory-client";

const memory = createMemoryClient({
  baseUrl: "http://localhost:3000",
  apiKey: process.env.ALFRED_MEMORY_API_KEY
});

try {
  const created = await memory.createMemory({
    type: "fact",
    content: "Alfred Memory has a stable HTTP client.",
    tags: ["memory-client"],
    source: "mcp"
  });

  const result = await memory.searchMemories({ q: "stable HTTP client", limit: 10 });
  console.log(created.id, result.items.length);
} catch (error) {
  if (error instanceof MemoryClientError) {
    console.error(error.code, error.status, error.details);
  }
  throw error;
}
```

## API

```js
const client = createMemoryClient({ baseUrl, apiKey, fetch });
```

Options:

- `baseUrl` — Memory API base URL. Trailing slashes are normalized away.
- `apiKey` — sent on every request as `x-api-key`.
- `fetch` — optional injected fetch implementation for tests or custom runtimes.

Methods:

- `createMemory(input)` → `POST /memories`
- `getMemory(id)` → `GET /memories/:id`
- `listMemories(options?)` → `GET /memories`
- `searchMemories(options)` → `GET /memories/search`
- `updateMemory(id, patch)` → `PATCH /memories/:id`
- `deleteMemory(id)` → `DELETE /memories/:id`

## Errors

All local validation, HTTP, and network failures use `MemoryClientError`.

- Local configuration errors use `configuration_error`.
- Missing request fields use `validation_error`.
- Fetch failures use `network_error` and preserve the original `cause`.
- JSON API errors preserve the API `error.code`, `error.message`, and `error.details`.
- Non-JSON non-2xx responses use `http_error`.
