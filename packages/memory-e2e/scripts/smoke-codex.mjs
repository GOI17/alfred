#!/usr/bin/env node
// Minimal smoke test for the Codex/MCP → Memory API path.
// This is intentionally lightweight; full E2E requires an agent runtime.

import { createMemoryClient } from "@alfred-labs/memory-client";

const baseUrl = process.env.MEMORY_API_BASE_URL ?? "http://localhost:8080";
const apiKey = process.env.MEMORY_API_KEY ?? "local-test-key";

async function main() {
  const client = createMemoryClient({ baseUrl, apiKey });

  const created = await client.createMemory({
    type: "preference",
    content: "Codex prefers concise responses.",
    source: "e2e-smoke-codex",
    tags: ["e2e", "codex"],
    namespace: "project:e2e"
  });
  console.log("created", created.id);

  const found = await client.searchMemories({
    q: "concise responses",
    namespace: "project:e2e"
  });
  if (!found.items.some((m) => m.id === created.id)) {
    throw new Error("Created memory was not found by search.");
  }
  console.log("search ok");

  await client.deleteMemory(created.id);
  console.log("deleted");
  console.log("Codex/MCP smoke path OK.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
