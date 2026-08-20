import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(here, "..", "migrations");
const postgresUrl = process.env.ALFRED_TEST_POSTGRES_URL;

function postgresMigrationFiles() {
  return readdirSync(migrationsDir)
    .filter((file) => /^\d+_.*\.sql$/.test(file) && !file.endsWith(".sqlite.sql"))
    .sort();
}

test("Postgres migrations do not contain SQLite-only SQL", () => {
  const files = postgresMigrationFiles();

  assert.ok(files.length > 0, "expected at least one Postgres migration");

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    assert.doesNotMatch(sql, /\bstrftime\s*\(/i, `${file} uses SQLite strftime()`);
    assert.doesNotMatch(sql, /\bBLOB\b/i, `${file} uses SQLite BLOB instead of PostgreSQL BYTEA`);
  }
});

test("Postgres migrations apply twice to a real database", {
  skip: postgresUrl ? false : "ALFRED_TEST_POSTGRES_URL not set"
}, async () => {
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: postgresUrl });
  await client.connect();

  try {
    for (let pass = 0; pass < 2; pass += 1) {
      for (const file of postgresMigrationFiles()) {
        const sql = readFileSync(join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    }

    const columns = await client.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (table_name, column_name) IN (
          ('tenant_email_verifications', 'created_at'),
          ('tenant_recoveries', 'created_at'),
          ('memory_embeddings', 'embedding')
        )
    `);
    const types = new Map(columns.rows.map((row) => [
      `${row.table_name}.${row.column_name}`,
      row.data_type
    ]));

    assert.equal(types.get("tenant_email_verifications.created_at"), "timestamp with time zone");
    assert.equal(types.get("tenant_recoveries.created_at"), "timestamp with time zone");
    assert.equal(types.get("memory_embeddings.embedding"), "bytea");
  } finally {
    await client.end();
  }
});
