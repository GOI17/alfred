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
      "Use the codex plug-in: alfred memory-server start",
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
    description: "ChatGPT Plus/Pro Custom GPT Actions bridge",
    relDir: "packages/chatgpt-adapter",
    commands: [
      "Run bridge: alfred-memory-base-url=$ALFRED url alfred-bridge (uses packages/chatgpt-adapter)",
      "In ChatGPT: My GPTs → Create → Configure → Actions → Import OpenAPI schema.",
      "Upload packages/chatgpt-adapter/openapi.json.",
      "Authentication: API Key, Bearer.",
      "Paste alk_... from .alfred/config.json."
    ]
  },
  {
    name: "google-ai-studio",
    description: "Google AI Studio / Gemini Enterprise custom Extension",
    relDir: "packages/gemini-adapter",
    commands: [
      "Run bridge: ALFRED_MEMORY_BASE_URL=... ALFRED_MEMORY_API_KEY=... node packages/gemini-adapter/bin/bridge.mjs",
      "Open AI Studio → Tools → Extensions → Create Extension.",
      "Upload packages/gemini-adapter/openapi.json.",
      "Auth: API Key, header x-api-key, value=alk_..."
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
