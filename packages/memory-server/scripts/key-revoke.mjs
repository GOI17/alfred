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
  const keyId = args.key || args._?.[0];
  if (!keyId) {
    process.stderr.write("Required: --key <key_id> [--reason <text>]\n");
    return 2;
  }
  const registry = await openRegistry();
  try {
    const userService = createUserService({ store: registry.users });
    const r = await userService.revokeApiKey(keyId, { reason: args.reason || null });
    process.stdout.write(JSON.stringify({ ok: true, already_revoked: r.already_revoked, key: r.key, registry_path: registry.dbPath }, null, 2) + "\n");
    return 0;
  } catch (err) {
    process.stderr.write(`Revoke failed: ${err.message}\n`);
    return 1;
  } finally {
    registry.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(await run(process.argv.slice(2)));
}
