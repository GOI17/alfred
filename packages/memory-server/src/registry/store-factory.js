// Tiny factory so every CLI command uses the same SQLite-backed registry
// at the same canonical path. Defaults honor ALFRED_MEMORY_REGISTRY env.

import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const DEFAULT_REGISTRY_PATH = () => process.env.ALFRED_MEMORY_REGISTRY ?? `${process.env.HOME ?? "/tmp"}/.alfred/registry.sqlite`;

export async function openRegistry({ dbPath } = {}) {
  const path = dbPath || DEFAULT_REGISTRY_PATH();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try { mkdirSync(dir, { recursive: true }); } catch (err) {
      if (err.code !== "EEXIST") throw err;
    }
  }
  const { createSqliteRegistryStore } = await import("./sqlite-registry-store.js");
  return createSqliteRegistryStore({ dbPath: path });
}

export function defaultRegistryPath() {
  return DEFAULT_REGISTRY_PATH();
}
