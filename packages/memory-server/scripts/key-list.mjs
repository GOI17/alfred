#!/usr/bin/env node
import {
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
  const tenant_id = args.tenant || args._?.[0];
  if (!tenant_id) {
    process.stderr.write("Required: --tenant <tenant_id> [--include-revoked]\n");
    return 2;
  }
  const registry = await openRegistry();
  try {
    const userService = createUserService({ store: registry.users });
    const keys = await userService.listApiKeys(tenant_id, { includeRevoked: !!args["include-revoked"] });
    process.stdout.write(JSON.stringify({ ok: true, tenant_id, keys, registry_path: registry.dbPath }, null, 2) + "\n");
    return 0;
  } finally {
    registry.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await run(process.argv.slice(2)));
}
