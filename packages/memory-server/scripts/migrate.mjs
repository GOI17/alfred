#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { openRegistry } from "../src/registry/store-factory.js";
import {
  migrateSqliteToSqlite,
  dumpSqliteToPostgresSql
} from "../src/migrate/sqlite-migrator.js";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) { out[k] = true; } else { out[k] = v; i += 1; }
    } else { out._.push(a); }
  }
  return out;
}

export async function run(argv = [], env = process.env) {
  const args = parseArgs(argv);
  const tenantId = args.tenant || args._?.[0];
  if (!tenantId) {
    process.stderr.write("Required: --tenant <tenant_id>\n");
    process.stderr.write("           --from (sqlite|postgres)\n");
    process.stderr.write("           --to   (sqlite|postgres)\n");
    process.stderr.write("           --src  <path-or-url>\n");
    process.stderr.write("           --dst  <path-or-url>\n");
    process.stderr.write("           --out  <path for psql SQL dump when to=postgres>\n");
    return 2;
  }
  const from = args.from;
  const to = args.to;
  const src = args.src;
  const dst = args.dst;
  const out = args.out;

  if (!from || !to) {
    process.stderr.write("Required: --from and --to\n");
    return 2;
  }
  if (from === "sqlite" && to === "sqlite") {
    if (!src || !dst) {
      process.stderr.write("sqlite-to-sqlite requires --src and --dst paths.\n");
      return 2;
    }
    const res = await migrateSqliteToSqlite({ srcPath: src, dstPath: dst });
    process.stdout.write(JSON.stringify({ ok: true, op: "sqlite->sqlite", ...res }, null, 2) + "\n");
    return 0;
  }
  if (from === "sqlite" && to === "postgres") {
    // Generate a Postgres SQL dump. Apply it manually with psql or a CI step.
    if (!src) { process.stderr.write("--src required (source sqlite file path)\n"); return 2; }
    if (!out) { process.stderr.write("--out required (output sql file path for psql)\n"); return 2; }
    const res = await dumpSqliteToPostgresSql({ srcPath: src, outPath: out, tenantId });
    process.stdout.write(JSON.stringify({
      ok: true,
      op: "sqlite->postgres (sql dump)",
      hint: "Apply with: psql \"$TARGET\" -f " + out,
      ...res
    }, null, 2) + "\n");
    return 0;
  }
  if (from === "postgres" && to === "sqlite") {
    process.stderr.write("postgres->sqlite migration is not bundled in MVP. Use psql to dump the Postgres tenant to SQL, then load into a fresh SQLite file.\n");
    return 0;
  }
  process.stderr.write(`Unsupported migration: ${from} -> ${to}\n`);
  return 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await run(process.argv.slice(2)));
}
