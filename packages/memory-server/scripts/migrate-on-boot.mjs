#!/usr/bin/env node
// One-shot schema bootstrap for the SQLite-backed alfred_registry.
// Idempotent: running it on every container start is safe (CREATE IF NOT EXISTS).
//
// For Postgres tenants, the registry's applySchema() is also called by
// createSqliteRegistryStore() on first open, so the SQLite side is the
// canonical source of truth for the SaaS registry. The per-tenant
// Postgres schemas are created lazily by the bootstrap flow
// (POST /console/api/bootstrap → createSchemaProvisioner).
//
// For deployments that want to pre-provision a Postgres registry DB
// (e.g. ALFRED_SAAS_DATABASE_URL), this script also runs the
// 005/006/007/008/009 migrations against it so the SaaS flow can run.

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const MIG_DIR = resolve(here, "..", "migrations");
const DATA_DIR = process.env.ALFRED_MEMORY_REGISTRY
  ? dirname(process.env.ALFRED_MEMORY_REGISTRY)
  : (process.env.HOME ?? "/tmp") + "/.alfred";

function log(msg) {
  process.stderr.write(`[migrate-on-boot] ${msg}\n`);
}

async function main() {
  // 1. Ensure data directory exists for the SQLite registry.
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
    log(`created data dir: ${DATA_DIR}`);
  }

  // 2. Apply SQLite registry schema. This is a no-op on every run after the
  //    first because the SQL is all CREATE TABLE IF NOT EXISTS / CREATE INDEX
  //    IF NOT EXISTS. The schema is loaded from sqlite_registry.sql which is
  //    the same file the runtime uses via createSqliteRegistryStore().
  const sqliteSchema = readFileSync(join(MIG_DIR, "sqlite_registry.sql"), "utf8");
  log(`applying sqlite registry schema (${sqliteSchema.length} bytes)`);
  // Lazy-load the registry store so we don't pay the import cost in CLI
  // commands that don't need it.
  const { createSqliteRegistryStore } = await import("../src/registry/sqlite-registry-store.js");
  const registry = await createSqliteRegistryStore({ applyMigrations: true });
  // Touch a contract method to force the schema to be applied (the factory
  // already runs applySchema internally, but we want a visible side effect).
  const tenants = await registry.tenants.listTenants({});
  log(`sqlite registry ready (${tenants.items.length} tenants)`);
  registry.close();

  // 3. If ALFRED_SAAS_DATABASE_URL is set, attempt to apply the Postgres-side
  //    migrations (005-009). This is opt-in: a deployment that only uses
  //    SQLite mode can skip this entirely.
  const saasUrl = process.env.ALFRED_SAAS_DATABASE_URL;
  if (!saasUrl) {
    log("ALFRED_SAAS_DATABASE_URL not set, skipping Postgres migrations");
    return 0;
  }

  let pg;
  try {
    pg = await import("pg");
  } catch (err) {
    log(`pg module not installed; cannot apply Postgres migrations. ` +
        `Install 'pg' or unset ALFRED_SAAS_DATABASE_URL. (${err.message})`);
    return 0;
  }

  const client = new pg.Client({ connectionString: saasUrl });
  try {
    await client.connect();
    log(`connected to ALFRED_SAAS_DATABASE_URL`);
    const saasMigFiles = readdirSync(MIG_DIR)
      .filter((f) => /^\d+_.*\.sql$/.test(f) && !f.endsWith(".sqlite.sql"))
      .sort();
    for (const f of saasMigFiles) {
      const sql = readFileSync(join(MIG_DIR, f), "utf8");
      log(`applying ${f} (${sql.length} bytes)`);
      await client.query(sql);
    }
    log(`postgres migrations applied (${saasMigFiles.length} files)`);
    return 0;
  } catch (err) {
    log(`postgres migration failed: ${err.message}`);
    return 1;
  } finally {
    try { await client.end(); } catch {}
  }
}

main().then((code) => process.exit(code ?? 0)).catch((err) => {
  process.stderr.write(`[migrate-on-boot] fatal: ${err.message}\n`);
  process.exit(1);
});
