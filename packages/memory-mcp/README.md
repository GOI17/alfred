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
