#!/usr/bin/env node
// Manual smoke helper for ChatGPT Actions → Memory API path.
// It exercises the same OpenAPI schema operations that a Custom GPT would call.
// The public HTTPS URL must be set in MEMORY_API_BASE_URL.

import { createMemoryClient } from "@alfred-labs/memory-client";

const baseUrl = process.env.MEMORY_API_BASE_URL;
if (!baseUrl) {
  console.error("ERROR: MEMORY_API_BASE_URL must point to the public HTTPS tunnel.");
  process.exit(1);
}
const apiKey = process.env.MEMORY_API_KEY ?? "local-test-key";

async function main() {
  const client = createMemoryClient({ baseUrl, apiKey });

  const created = await client.createMemory({
    type: "fact",
    content: "ChatGPT Actions can reach Alfred Memory through a public HTTPS tunnel.",
    source: "e2e-smoke-chatgpt",
    tags: ["e2e", "chatgpt"],
    namespace: "project:e2e"
  });
  console.log("created", created.id);

  const listed = await client.listMemories({ namespace: "project:e2e", limit: 10 });
  if (!listed.items.some((m) => m.id === created.id)) {
    throw new Error("Created memory was not listed.");
  }
  console.log("list ok");

  await client.deleteMemory(created.id);
  console.log("deleted");
  console.log("ChatGPT Actions smoke path OK.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
