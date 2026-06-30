#!/usr/bin/env node
// Alfred Memory MCP server for Claude Desktop.
// Adds itself as an MCP server by running JSON-RPC over stdio.
//
// Configure Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):
//   {
//     "mcpServers": {
//       "alfred-memory": {
//         "command": "node",
//         "args": ["/path/to/alfred-memory-cli/bin/alfred-mcp.mjs"],
//         "env": {
//           "ALFRED_WORKSPACE_CWD": "/Users/you/path/to/workspace",
//           "ALFRED_MEMORY_BASE_URL": "http://localhost:3000",
//           "ALFRED_MEMORY_API_KEY": "alk_..."
//         }
//       }
//     }
//   }
import { makeStdioRunner } from "../src/server.mjs";

makeStdioRunner().run().catch((err) => {
  process.stderr.write(`mcp server exited with error: ${err.message}\n`);
  process.exit(1);
});
