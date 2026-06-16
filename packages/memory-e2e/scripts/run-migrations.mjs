#!/usr/bin/env node
// Run Alfred Memory SQL migrations against PostgreSQL using the pg package.
// This is a fallback when psql is not installed locally.

import fs from "node:fs";
import path from "node:path";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const { default: pgModule } = await import("pg");
const Pool = pgModule.Pool;
const pool = new Pool({ connectionString: databaseUrl });

const migrationsDir = process.argv[2] ?? "../../memory/migrations";
const resolvedDir = path.isAbsolute(migrationsDir)
  ? migrationsDir
  : path.resolve(process.cwd(), migrationsDir);

for (const file of fs.readdirSync(resolvedDir).sort()) {
  if (!file.endsWith(".sql")) continue;
  const text = fs.readFileSync(path.join(resolvedDir, file), "utf8");
  console.log("Applying", file);
  await pool.query(text);
}

await pool.end();
console.log("Migrations applied.");
