import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { assertSafePath, sha256 } from "./build-runtime.mjs";

export function inspectRuntime(archive, manifestBytes) {
  const tar = gunzipSync(archive, { maxOutputLength: 512 * 1024 * 1024 });
  const files = new Map();
  let offset = 0;
  const string = (buffer) => buffer.toString("utf8").replace(/\0.*$/s, "");
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const storedChecksum = parseInt(string(header.subarray(148, 156)).trim(), 8);
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    assert.equal(checksum, storedChecksum, "Invalid runtime tar checksum");
    assert.equal(string(header.subarray(257, 263)), "ustar", "Only USTAR runtime archives are allowed");
    assert.equal(String.fromCharCode(header[156]), "0", "Only regular files are allowed in runtime archive");
    const prefix = string(header.subarray(345, 500));
    const name = `${prefix ? `${prefix}/` : ""}${string(header.subarray(0, 100))}`;
    assertSafePath(name);
    assert.ok(!files.has(name), `Duplicate archive file: ${name}`);
    const size = parseInt(string(header.subarray(124, 136)), 8);
    const mode = parseInt(string(header.subarray(100, 108)), 8);
    assert.ok(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, "Invalid archive entry size");
    assert.ok([0o644, 0o755].includes(mode), `Unexpected runtime mode: ${name}`);
    files.set(name, { bytes: tar.subarray(offset + 512, offset + 512 + size), mode });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.ok(tar.subarray(offset).every((byte) => byte === 0), "Unexpected trailing archive data");
  const embedded = files.get("runtime-manifest.json");
  assert.ok(embedded, "Runtime manifest is missing");
  if (manifestBytes) assert.deepEqual(embedded.bytes, manifestBytes, "External manifest differs from archived manifest");
  const manifest = JSON.parse(embedded.bytes);
  assert.equal(manifest.schema, "alfred.runtime.manifest/v1");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(files.size, manifest.files.length + 1, "Manifest does not inventory every file");
  const seen = new Set();
  for (const entry of manifest.files) {
    assertSafePath(entry.path);
    assert.ok(!seen.has(entry.path) && entry.path !== "runtime-manifest.json", "Duplicate or self-referencing manifest path");
    seen.add(entry.path);
    const file = files.get(entry.path);
    assert.ok(file, `Manifest file missing from archive: ${entry.path}`);
    assert.equal(file.bytes.length, entry.size, `Runtime size mismatch: ${entry.path}`);
    assert.equal(file.mode.toString(8), entry.mode, `Runtime mode mismatch: ${entry.path}`);
    assert.equal(sha256(file.bytes), entry.sha256, `Runtime hash mismatch: ${entry.path}`);
  }
  assert.equal(JSON.parse(files.get("package.json")?.bytes ?? "{}").version, manifest.version, "Runtime package version mismatch");
  return { manifest, manifestBytes: embedded.bytes, files };
}
