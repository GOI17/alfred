#!/usr/bin/env node
// Publishes only to an existing public Alfred release. Never creates releases or changes a tap.
import assert from "node:assert/strict";
import { lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { inspectRuntime } from "./runtime-archive.mjs";
import { sha256 } from "./build-runtime.mjs";
import { renderFormula } from "./generate-homebrew-formula.mjs";

const repo = "GOI17/alfred";
function runGh(args) {
  const result = spawnSync("gh", args, { encoding: null, timeout: 120000, maxBuffer: 128 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error("GitHub asset operation failed; no replacement was attempted");
  return result.stdout;
}
export async function downloadAnonymous(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), redirect: "follow" });
  if (!response.ok) throw new Error("Anonymous runtime download failed");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 128 * 1024 * 1024) throw new Error("Runtime download exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function readCandidate({ directory, tag, revision }) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  assert.match(revision, /^[a-f0-9]{40}$/);
  const version = tag.slice(1), name = `alfred-${version}-runtime.tar.gz`;
  const read = name => {
    const file = join(directory, name);
    assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), "Expected regular asset");
    return readFileSync(file);
  };
  const archive = read(name), inventory = read("runtime-manifest.json"), formula = read("alfred.rb");
  const { manifest } = inspectRuntime(archive, inventory);
  assert.equal(manifest.version, version, "Release version mismatch");
  assert.equal(manifest.provenance.source_revision, revision, "Release source mismatch");
  assert.equal(manifest.provenance.builder_revision, revision, "Release builder mismatch");
  assert.equal(manifest.provenance.exploratory, false, "Exploratory candidate cannot be published");
  assert.deepEqual(formula, Buffer.from(renderFormula({ source: "release", version, sha256: sha256(archive) })), "Formula URL/version/checksum mismatch");
  const assets = new Map([[name, archive], ["runtime-manifest.json", inventory], ["alfred.rb", formula]]);
  const sums = Buffer.from([...assets].map(([file, bytes]) => `${sha256(bytes)}  ${file}\n`).join(""));
  assert.deepEqual(read("SHA256SUMS"), sums, "Release checksums mismatch");
  assets.set("SHA256SUMS", sums);
  return { assets, version };
}
export async function publishAssets({ directory, tag, revision, gh = runGh, download = downloadAnonymous }) {
  const { assets, version } = readCandidate({ directory, tag, revision });
  const visibility = String(await gh(["repo", "view", repo, "--json", "visibility", "--jq", ".visibility"])).trim();
  assert.equal(visibility, "PUBLIC", "Alfred release repository must already be public");
  const release = JSON.parse(await gh(["release", "view", tag, "--repo", repo, "--json", "tagName,isDraft,isPrerelease,assets"]));
  assert.equal(release.tagName, tag);
  assert.equal(release.isDraft, false);
  assert.equal(release.isPrerelease, false);
  // Validate ALL existing bytes before uploading even one missing asset. Never --clobber.
  const missing = [];
  for (const [name, bytes] of assets) {
    const matches = release.assets.filter(asset => asset.name === name);
    assert.ok(matches.length <= 1, "Ambiguous existing asset");
    if (!matches.length) { missing.push(name); continue; }
    const id = matches[0].apiUrl?.match(/\/releases\/assets\/(\d+)$/)?.[1];
    assert.ok(id, "Invalid asset identity");
    const existing = await gh(["api", `repos/${repo}/releases/assets/${id}`, "-H", "Accept: application/octet-stream"]);
    assert.equal(sha256(existing), sha256(bytes), `Refusing replacement of ${name}`);
  }
  if (missing.length) await gh(["release", "upload", tag, "--repo", repo, ...missing.map(name => join(directory, name))]);
  // Success is a prerequisite for the workflow's tap update. Credentials never enter this request.
  for (const [name, bytes] of assets) {
    const downloaded = await download(`https://github.com/${repo}/releases/download/${tag}/${name}`);
    assert.equal(sha256(downloaded), sha256(bytes), `Anonymous verification failed for ${name}`);
  }
  return { status: "pass", version, uploaded: missing, provider_calls: 0 };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const options = {};
    for (let i = 2; i < process.argv.length; i += 2) {
      const key = process.argv[i]?.slice(2);
      assert.ok(["directory", "tag", "revision"].includes(key) && !Object.hasOwn(options, key) && process.argv[i + 1], "Invalid publisher arguments");
      options[key] = process.argv[i + 1];
    }
    assert.ok(options.directory, "Missing asset directory");
    process.stdout.write(JSON.stringify(await publishAssets(options)) + "\n");
  } catch (error) { process.stderr.write(`runtime-assets: ${error.message}\n`); process.exitCode = 1; }
}
