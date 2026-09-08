#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const installerPath = join(projectRoot, "install.sh");

export function run(args, env = process.env) {
  const reviewedRuntime = existsSync(join(projectRoot, "runtime-manifest.json"));
  const packagedByHomebrew = env.ALFRED_DISTRIBUTION === "homebrew" || reviewedRuntime;
  const installerArgs = [...args];
  if (packagedByHomebrew) {
    installerArgs.push(`--path=${projectRoot}`, "--no-clone");
  }

  const childEnv = { ...env };
  if (reviewedRuntime) childEnv.ALFRED_INSTALL_TUI_BACKEND = "node";
  if (args.length === 0) childEnv.ALFRED_INSTALL_FORCE_TUI = "1";

  const result = spawnSync("sh", [installerPath, ...installerArgs], {
    env: childEnv,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
