import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const sqlite = await import("node:sqlite");
const { migrateSqliteToSqlite, dumpSqliteToPostgresSql } = await import("../src/migrate/sqlite-migrator.js");

function freshDir() {
  return mkdtempSync(join(tmpdir(), "alfred-mig-"));
}

const ALFRED_MEMORY_SCHEMA_SQLITE = `
  CREATE TABLE IF NOT EXISTS alfred_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    namespace TEXT NOT NULL DEFAULT 'personal',
    project_id TEXT,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    confidence REAL,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

function writeThreeMemories(dbPath) {
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec(ALFRED_MEMORY_SCHEMA_SQLITE);
  db.exec(`
    INSERT INTO alfred_memories (id, user_id, namespace, type, content, tags, source, metadata, created_at, updated_at)
    VALUES ('id_a', 'usr_x', 'personal', 'fact', 'mem A', '["a"]', 'test', '{}', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    INSERT INTO alfred_memories (id, user_id, namespace, type, content, tags, source, metadata, created_at, updated_at)
    VALUES ('id_b', 'usr_x', 'work', 'decision', 'mem B', '["b","x"]', 'test', '{}', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z');
  `);
  db.close();
}

test("sqlite-to-sqlite: copies all rows", async () => {
  const dir = freshDir();
  try {
    const src = join(dir, "src.sqlite");
    const dst = join(dir, "dst.sqlite");
    writeThreeMemories(src);

    const res = await migrateSqliteToSqlite({ srcPath: src, dstPath: dst });
    assert.equal(res.rows, 2);

    const db = new sqlite.DatabaseSync(dst, { readOnly: true });
    const rows = db.prepare("SELECT id, content, tags FROM alfred_memories ORDER BY id").all();
    db.close();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].id, "id_a");
    assert.equal(rows[0].content, "mem A");
    assert.equal(rows[1].id, "id_b");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite-to-sqlite: rejects missing source", async () => {
  const dir = freshDir();
  try {
    await assert.rejects(
      () => migrateSqliteToSqlite({ srcPath: join(dir, "missing.sqlite"), dstPath: join(dir, "out.sqlite") }),
      /Source DB does not exist/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sqlite-to-postgres: emits a valid SQL dump", async () => {
  const dir = freshDir();
  try {
    const src = join(dir, "src.sqlite");
    writeThreeMemories(src);

    const out = join(dir, "dump.sql");
    const res = await dumpSqliteToPostgresSql({ srcPath: src, outPath: out, tenantId: "usr_abc" });
    assert.equal(res.rows, 2);
    assert.ok(existsSync(out));
    const text = readFileSync(out, "utf8");
    assert.match(text, /BEGIN;/);
    assert.match(text, /COMMIT;/);
    assert.match(text, /INSERT INTO alfred_memory_users/);
    assert.match(text, /INSERT INTO alfred_memories/);
    assert.match(text, /'usr_abc'/);
    assert.match(text, /mem A/);
    assert.match(text, /mem B/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
