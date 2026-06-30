#!/usr/bin/env node
// Alfred CLI entrypoint. Subcommands are dispatched from this thin shim.
//
// This script is intentionally minimal: each command lives in its own file in
// this directory. Future commands (key list, validate-policy, migrate) plug in
// here without touching the dispatcher.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const usage = () => {
  process.stderr.write([
    "alfred <subcommand> [options]",
    "",
    "Quick start (no install needed if you have the source tree):",
    "  alfred init --profile=web --name my-mem   # web-only API key for ChatGPT/Claude/Gemini",
    "  alfred init --profile=coding --name acme  # coding agent in cwd (default)",
    "  alfred init --profile=both --name shared  # both kinds",
    "",
    "Subcommands:",
    "  init             Initialize a tenant + workspace + API key (3 profiles)",
    "  provision        Provision a tenant only (no workspace, no key)",
    "  list             List tenants in the registry",
    "  validate-policy  Run hosting-policy checks against the registry",
    "  keys issue       Issue a new API key for an existing tenant",
    "  key rotate       Revoke all current keys for a tenant and issue a new one",
    "  key revoke       Revoke a single API key by id",
    "  key list         List API keys for a tenant (--include-revoked for history)",
    "  migrate          Migrate tenant storage (sqlite<->sqlite, sqlite->pg SQL dump)",
    "  serve            Run the Alfred Memory Server (HTTP/HTTPS)",
    "  adapters         List agent adapters + print integration steps",
  "  dashboard         TUI dashboard (tenants, keys, memory counts)",
    "  version          Print the Alfred CLI version",
    "",
    "Init profiles:",
    "  coding (default) - coding_agent_only + sqlite + writes <cwd>/.alfred/config.json",
    "  web              - human_agent + postgres, NO workspace binding, prints web setup",
    "  both             - hybrid_with_human + postgres, workspace + web setup",
    "",
    "Global options:",
    "  --non-interactive  never prompt (CI/automation)",
    "  --print-only       show the plan without executing",
    "  --backend <b>      sqlite (default for coding) or postgres (default for web)",
    "  --cwd <path>       workspace path (default: process.cwd())",
    "",
    "Run `alfred <subcommand> --help` for command-specific options."
  ].join("\n"));
};

async function main(argv, env = process.env) {
  const [, , subcmd, ...rest] = argv;
  if (!subcmd || subcmd === "--help" || subcmd === "-h") {
    usage();
    return 0;
  }
  try {
    switch (subcmd) {
      case "init":
        return await (await import("./init.mjs")).run(rest, env);
      case "provision":
        return await (await import("./provision.mjs")).run(rest, env);
      case "list":
        return await (await import("./list.mjs")).run(rest, env);
      case "validate-policy":
        return await (await import("./validate-policy.mjs")).run(rest, env);
      case "key":
        return await runKey(rest, env);
      case "keys":
        return await (await import("./keys-issue.mjs")).run(rest, env);
      case "migrate":
        return await (await import("./migrate.mjs")).run(rest, env);
      case "adapters":
        return await (await import("./adapters.mjs")).run(rest, env);
      case "dashboard":
        return await (await import("../../console/tui/dashboard.mjs")).runTui(rest);
      case "serve":
        return await (await import("./serve.mjs")).run(rest, env);
      case "version":
        process.stdout.write("alfred 0.3.0\n");
        return 0;
      default:
        process.stderr.write(`Unknown subcommand: ${subcmd}\n`);
        usage();
        return 2;
    }
  } catch (err) {
    process.stderr.write(`Error: ${err.message}\n`);
    if (env.ALFRED_DEBUG === "1" && err.stack) process.stderr.write(err.stack + "\n");
    return 1;
  }
}

async function runKey(rest, env) {
  const [, sub, ...args] = rest;
  switch (sub) {
    case "rotate":
      return await (await import("./key-rotate.mjs")).run(args, env);
    case "revoke":
      return await (await import("./key-revoke.mjs")).run(args, env);
    case "list":
      return await (await import("./key-list.mjs")).run(args, env);
    default:
      process.stderr.write(`alfred key <rotate|revoke|list>\n`);
      return 2;
  }
}

process.exit(await main(process.argv));
