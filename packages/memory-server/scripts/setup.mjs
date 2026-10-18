#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const installerPath = join(projectRoot, "install.sh");

export function bundledSetupBinary(root, platform = process.platform, architecture = process.arch) {
  const arch = architecture === "x64" ? "amd64" : architecture;
  if (!["darwin", "linux"].includes(platform) || !["amd64", "arm64"].includes(arch)) throw new Error("The bundled setup TUI does not support this platform.");
  const target = `${platform}-${arch}`;
  const directory = join(root, "packages/setup-tui/dist");
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const entry = manifest.binaries?.[target];
  if (manifest.schema !== "alfred.setup.binaries/v1" || entry?.file !== `alfred-setup-${target}` || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Invalid bundled setup manifest.");
  const path = join(directory, entry.file), stat = lstatSync(path), bytes = readFileSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || !(stat.mode & 0o111) || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) throw new Error("Bundled setup binary integrity check failed.");
  const matchingHeader = platform === "darwin"
    ? bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === (arch === "arm64" ? 0x0100000c : 0x01000007)
    : bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === (arch === "arm64" ? 183 : 62);
  if (!matchingHeader) throw new Error("Bundled setup binary targets a different platform.");
  return path;
}

export function run(args, env = process.env, terminal = { interactive: process.stdin.isTTY && process.stderr.isTTY }) {
  const legacy = args.includes("--legacy-ui") || Boolean(env.ALFRED_INSTALL_APP_TUI_EVENTS || env.ALFRED_INSTALL_APP_TUI_SCRIPT) || env.ALFRED_INSTALL_TUI_BACKEND === "node";
  args = args.filter(arg => arg !== "--legacy-ui");
  if (args.length === 0 && terminal.interactive && !legacy) {
    let binary;
    try { binary = bundledSetupBinary(projectRoot); }
    catch { process.stderr.write("The bundled Go setup TUI is missing or invalid. Reinstall Alfred, or use explicit setup flags for a preview.\n"); return 1; }
    const result = spawnSync(binary, ["--backend-node", process.execPath, "--backend-script", join(projectRoot, "scripts/setup/bridge.mjs")], { env: { ...env }, stdio: "inherit" });
    if (result.error) { process.stderr.write("The bundled Go setup TUI could not start.\n"); return 1; }
    return result.status ?? 1;
  }
  const packagedByHomebrew = env.ALFRED_DISTRIBUTION === "homebrew";
  const installerArgs = [...args];
  if (packagedByHomebrew) {
    installerArgs.push(`--path=${projectRoot}`, "--no-clone");
  }

  const childEnv = { ...env };
  // Explicit automation/legacy and no-TTY paths remain local and deterministic.
  if (packagedByHomebrew) childEnv.ALFRED_INSTALL_TUI_BACKEND = "node";
  if (args.length === 0 && legacy) childEnv.ALFRED_INSTALL_FORCE_TUI = "1";
  else if (!terminal.interactive) delete childEnv.ALFRED_INSTALL_FORCE_TUI;

  const result = spawnSync("sh", [installerPath, ...installerArgs], {
    env: childEnv,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
