# Alfred Memory Anthropic Adapter v0.3.0

MCP (Model Context Protocol) server that exposes Alfred Memory as tools
for Claude Desktop.

## Setup (Claude Desktop)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS)
or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "alfred-memory": {
      "command": "node",
      "args": ["/path/to/this/package/bin/alfred-mcp.mjs"],
      "env": {
        "ALFRED_WORKSPACE_CWD": "/path/to/your/workspace",
        "ALFRED_MEMORY_BASE_URL": "http://localhost:3000",
        "ALFRED_MEMORY_API_KEY": "alk_..."
      }
    }
  }
}
```

Restart Claude Desktop. The tools appear in the conversation panel
under the "Tools" section.

## Tools exposed

| Tool | Purpose |
|---|---|
| `alfred_list_memories` | List memories by namespace/type/limit/offset |
| `alfred_search_memories` | Full-text search by `q` |
| `alfred_create_memory` | Persist a fact, decision, preference, etc. |
| `alfred_get_memory` | Fetch a memory by id |
| `alfred_delete_memory` | Remove a memory by id |

`source` defaults to `"claude-desktop-mcp"` so you can audit which memories
came from Claude vs. opencode vs. Codex.

## Architecture

The MCP server reads the workspace config from `.alfred/config.json`
(placed there by `alfred init`) and proxies each tool call to the
upstream Alfred Memory Server using the API key from the config or the
`ALFRED_MEMORY_API_KEY` env var. The proxy uses Node's built-in `http`
module — no third-party HTTP client.

## Tests

```bash
npm run check
npm test
```

8 tests covering:
- Config validation
- JSON-RPC initialize / tools/list / tools/call / error paths
- Tool schema validation
