#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { sha256 } from "./build-runtime.mjs";
import { inspectRuntime } from "./runtime-archive.mjs";
import { renderFormula } from "./generate-homebrew-formula.mjs";

export const TARGET = "GOI17/homebrew-alfred";
export const SOURCE = "GOI17/alfred";
export async function publishRuntime({ archive, manifestBytes, formula, expectedSha256, approvedSha256, expectedFormulaSha256, approvedFormulaSha256, target, api, sourceApi, anonymousDownload }) {
  assert.equal(target, TARGET, "Destination is not the reviewed tap repository");
  assert.match(expectedSha256 ?? "", /^[a-f0-9]{64}$/, "An explicit reviewed artifact checksum is required");
  assert.equal(approvedSha256, expectedSha256, "Configured approval checksum does not match the requested artifact");
  assert.equal(sha256(archive), expectedSha256, "Archive bytes differ from the approved artifact");
  assert.match(expectedFormulaSha256 ?? "", /^[a-f0-9]{64}$/, "An explicit reviewed formula checksum is required");
  assert.equal(approvedFormulaSha256, expectedFormulaSha256, "Configured formula approval checksum does not match");
  assert.equal(sha256(formula), expectedFormulaSha256, "Formula bytes differ from the approved formula");
  const { manifest } = inspectRuntime(archive, manifestBytes);
  assert.deepEqual(formula, Buffer.from(renderFormula({ source: "release", version: manifest.version, sha256: expectedSha256 })), "Reviewed formula does not match the approved runtime URL/version/hash contract");
  const source = await sourceApi("GET", `/repos/${SOURCE}`);
  assert.equal(source.full_name, SOURCE); assert.equal(source.private, true, "Source repository must remain private");
  const destination = await api("GET", `/repos/${TARGET}`);
  assert.equal(destination.full_name, TARGET); assert.equal(destination.private, false, "Tap must already be public; this workflow cannot change visibility");
  assert.equal(manifest.provenance?.source_repository, SOURCE, "Unexpected source provenance");
  assert.match(manifest.provenance?.source_revision ?? "", /^[a-f0-9]{40}$/, "Missing source revision provenance");
  const commit = await sourceApi("GET", `/repos/${SOURCE}/commits/${manifest.provenance.source_revision}`);
  assert.equal(commit.sha, manifest.provenance.source_revision, "Source revision is not available in the private repository");
  const sourcePackage = await sourceApi("GET", `/repos/${SOURCE}/contents/package.json?ref=${manifest.provenance.source_revision}`);
  assert.equal(JSON.parse(Buffer.from(sourcePackage.content, "base64")).version, manifest.version, "Source package version differs from runtime");
  assert.match(manifest.provenance.builder_revision ?? "", /^[a-f0-9]{40}$/, "Missing builder revision provenance");
  const builderCommit = await sourceApi("GET", `/repos/${SOURCE}/commits/${manifest.provenance.builder_revision}`);
  assert.equal(builderCommit.sha, manifest.provenance.builder_revision, "Builder revision is not available in the private repository");
  for (const [path, digest] of [
    ["scripts/build-runtime.mjs", manifest.provenance.builder_sha256],
    ["scripts/generate-homebrew-formula.mjs", manifest.provenance.generator_sha256],
    ["packaging/runtime/allowlist.json", manifest.provenance.allowlist_sha256],
    ["packaging/runtime/package-lock.json", manifest.provenance.dependencies_lock_sha256]
  ]) {
    const blob = await sourceApi("GET", `/repos/${SOURCE}/contents/${path}?ref=${manifest.provenance.builder_revision}`);
    assert.equal(sha256(Buffer.from(blob.content, "base64")), digest, `Preparation provenance mismatch: ${path}`);
  }
  const existingFormula = await api("GET", `/repos/${TARGET}/contents/Formula/alfred.rb`, undefined, { missing: true });
  if (existingFormula) {
    const current = Buffer.from(existingFormula.content, "base64").toString("utf8");
    const currentVersion = /(?:releases\/download\/v|tag:\s+"v)(\d+\.\d+\.\d+)/.exec(current)?.[1];
    if (!currentVersion) throw new Error("Existing formula version cannot be verified");
    const left = currentVersion.split(".").map(Number), right = manifest.version.split(".").map(Number);
    const different = left.findIndex((value, index) => value !== right[index]);
    if (different !== -1 && left[different] > right[different]) throw new Error("Refusing to downgrade the published formula");
    if (currentVersion === manifest.version && current.includes("/releases/download/") && !Buffer.from(existingFormula.content, "base64").equals(formula)) throw new Error("Refusing different public formula bytes for the same version");
  }
  const tag = `v${manifest.version}`;
  const name = `alfred-${manifest.version}-runtime.tar.gz`;
  const url = `https://github.com/${TARGET}/releases/download/${tag}/${name}`;
  const releaseName = `Alfred ${manifest.version}`;
  const releaseBody = "Reviewed Alfred runtime. Includes readable JavaScript, shell, HTML, SQL, agent/skill instructions, and production dependencies. The private source repository and its history are not published.";
  let release = await api("GET", `/repos/${TARGET}/releases/tags/${tag}`, undefined, { missing: true });
  const assets = [
    { name, bytes: archive, type: "application/gzip" },
    { name: "runtime-manifest.json", bytes: manifestBytes, type: "application/json" },
    { name: `${name}.sha256`, bytes: Buffer.from(`${expectedSha256}  ${name}\n`), type: "text/plain" }
  ];
  // Never replace same-version bytes, even when the release is still a draft.
  if (release) {
    assert.equal(release.prerelease, false, "Stable runtime cannot reuse a prerelease");
    assert.equal(release.tag_name, tag, "Unexpected existing release tag");
    assert.equal(release.name, releaseName, "Unexpected existing release name");
    assert.equal(release.body, releaseBody, "Unexpected existing release disclosure");
    assert.equal(release.target_commitish, destination.default_branch, "Unexpected existing release target");
    assert.ok(release.assets.every((asset) => assets.some((candidate) => candidate.name === asset.name)), "Unexpected release assets would expose unreviewed bytes");
    for (const asset of assets) {
      const existing = release.assets.find((candidate) => candidate.name === asset.name);
      if (existing) {
        const bytes = await api("GET", `/repos/${TARGET}/releases/assets/${existing.id}`, undefined, { binary: true });
        assert.equal(sha256(bytes), sha256(asset.bytes), `Refusing different bytes for published version asset: ${asset.name}`);
      }
    }
  } else {
    release = await api("POST", `/repos/${TARGET}/releases`, { tag_name: tag, target_commitish: destination.default_branch, name: releaseName, draft: true, prerelease: false, body: releaseBody });
  }
  for (const asset of assets) {
    if (release.assets?.some((candidate) => candidate.name === asset.name)) continue;
    await api("POST", `/repos/${TARGET}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, asset.bytes, { upload: true, contentType: asset.type });
  }
  if (release.draft) await api("PATCH", `/repos/${TARGET}/releases/${release.id}`, { draft: false });
  const downloaded = await anonymousDownload(url);
  assert.equal(sha256(downloaded), expectedSha256, "Anonymous release download does not match the reviewed artifact");
  if (!existingFormula || !Buffer.from(existingFormula.content, "base64").equals(formula)) {
    await api("PUT", `/repos/${TARGET}/contents/Formula/alfred.rb`, { message: `alfred ${manifest.version} reviewed public runtime`, content: formula.toString("base64"), branch: destination.default_branch, ...(existingFormula ? { sha: existingFormula.sha } : {}) });
  }
  return { status: "published", version: manifest.version, sha256: expectedSha256, url, provider_calls: 0 };
}
export function githubApi(token) {
  if (!token) throw new Error("Repository-scoped GitHub credentials are required by the publisher");
  return async (method, path, body, options = {}) => {
    const base = options.upload ? "https://uploads.github.com" : "https://api.github.com";
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, Accept: options.binary ? "application/octet-stream" : "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? { "Content-Type": options.contentType ?? "application/json" } : {}) }, ...(body ? { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}) });
    if (options.missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status})`);
    return options.binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  };
}
export async function downloadAnonymous(url) {
  // fetch does not load gh credentials, netrc, Git helpers or environment tokens.
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Anonymous runtime download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await publishRuntime({ archive: readFileSync(process.env.RUNTIME_ARCHIVE), manifestBytes: readFileSync(process.env.RUNTIME_MANIFEST), formula: readFileSync(process.env.RUNTIME_FORMULA), expectedFormulaSha256: process.env.REVIEWED_FORMULA_SHA256, approvedFormulaSha256: process.env.APPROVED_FORMULA_SHA256, expectedSha256: process.env.REVIEWED_SHA256, approvedSha256: process.env.APPROVED_SHA256, target: process.env.DISTRIBUTION_REPOSITORY, api: githubApi(process.env.DISTRIBUTION_TOKEN), sourceApi: githubApi(process.env.SOURCE_READ_TOKEN), anonymousDownload: downloadAnonymous });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
