#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { createMemoryMcpServer } from "./server.js";

export function readMemoryMcpConfigFromEnv(env = process.env) {
  const baseUrl = normalizeEnvString(env.ALFRED_MEMORY_BASE_URL, "ALFRED_MEMORY_BASE_URL");
  const apiKey = normalizeEnvString(env.ALFRED_MEMORY_API_KEY, "ALFRED_MEMORY_API_KEY");
  return { baseUrl, apiKey };
}

export async function createMemoryClientFromConfig(config) {
  const { createMemoryClient } = await import("@alfred-labs/memory-client");
  return createMemoryClient(config);
}

export async function runMemoryMcpCli({ env = process.env, stderr = process.stderr } = {}) {
  try {
    const config = readMemoryMcpConfigFromEnv(env);
    const memoryClient = await createMemoryClientFromConfig(config);
    const server = await createMemoryMcpServer({ memoryClient });
    const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
    await server.connect(new StdioServerTransport());
  } catch (error) {
    stderr.write(`${safeCliErrorMessage(error)}\n`);
    process.exitCode = 1;
  }
}

function normalizeEnvString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is required.`);
  }

  return value.trim();
}

function safeCliErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return `alfred-memory-mcp: ${error.message.replace(/(api[-_ ]?key)(\s*[=:]\s*)?[^,\s}]*/gi, "$1$2[REDACTED]")}`;
  }

  return "alfred-memory-mcp: unexpected_error";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runMemoryMcpCli();
}
