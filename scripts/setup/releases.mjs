import { randomBytes } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const releaseURL = "https://api.github.com/repos/GOI17/alfred/releases/latest";
const formulaURL = "https://raw.githubusercontent.com/GOI17/homebrew-alfred/main/Formula/alfred.rb";
const stablePattern = /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/;
export const upgradeSchema = "alfred.setup.upgrade/v1";

export function compareStableVersions(left, right) {
  if (!stablePattern.test(left) || !stablePattern.test(right)) throw new Error("A stable Alfred version is required.");
  const a = left.split(".").map(Number), b = right.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
  return 0;
}

async function boundedText(fetchImpl, url, signal, limit) {
  const response = await fetchImpl(url, {
    signal, redirect: "error", credentials: "omit",
    headers: { Accept: url === releaseURL ? "application/vnd.github+json" : "text/plain", "User-Agent": "alfred-setup" }
  });
  if (!response.ok || (response.url && response.url !== url)) throw new Error("Update source unavailable.");
  const length = response.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > limit)) throw new Error("Update response too large.");
  if (!response.body) throw new Error("Update response is empty.");
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("Update check canceled.");
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("Update response too large.");
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks).toString("utf8");
}

export async function checkForUpdates({ currentVersion, packaged, fetchImpl = globalThis.fetch, signal, env = process.env, timeoutMs = 3500 }) {
  const visibleVersion = typeof currentVersion === "string" && /^[0-9A-Za-z.+_-]{1,80}$/.test(currentVersion) ? currentVersion : "unknown";
  const result = (status, text, latestVersion = "", canUpgrade = false) => ({ status, text, currentVersion: visibleVersion, latestVersion, canUpgrade });
  if (!stablePattern.test(currentVersion)) return result("development", "Development version; automatic runtime upgrades are disabled.");
  if (env.ALFRED_SETUP_CHECK_UPDATES === "0") return result("unavailable", "Update checks are disabled. You can still update the project from this runtime.");
  if (signal?.aborted) return result("unavailable", "Update check canceled.");
  const controller = new AbortController();
  let timeout, rejectAbort;
  const aborted = new Promise((_, reject) => { rejectAbort = reject; });
  const abort = () => { controller.abort(); rejectAbort(new Error("Update check canceled.")); };
  signal?.addEventListener("abort", abort, { once: true });
  timeout = setTimeout(abort, Math.max(1, Math.min(Number.isFinite(timeoutMs) ? timeoutMs : 3500, 5000)));
  try {
    return await Promise.race([aborted, (async () => {
      const release = JSON.parse(await boundedText(fetchImpl, releaseURL, controller.signal, 262144));
      const version = typeof release.tag_name === "string" && release.tag_name.startsWith("v") ? release.tag_name.slice(1) : "";
      if (release.draft !== false || release.prerelease !== false || !stablePattern.test(version)) throw new Error("Invalid stable release.");
      if (compareStableVersions(version, currentVersion) <= 0) return result("current", `Alfred ${currentVersion} is up to date.`, version);
      if (!packaged) return result("unsupported", `Alfred ${version} is available. Automatic runtime updates require the Homebrew installation.`, version);
      const assetURL = `https://github.com/GOI17/alfred/releases/download/v${version}/alfred-${version}-runtime.tar.gz`;
      const names = [`alfred-${version}-runtime.tar.gz`, "runtime-manifest.json", "SHA256SUMS", "alfred.rb"];
      if (!Array.isArray(release.assets) || !names.every(name => release.assets.filter(asset => asset.name === name && asset.browser_download_url === `https://github.com/GOI17/alfred/releases/download/v${version}/${name}`).length === 1)) {
        return result("pending", `Alfred ${version} is being published. Continue setup and check again later.`, version);
      }
      const formula = await boundedText(fetchImpl, formulaURL, controller.signal, 32768);
      const urlLines = formula.split(/\r?\n/).filter(line => /^\s*url\s+/.test(line));
      const hashes = formula.match(/^\s*sha256 "[a-f0-9]{64}"\s*$/gm) ?? [];
      if (urlLines.length !== 1 || urlLines[0].trim() !== `url "${assetURL}"` || hashes.length !== 1) {
        return result("pending", `Alfred ${version} is not available from Homebrew yet. Continue setup and check again later.`, version);
      }
      return result("available", `Alfred ${version} is available (installed: ${currentVersion}).`, version, true);
    })()]);
  } catch { return result("unavailable", "Could not check for updates. Continue setup or try again later."); }
  finally { clearTimeout(timeout); controller.abort(); signal?.removeEventListener("abort", abort); }
}

function requestLocation(env) {
  const path = env.ALFRED_SETUP_UPGRADE_REQUEST, nonce = env.ALFRED_SETUP_UPGRADE_NONCE;
  if (typeof path !== "string" || path !== resolve(path) || basename(path) !== "request.json" || !/^[a-f0-9]{64}$/.test(nonce ?? "")) throw new Error("Runtime updates require the interactive setup launcher.");
  const directory = dirname(path), stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) || (process.getuid && stat.uid !== process.getuid()) || dirname(directory) !== realpathSync(tmpdir()) || !basename(directory).startsWith("alfred-setup-upgrade-") || realpathSync(directory) !== directory) throw new Error("Invalid private runtime upgrade directory.");
  return { path, nonce };
}

export function handoffRuntimeUpgrade({ currentVersion, latestVersion, cwd, installRoot, env = process.env }) {
  const { path, nonce } = requestLocation(env);
  if (env.ALFRED_DISTRIBUTION !== "homebrew" || compareStableVersions(latestVersion, currentVersion) <= 0) throw new Error("A newer stable Homebrew runtime is required.");
  if (existsSync(path)) throw new Error("This runtime upgrade approval was already used.");
  const request = { schema: upgradeSchema, nonce, currentVersion, latestVersion, cwd: realpathSync(cwd), installRoot: realpathSync(installRoot) };
  const temporary = join(dirname(path), `.request-${randomBytes(12).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(request) + "\n"); closeSync(descriptor); descriptor = undefined;
    renameSync(temporary, path);
  } finally { if (descriptor !== undefined) closeSync(descriptor); if (existsSync(temporary)) unlinkSync(temporary); }
  return request;
}

export function consumeRuntimeUpgrade({ currentVersion, cwd, installRoot, env = process.env }) {
  const { path, nonce } = requestLocation(env), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) || stat.nlink !== 1 || stat.size > 4096 || (process.getuid && stat.uid !== process.getuid())) throw new Error("Invalid runtime upgrade approval.");
  let request;
  try { request = JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Invalid runtime upgrade approval."); }
  if (request.schema !== upgradeSchema || request.nonce !== nonce || request.cwd !== realpathSync(cwd) || request.installRoot !== realpathSync(installRoot) || request.currentVersion !== currentVersion || env.ALFRED_DISTRIBUTION !== "homebrew" || compareStableVersions(request.latestVersion, currentVersion) <= 0) throw new Error("Runtime upgrade approval does not match this setup session.");
  unlinkSync(path);
  return request;
}
