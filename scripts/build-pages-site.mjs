#!/usr/bin/env node

import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "site");
const outputDir = resolve(root, process.env.SITE_OUTPUT_DIR ?? "dist/cloudflare-pages");
const stageDir = join(dirname(outputDir), `.cloudflare-pages-${process.pid}-${Date.now()}`);

function normalizeBasePath(value) {
  const raw = (value || "/").trim();
  if (raw.includes("?") || raw.includes("#")) {
    throw new Error("SITE_BASE_PATH must be a URL path without query or fragment");
  }
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withLeadingSlash === "/" ? "/" : `${withLeadingSlash.replace(/\/+$/, "")}/`;
}


async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  }));
  return nested.flat();
}

async function publishAtomically(stage, target) {
  const backup = `${target}.previous`;
  await rm(backup, { recursive: true, force: true });
  let hadPrevious = false;
  try {
    await rename(target, backup);
    hadPrevious = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  try {
    await rename(stage, target);
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadPrevious) await rename(backup, target);
    throw error;
  }
}

const basePath = normalizeBasePath(process.env.SITE_BASE_PATH ?? "/");

if (outputDir === root || !outputDir.startsWith(`${root}${sep}`)) {
  throw new Error("SITE_OUTPUT_DIR must stay inside the Alfred repository");
}

await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });

try {
  await cp(sourceDir, stageDir, {
    recursive: true,
    filter(source) {
      const rel = relative(sourceDir, source);
      return rel !== "README.md" && rel !== ".nojekyll";
    }
  });

  const textFiles = (await listFiles(stageDir)).filter((file) => /\.(?:html|css|txt)$/.test(file));
  for (const file of textFiles) {
    const current = await readFile(file, "utf8");
    const rewritten = current.replaceAll("/alfred/", basePath);
    if (rewritten !== current) await writeFile(file, rewritten);
  }

  await publishAtomically(stageDir, outputDir);
} catch (error) {
  await rm(stageDir, { recursive: true, force: true });
  throw error;
}

process.stdout.write(`${JSON.stringify({
  output: relative(root, outputDir),
  base_path: basePath,
  memory_ui: "local-start-instructions",
  provider_calls: 0
})}\n`);
