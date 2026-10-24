#!/usr/bin/env node

import { createHash, randomBytes } from "node:crypto";
import { readFileSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { compareStableVersions, consumeRuntimeUpgrade } from "../../../scripts/setup/releases.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

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

function upgradedExecutable(execute, env, cwd) {
  const prefixResult = execute("brew", ["--prefix", "GOI17/alfred/alfred"], { env, cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 65536, timeout: 15000 });
  const prefix = typeof prefixResult.stdout === "string" ? prefixResult.stdout.trim() : "";
  if (prefixResult.error || prefixResult.status !== 0 || !isAbsolute(prefix) || /[\r\n\0]/.test(prefix)) throw new Error("Cannot locate the updated Homebrew installation.");
  const canonicalPrefix = realpathSync(prefix), executable = realpathSync(join(prefix, "bin", "alfred"));
  const within = relative(canonicalPrefix, executable), stat = lstatSync(executable);
  if (!within || within.startsWith("..") || isAbsolute(within) || !stat.isFile() || !(stat.mode & 0o111)) throw new Error("Invalid updated Alfred executable.");
  return executable;
}

export function run(args, env = process.env, terminal = { interactive: process.stdin.isTTY && process.stderr.isTTY }, dependencies = {}) {
  const root = dependencies.root ?? projectRoot, execute = dependencies.spawnSync ?? spawnSync;
  const cwd = dependencies.cwd ?? process.cwd(), errorOutput = dependencies.stderr ?? process.stderr;
  const legacy = args.includes("--legacy-ui") || Boolean(env.ALFRED_INSTALL_APP_TUI_EVENTS || env.ALFRED_INSTALL_APP_TUI_SCRIPT) || env.ALFRED_INSTALL_TUI_BACKEND === "node";
  args = args.filter(arg => arg !== "--legacy-ui");
  if (args.length === 0 && terminal.interactive && !legacy) {
    let directory;
    try {
      // Capture all old-runtime metadata before Brew can replace its Cellar files.
      let binary;
      try { binary = bundledSetupBinary(root); } catch { throw new Error("The bundled Go setup TUI is missing or invalid. Reinstall Alfred, or use explicit setup flags for a preview."); }
      const installRoot = realpathSync(root), project = realpathSync(cwd);
      const currentVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
      directory = mkdtempSync(join(realpathSync(tmpdir()), "alfred-setup-upgrade-"));
      const childEnv = { ...env, ALFRED_SETUP_UPGRADE_REQUEST: join(directory, "request.json"), ALFRED_SETUP_UPGRADE_NONCE: randomBytes(32).toString("hex") };
      const result = execute(binary, ["--backend-node", process.execPath, "--backend-script", join(root, "scripts/setup/bridge.mjs")], { cwd: project, env: childEnv, stdio: "inherit" });
      if (result.error) throw new Error("The bundled Go setup TUI could not start.");
      if (result.status !== 20) return result.status ?? 1;
      const request = consumeRuntimeUpgrade({ currentVersion, cwd: project, installRoot, env: childEnv });
      const upgradeEnv = { ...env, HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_INSTALL_CLEANUP: "1" };
      delete upgradeEnv.ALFRED_SETUP_UPGRADE_REQUEST; delete upgradeEnv.ALFRED_SETUP_UPGRADE_NONCE;
      delete upgradeEnv.ALFRED_SETUP_RESUME;
      errorOutput.write(`Updating Alfred ${currentVersion} → ${request.latestVersion} with Homebrew.\n`);
      for (const commandArgs of [["update"], ["upgrade", "GOI17/alfred/alfred"]]) {
        const upgraded = execute("brew", commandArgs, { cwd: project, env: upgradeEnv, stdio: "inherit" });
        if (upgraded.error || upgraded.status !== 0) {
          errorOutput.write("Homebrew did not complete the update. Project integration was not changed. Run setup again to retry.\n");
          return upgraded.status || 1;
        }
      }
      const executable = upgradedExecutable(execute, upgradeEnv, project);
      const versionResult = execute(executable, ["version"], { cwd: project, env: upgradeEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 65536, timeout: 15000 });
      const version = typeof versionResult.stdout === "string" ? /^alfred ((?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8})\.(?:0|[1-9]\d{0,8}))$/.exec(versionResult.stdout.trim())?.[1] : undefined;
      if (versionResult.error || versionResult.status !== 0 || !version || compareStableVersions(version, request.latestVersion) < 0) throw new Error("Homebrew has not installed the reviewed version. Project integration was not changed; try again after the tap is updated.");
      errorOutput.write(`Alfred ${version} is installed. Opening the project update review.\n`);
      const resumed = execute(executable, ["setup"], { cwd: project, env: { ...upgradeEnv, ALFRED_SETUP_RESUME: "1" }, stdio: "inherit" });
      if (resumed.error) throw new Error("Alfred was upgraded, but setup could not restart. Run alfred setup again to review the project integration.");
      return resumed.status ?? 1;
    } catch (error) {
      errorOutput.write(`${error.message}\n`);
      return 1;
    } finally { if (directory) rmSync(directory, { recursive: true, force: true }); }
  }
  const packagedByHomebrew = env.ALFRED_DISTRIBUTION === "homebrew";
  const installerArgs = [...args];
  if (packagedByHomebrew) installerArgs.push(`--path=${root}`, "--no-clone");
  const childEnv = { ...env };
  // Explicit automation/legacy and no-TTY paths remain local and deterministic.
  if (packagedByHomebrew) childEnv.ALFRED_INSTALL_TUI_BACKEND = "node";
  if (args.length === 0 && legacy) childEnv.ALFRED_INSTALL_FORCE_TUI = "1";
  else if (!terminal.interactive) delete childEnv.ALFRED_INSTALL_FORCE_TUI;
  delete childEnv.ALFRED_SETUP_UPGRADE_REQUEST; delete childEnv.ALFRED_SETUP_UPGRADE_NONCE;
  const result = execute("sh", [join(root, "install.sh"), ...installerArgs], { cwd, env: childEnv, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}
