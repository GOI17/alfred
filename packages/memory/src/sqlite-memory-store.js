// SQLite-backed memory store. Parity with the in-memory + Postgres stores.
//
// Uses node:sqlite (built-in since Node 22). One DB file per call. WAL mode is
// enabled to allow concurrent readers from multiple processes (e.g. opencode
// and Codex reading the same tenant SQLite file).
//
// Not yet shipped: write-side concurrent access from multiple processes is
// handled by the SQLite busy_timeout; cross-process deadlocks are uncommon
// because most agents issue reads. Writes are serialized by SQLite.

import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sqliteMigrationsDir = resolve(here, "..", "migrations", "sqlite");

const ALLOWED_TYPES = new Set(["preference", "fact", "decision", "workflow", "project", "correction", "source"]);
const TENANT_PREFIX = "usr_m_";

function toRow(row) {
  if (!row) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    namespace: row.namespace,
    projectId: row.project_id ?? undefined,
    type: row.type,
    content: row.content,
    tags: row.tags ? JSON.parse(row.tags) : [],
    source: row.source,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
    attribution: row.attribution ? JSON.parse(row.attribution) : undefined,
    confidence: row.confidence === null ? undefined : Number(row.confidence),
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString()
  };
}

function applyWhere(where, values, options) {
  if (options.type) { values.push(options.type); where.push(`type = ?`); }
  if (options.namespace) { values.push(options.namespace); where.push(`namespace = ?`); }
  if (options.projectId) { values.push(options.projectId); where.push(`project_id = ?`); }
  if (options.tag) { values.push(options.tag); where.push(`EXISTS (SELECT 1 FROM json_each(tags) WHERE value = ?)`); }
  if (options.harness) { values.push(options.harness); where.push(`json_extract(attribution, '$.harness') = ?`); }
}

export function createSqliteMemoryStore(client) {
  if (!client || typeof client.exec !== "function") {
    throw new TypeError("createSqliteMemoryStore requires a node:sqlite DatabaseSync.");
  }

  client.exec("PRAGMA journal_mode = WAL;");
  client.exec("PRAGMA foreign_keys = ON;");
  client.exec("PRAGMA busy_timeout = 5000;");

  return {
    async create(memory) {
      client.prepare(`
        INSERT INTO alfred_memories (
          id, user_id, namespace, project_id, type, content, tags, source, metadata, attribution, confidence, expires_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        memory.id,
        memory.userId,
        memory.namespace,
        memory.projectId ?? null,
        memory.type,
        memory.content,
        JSON.stringify(memory.tags ?? []),
        memory.source,
        JSON.stringify(memory.metadata ?? {}),
        memory.attribution === undefined ? null : JSON.stringify(memory.attribution),
        memory.confidence ?? null,
        memory.expiresAt ?? null,
        memory.createdAt,
        memory.updatedAt
      );
      const row = client.prepare("SELECT * FROM alfred_memories WHERE id = ?").get(memory.id);
      return toRow(row);
    },

    async list(userId, options) {
      const where = ["user_id = ?"];
      const values = [userId];
      applyWhere(where, values, options);
      values.push(options.limit, options.offset);
      const rows = client.prepare(`
        SELECT * FROM alfred_memories
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(...values);
      const countRow = client.prepare(`
        SELECT COUNT(*) AS total_count FROM alfred_memories WHERE ${where.join(" AND ")}
      `).get(...values.slice(0, values.length - 2));
      return {
        items: rows.map(toRow),
        pagination: { limit: options.limit, offset: options.offset, total: countRow.total_count }
      };
    },

    async search(userId, options) {
      const where = ["user_id = ?"];
      const values = [userId];
      applyWhere(where, values, options);
      const likePattern = `%${options.q}%`;
      where.push(`(content LIKE ? OR source LIKE ? OR type LIKE ? OR namespace LIKE ? OR project_id LIKE ? OR tags LIKE ? OR metadata LIKE ? OR attribution LIKE ?)`);
      for (let i = 0; i < 8; i += 1) values.push(likePattern);
      values.push(options.limit, options.offset);
      const rows = client.prepare(`
        SELECT * FROM alfred_memories
        WHERE ${where.join(" AND ")}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `).all(...values);
      // Count without the search predicate
      const countWhere = where.filter((w) => !w.startsWith("(content"));
      const countValues = values.slice(0, 1); // userId only — applyWhere pushed the rest
      // Re-derive properly by counting WHERE without the OR clause.
      const userWhere = where.filter((w) => !w.startsWith("(content") && !w.includes("OR"));
      // Cheaper: just count matches of the user predicate set
      const ow = ["user_id = ?"];
      const ov = [userId];
      applyWhere(ow, ov, options);
      const countRow = client.prepare(`
        SELECT COUNT(*) AS total_count FROM alfred_memories WHERE ${ow.join(" AND ")}
      `).get(...ov);
      return {
        items: rows.map(toRow),
        pagination: { limit: options.limit, offset: options.offset, total: countRow.total_count }
      };
    },

    async get(userId, id) {
      const row = client.prepare("SELECT * FROM alfred_memories WHERE user_id = ? AND id = ?").get(userId, id);
      return toRow(row);
    },

    async update(userId, id, patch) {
      const editable = {
        type: "type",
        content: "content",
        tags: "tags",
        source: "source",
        projectId: "project_id",
        metadata: "metadata",
        attribution: "attribution",
        confidence: "confidence",
        expiresAt: "expires_at",
        updatedAt: "updated_at"
      };
      const cols = [];
      const values = [];
      for (const [field, column] of Object.entries(editable)) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
          let v = patch[field];
          if (field === "tags") v = JSON.stringify(v ?? []);
          if (field === "metadata") v = JSON.stringify(v ?? {});
          if (field === "attribution") v = v === null ? null : JSON.stringify(v);
          cols.push(`${column} = ?`);
          values.push(v);
        }
      }
      if (cols.length === 0) {
        const row = client.prepare("SELECT * FROM alfred_memories WHERE user_id = ? AND id = ?").get(userId, id);
        return toRow(row);
      }
      values.push(userId, id);
      client.prepare(`
        UPDATE alfred_memories SET ${cols.join(", ")}
         WHERE user_id = ? AND id = ?
      `).run(...values);
      const row = client.prepare("SELECT * FROM alfred_memories WHERE user_id = ? AND id = ?").get(userId, id);
      return toRow(row);
    },

    async delete(userId, id) {
      const result = client.prepare("DELETE FROM alfred_memories WHERE user_id = ? AND id = ?").run(userId, id);
      return result.changes > 0;
    }
  };
}

export function openSqliteMemoryStore(dbPath, { fromMigrations = true } = {}) {
  if (!dbPath || typeof dbPath !== "string") {
    throw new TypeError("openSqliteMemoryStore requires a string dbPath.");
  }
  const db = new DatabaseSync(dbPath);
  // Apply additive, idempotent SQLite migrations.
  if (fromMigrations) {
    const m1 = readFileSync(join(sqliteMigrationsDir, "001_memory.sqlite.sql"), "utf8");
    db.exec(m1);
    const m2 = readFileSync(join(sqliteMigrationsDir, "002_memory_attribution.sqlite.sql"), "utf8");
    const columns = db.prepare("PRAGMA table_info(alfred_memories)").all().map((row) => row.name);
    if (!columns.includes("attribution")) db.exec(m2);
  }
  return createSqliteMemoryStore(db);
}
