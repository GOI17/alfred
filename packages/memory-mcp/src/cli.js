#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import { runStandaloneMcpStdio } from "./stdio.js";

export function readMemoryMcpConfigFromEnv(env = process.env) {
  const baseUrl = normalizeEnvString(env.ALFRED_MEMORY_BASE_URL, "ALFRED_MEMORY_BASE_URL");
  const apiKey = normalizeEnvString(env.ALFRED_MEMORY_API_KEY, "ALFRED_MEMORY_API_KEY");
  return { baseUrl, apiKey };
}

export async function createMemoryClientFromConfig(config, {
  packageImporter = () => import("@alfred-labs/memory-client"),
  workspaceImporter = () => import(new URL("../../memory-client/src/index.js", import.meta.url))
} = {}) {
  let clientModule;
  try {
    clientModule = await packageImporter();
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" || !String(error.message).includes("@alfred-labs/memory-client")) throw error;
    clientModule = await workspaceImporter();
  }
  const { createMemoryClient } = clientModule;
  return createMemoryClient(config);
}

export async function runMemoryMcpCli({ env = process.env, stderr = process.stderr } = {}) {
  try {
    const config = readMemoryMcpConfigFromEnv(env);
    const memoryClient = await createMemoryClientFromConfig(config);
    await runStandaloneMcpStdio({ memoryClient });
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
