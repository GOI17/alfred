#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function usage() {
  process.stdout.write("Agent Harness\n\nUsage: alfred-agent-harness <runtime|skills|profiles> [options]\n\n  runtime   Initialize and run approved instructions\n  skills    Discover and manage agent skills\n  profiles  Plan and activate runtime profiles\n\nNo Workspace or Memory service is required. Optional external capabilities must be configured explicitly.\n");
}
export async function run(args = [], env = process.env) {
  const [command, ...rest] = args;
  if (!command || ["--help", "-h", "help"].includes(command)) { usage(); return 0; }
  try {
    if (command === "version" || command === "--version") {
      process.stdout.write(`alfred-agent-harness ${JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version}\n`); return 0;
    }
    if (command === "runtime") return await (await import("./runtime.mjs")).run(rest, env);
    if (command === "skills") return await (await import("../../skill-manager/src/cli.js")).run(rest, env);
    if (command === "profiles") {
      if (!rest.length || rest.some(arg => ["help", "--help", "-h"].includes(arg))) {
        process.stdout.write("Usage: alfred-agent-harness profiles <init|doctor|plan|switch> --repo PATH [options]\n\n  init --repo PATH [--git]\n  doctor --repo PATH [--profile NAME --agent AGENT]\n  plan|switch --repo PATH --profile NAME --agent AGENT [--home PATH]\n  switch --dry-run previews activation; --force replaces approved conflicts.\n"); return 0;
      }
      const child = spawnSync(process.execPath, [fileURLToPath(new URL("../../profile-manager/src/cli.js", import.meta.url)), ...rest], { env, stdio: "inherit" });
      if (child.error) throw child.error;
      return child.status ?? 1;
    }
    process.stderr.write(`Unknown Agent Harness command: ${command}\n`); usage(); return 2;
  } catch (error) { process.stderr.write(`Error: ${error.message}\n`); return 1; }
}
if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) process.exitCode = await run(process.argv.slice(2));
