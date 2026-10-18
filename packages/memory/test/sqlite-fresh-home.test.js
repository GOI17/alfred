import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryService, openSqliteMemoryStore } from "../src/index.js";

test("fresh tenant database creates its missing parent and persists real content", async t => {
  const root = mkdtempSync(join(tmpdir(), "alfred-new-home-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dbPath = join(root, ".alfred", "tenants", "first.sqlite");
  assert.equal(existsSync(join(root, ".alfred")), false);
  const service = createMemoryService({ store: openSqliteMemoryStore(dbPath) });
  const memory = await service.createMemory("tenant-first", { type: "fact", content: "A fresh install can persist memories.", source: "test" });
  assert.equal(existsSync(dbPath), true);
  assert.equal((await service.getMemory("tenant-first", memory.id)).content, memory.content);
});
