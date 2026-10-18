import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { createOpenapiRouter } from "../src/openapi-router.js";
import { createInMemoryStore, createMemoryService } from "../../memory/src/index.js";

test("packaged MCP keyword route returns tenant-scoped search results instead of treating search as an ID", async t => {
  const service = createMemoryService({ store: createInMemoryStore() });
  const own = await service.createMemory("a", { type: "fact", content: "Unique packaged result", source: "test", projectId: "project-a" });
  await service.createMemory("b", { type: "fact", content: "Unique other tenant", source: "test" });
  await service.createMemory("a", { type: "fact", content: "Unique other project", source: "test", projectId: "project-b" });
  const router = createOpenapiRouter({ projectRoot: process.cwd(), userService: { async resolveApiKey(key) { return key === "fixture" ? { tenant_id: "a" } : null; } }, getMemoryService: async () => service });
  const server = createServer(router);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/memories/search?q=Unique&limit=1&projectId=project-a`;
  assert.equal((await fetch(url)).status, 401);
  const response = await fetch(url, { headers: { "x-api-key": "fixture" } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.items.map(item => item.id), [own.id]);
  assert.equal(result.pagination.total, 1);
});
