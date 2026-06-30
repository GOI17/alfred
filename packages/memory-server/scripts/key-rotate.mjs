#!/usr/bin/env node
import {
  createUserService,
  createTenantService
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
    process.stderr.write("Required: --tenant <tenant_id> [--label <text>]\n");
    return 2;
  }
  const label = args.label || null;
  const registry = await openRegistry();
  try {
    const tenant = await registry.tenants.getTenant(tenant_id);
    if (!tenant) {
      process.stderr.write(`Tenant not found: ${tenant_id}\n`);
      return 1;
    }
    const userService = createUserService({ store: registry.users });
    const result = await userService.rotateApiKey({ tenant_id, label });
    process.stdout.write(JSON.stringify({
      ok: true,
      api_key: result.apiKey,
      revoked: result.revokedCount,
      tenant_id,
      registry_path: registry.dbPath
    }, null, 2) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write(`Rotate failed: ${err.message}\n`);
    return 1;
  } finally {
    registry.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await run(process.argv.slice(2)));
}
