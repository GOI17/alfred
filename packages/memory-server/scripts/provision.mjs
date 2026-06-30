#!/usr/bin/env node
import {
  createTenantService,
  createUserService
} from "../../memory/src/index.js";
import { openRegistry } from "../src/registry/store-factory.js";

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
  const tenant_kind = args.kind || args._?.[0];
  const storage_backend = args.backend || args.storage;
  const display_name = args.name;
  const db_path = args["db-path"];
  const db_connection = args["db-connection"];

  if (!tenant_kind || !storage_backend || !display_name) {
    process.stderr.write("Required: --kind <kind> --backend <sqlite|postgres> --name <name>\n");
    process.stderr.write("  --db-path <path>      (required when --backend=sqlite)\n");
    process.stderr.write("  --db-connection <url> (required when --backend=postgres)\n");
    return 2;
  }

  const registry = await openRegistry();
  try {
    const tenantService = createTenantService({ store: registry.tenants });
    const tenant = await tenantService.provisionTenant({
      kind: tenant_kind,
      storage_backend,
      display_name,
      db_path: db_path ?? null,
      db_connection: db_connection ?? null
    });
    process.stdout.write(JSON.stringify({ ok: true, tenant, registry_path: registry.dbPath }, null, 2) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write(`Provision failed: ${err.message}\n`);
    if (err.details) process.stderr.write(JSON.stringify(err.details, null, 2) + "\n");
    return 1;
  } finally {
    registry.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await run(process.argv.slice(2)));
}
