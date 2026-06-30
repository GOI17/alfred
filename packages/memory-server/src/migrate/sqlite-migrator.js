// SQLite-to-SQLite migration. Copies all rows from one tenant DB to another.
//
// Usage (CLI):
//   alfred migrate --tenant=<id> --from=sqlite --to=sqlite \
//                 --src=<old.sqlite> --dst=<new.sqlite>
//
// In production this is the same row copy but with schema versioning.
// The copied dataset preserves ids, content, tags, source, metadata, expires_at.
// `confidence` (REAL) and `created_at`/`updated_at` are copied verbatim.

import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, rename } from "node:fs";
import { dirname } from "node:path";

const SQLITE_MEMORY_COLUMNS = [
  "id","user_id","namespace","project_id","type","content","tags","source",
  "metadata","confidence","expires_at","created_at","updated_at"
];

function nowIso() { return new Date().toISOString(); }

export async function migrateSqliteToSqlite({ srcPath, dstPath, allowReplace = true } = {}) {
  if (!srcPath || !dstPath) throw new Error("src and dst paths are required");
  if (!existsSync(srcPath)) throw new Error("Source DB does not exist: " + srcPath);

  if (dstPath !== srcPath && existsSync(dstPath)) {
    if (!allowReplace) throw new Error("Destination DB already exists; pass allowReplace=true");
  }

  const dstDir = dirname(dstPath);
  if (!existsSync(dstDir)) mkdirSync(dstDir, { recursive: true });

  // Read source.
  const src = new DatabaseSync(srcPath);
  let count = 0;
  try {
    const rows = src.prepare(`SELECT ${SQLITE_MEMORY_COLUMNS.join(", ")} FROM alfred_memories`).all();
    src.close();

    // Write to destination, creating tables if needed.
    const dst = new DatabaseSync(dstPath);
    try {
      dst.exec(`
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
      `);
      const insert = dst.prepare(`
        INSERT OR REPLACE INTO alfred_memories (${SQLITE_MEMORY_COLUMNS.join(", ")})
        VALUES (${SQLITE_MEMORY_COLUMNS.map(() => "?").join(", ")})
      `);
      const begin = dst.exec("BEGIN");
      let inserted = 0;
      for (const row of rows) {
        insert.run(...SQLITE_MEMORY_COLUMNS.map((c) => row[c]));
        inserted += 1;
      }
      dst.exec("COMMIT");
      count = inserted;
    } finally {
      dst.close();
    }
  } catch (err) {
    try { src.close(); } catch {}
    throw err;
  }
  return { rows: count, srcPath, dstPath, migratedAt: nowIso() };
}

export async function dumpSqliteToPostgresSql({ srcPath, outPath, tenantId }) {
  // Read all memory rows and emit a Postgres-friendly SQL dump.
  // This is the MVP migration story: ship the SQL and apply it via psql.
  if (!srcPath) throw new Error("src path required");
  if (!outPath) throw new Error("out path required");
  if (!tenantId) throw new Error("tenant id required");
  if (!existsSync(srcPath)) throw new Error("Source DB does not exist: " + srcPath);

  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");
  const dir = dirname(outPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const db = new DatabaseSync(srcPath);
  try {
    const rows = db.prepare(`SELECT ${SQLITE_MEMORY_COLUMNS.join(", ")} FROM alfred_memories`).all();
    db.close();

    const esc = (v) => v === null || v === undefined
      ? "NULL"
      : (typeof v === "string"
          ? "'" + v.replace(/'/g, "''") + "'"
          : typeof v === "boolean"
            ? (v ? "TRUE" : "FALSE")
            : String(v));

    const lines = [];
    lines.push("-- Alfred Memory SQLite -> Postgres migration dump");
    lines.push(`-- Tenant: ${esc(tenantId)}`);
    lines.push(`-- Source: ${srcPath}`);
    lines.push(`-- Generated: ${new Date().toISOString()}`);
    lines.push("");
    lines.push("BEGIN;");
    lines.push(`UPDATE alfred_memory_users SET id = ${esc(tenantId)} WHERE id = ${esc("__missing__")};`);
    lines.push(`INSERT INTO alfred_memory_users (id, api_key_hash) VALUES (${esc(tenantId)}, ${esc("migrated:" + tenantId)}) ON CONFLICT (id) DO NOTHING;`);
    for (const row of rows) {
      const vals = SQLITE_MEMORY_COLUMNS.map((c) => esc(row[c]));
      // user_id corresponds to tenantId on the target.
      vals[1] = esc(tenantId);
      lines.push(`INSERT INTO alfred_memories (${SQLITE_MEMORY_COLUMNS.join(", ")}) VALUES (${vals.join(", ")}) ON CONFLICT (id) DO NOTHING;`);
    }
    lines.push("COMMIT;");

    const sqlText = lines.join("\n") + "\n";
    writeFileSync(outPath, sqlText);
    return { rows: rows.length, outPath, tenantId };
  } catch (err) {
    try { db.close(); } catch {}
    throw err;
  }
}
