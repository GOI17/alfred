#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const memoryCommands = new Set(["init", "provision", "list", "validate-policy", "keys", "key", "migrate", "serve", "adapters", "dashboard"]);
const harnessCommands = new Set(["runtime", "skills", "profiles"]);
function version() {
  for (const relative of ["../../../package.json", "../package.json"]) {
    try { return JSON.parse(readFileSync(new URL(relative, import.meta.url), "utf8")).version; } catch {}
  }
  return "unknown";
}
function usage() {
  process.stdout.write(`Alfred — Workspace, Memory and Agent Harness\n\nUsage: alfred <capability> <command> [options]\n\n  workspace  Projects, conversations and tools (alfred-workspace)\n  memory     Independent persistence and local APIs (alfred-memory)\n  harness    Agent, skill and runtime operations (alfred-agent-harness)\n  setup      Choose capabilities and review product updates\n  version    Print the Alfred product version\n\nExamples:\n  alfred setup --components=workspace,memory,harness\n  alfred workspace serve\n  alfred memory init --profile=coding\n  alfred memory serve --bind 127.0.0.1\n  alfred harness skills list\n\nCapabilities run independently. Connections between them require explicit configuration.\nLegacy init, serve, list, key, runtime, skills and profiles commands remain aliases.\n`);
}
export async function run(args = [], env = process.env) {
  const [command, ...rest] = args;
  if (!command || command === "--help" || command === "-h" || command === "help") { usage(); return 0; }
  try {
    if (command === "version" || command === "--version") { process.stdout.write(`alfred ${version()}\n`); return 0; }
    if (command === "workspace") return await (await import("../../workspace/scripts/cli.mjs")).run(rest, env);
    if (command === "memory") return await (await import("../../memory-server/scripts/memory.mjs")).run(rest, env);
    if (command === "harness" || command === "agent-harness") return await (await import("../../agent-harness/scripts/cli.mjs")).run(rest, env);
    if (command === "setup") return await (await import("./setup.mjs")).run(rest, env);
    if (memoryCommands.has(command)) return await (await import("../../memory-server/scripts/memory.mjs")).run(args, env);
    if (harnessCommands.has(command)) return await (await import("../../agent-harness/scripts/cli.mjs")).run(args, env);
    process.stderr.write(`Unknown subcommand: ${command}\n`); usage(); return 2;
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    if (env.ALFRED_DEBUG === "1" && error.stack) process.stderr.write(error.stack + "\n");
    return 1;
  }
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) process.exitCode = await run(process.argv.slice(2));
