#!/usr/bin/env node
// alfred adapters <list|instructions>
//
// Prints one-shot instructions for wiring each supported agent into the
// current workspace.

import { join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const adapters = [
  {
    name: "opencode",
    description: "Alfred-aware opencode agent (uses .alfred/config.json + Alfred HTTP server)",
    relDir: "packages/pi-adapter",
    commands: [
      "Set environment: ALFRED_MEMORY_BASE_URL=http://localhost:3000",
      "The adapter reads cwd/.alfred/config.json on every session start.",
      "Run `alfred init` in your workspace so the config file exists."
    ]
  },
  {
    name: "codex",
    description: "Codex CLI adapter for Alfred Memory",
    relDir: "packages/opencode-adapter",
    commands: [
      "Start the local service: ALFRED_MEMORY_REQUIRE_AUTH=true alfred serve",
      "Codex picks up .alfred/config.json automatically when invoked from cwd."
    ]
  },
  {
    name: "claude-desktop",
    description: "Anthropic Claude Desktop MCP server for Alfred Memory",
    relDir: "packages/anthropic-adapter",
    commands: [
      "Edit ~/Library/Application Support/Claude/claude_desktop_config.json:",
      "  {",
      '    "mcpServers": { "alfred-memory": {',
      '      "command": "node",',
      '      "args": ["' + "<abs path to packages/anthropic-adapter/bin/alfred-mcp.mjs" + '"],',
      '      "env": {',
      '        "ALFRED_WORKSPACE_CWD": "<abs path to your workspace>",',
      '        "ALFRED_MEMORY_BASE_URL": "http://localhost:3000",',
      '        "ALFRED_MEMORY_API_KEY": "<alk_... from .alfred/config.json>"',
      "      }",
      "    } }",
      "  }",
      "Restart Claude Desktop."
    ]
  },
  {
    name: "chatgpt-custom-gpt",
    description: "Compatibility schema; cloud ChatGPT Actions cannot reach local Memory",
    relDir: "packages/chatgpt-adapter",
    commands: [
      "The managed hosted service is retired. Cloud ChatGPT Actions cannot reach loopback.",
      "Start local Memory: ALFRED_MEMORY_REQUIRE_AUTH=true alfred serve",
      "Open http://127.0.0.1:3000/console/ with the key issued by alfred init.",
      "Schema compatibility details: packages/chatgpt-adapter/README.md; never enter credentials in a chat."
    ]
  },
  {
    name: "google-ai-studio",
    description: "Local Gemini bridge; cloud AI Studio cannot reach loopback",
    relDir: "packages/gemini-adapter",
    commands: [
      "Run bridge: ALFRED_MEMORY_BASE_URL=... ALFRED_MEMORY_API_KEY=... node packages/gemini-adapter/bin/bridge.mjs",
      "The bridge listens only on 127.0.0.1:8788 for clients on this computer.",
      "Cloud Google AI Studio cannot reach the loopback bridge.",
      "See packages/gemini-adapter/README.md for local configuration."
    ]
  }
];

function printList() {
  for (const a of adapters) {
    process.stdout.write(`- ${a.name}\n  ${a.description}\n  Package: ${a.relDir}\n`);
  }
}

function printInstructions(name) {
  const a = adapters.find((x) => x.name === name);
  if (!a) {
    process.stderr.write(`Unknown adapter: ${name}\n`);
    return 2;
  }
  process.stdout.write(`# ${a.name}\n`);
  process.stdout.write(`${a.description}\n\n`);
  process.stdout.write("Package: " + a.relDir + "\n\n");
  process.stdout.write("## Steps\n");
  for (const c of a.commands) process.stdout.write(`- ${c}\n`);
  return 0;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      out[a.slice(2)] = true;
    } else { out._.push(a); }
  }
  return out;
}

export async function run(argv = [], env = process.env) {
  const args = parseArgs(argv);
  if (!args._[0] || args._[0] === "list") {
    process.stdout.write("Alfred adapters\n");
    process.stdout.write("================\n\n");
    printList();
    return 0;
  }
  if (args._[0] === "instructions") {
    if (!args._[1]) {
      process.stderr.write("Required: alfred adapters instructions <name>\n");
      return 2;
    }
    return printInstructions(args._[1]);
  }
  process.stderr.write(`Unknown subcommand: ${args._[0]}\n`);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await run(process.argv.slice(2)));
}
