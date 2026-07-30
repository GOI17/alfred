#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const entrypoint = resolve(root, "src/installer-opentui.mjs");
const outputDirectory = resolve(root, "dist");
const requestedTargets = (process.env.ALFRED_OPENTUI_TARGETS || process.env.ALFRED_OPENTUI_TARGET || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const targets = requestedTargets.length
  ? requestedTargets
  : ["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-arm64", "bun-linux-x64"];

mkdirSync(outputDirectory, { recursive: true });

for (const target of targets) {
  if (!/^bun-(darwin|linux)-(arm64|x64)$/.test(target)) throw new Error(`unsupported standalone target: ${target}`);
  const asset = `alfred-installer-tui-${target.slice(4)}`;
  const outfile = resolve(outputDirectory, asset);
  const result = await Bun.build({
    entrypoints: [entrypoint],
    minify: true,
    sourcemap: "none",
    compile: {
      target,
      outfile
    },
    define: {
      "process.env.OPENTUI_LIBC": JSON.stringify("glibc")
    }
  });
  if (!result.success) throw new AggregateError(result.logs, `OpenTUI standalone build failed for ${target}`);
  chmodSync(outfile, 0o755);
  const digest = createHash("sha256").update(readFileSync(outfile)).digest("hex");
  writeFileSync(`${outfile}.sha256`, `${digest}  ${basename(outfile)}\n`, { mode: 0o644 });
}
