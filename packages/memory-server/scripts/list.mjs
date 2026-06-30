#!/usr/bin/env node
import { createTenantService } from "../../memory/src/index.js";
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
  const kind = args.kind || undefined;
  const backend = args.backend || args.storage || undefined;
  const limit = args.limit ? Number(args.limit) : undefined;
  const offset = args.offset ? Number(args.offset) : undefined;

  const registry = await openRegistry();
  try {
    const tenantService = createTenantService({ store: registry.tenants });
    const result = await tenantService.listTenants({ kind, storage_backend: backend, limit, offset });
    process.stdout.write(JSON.stringify({ ...result, registry_path: registry.dbPath }, null, 2) + "\n");
    return 0;
  } finally {
    registry.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await run(process.argv.slice(2)));
}
