import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledSetupBinary } from "../../packages/memory-server/scripts/setup.mjs";

test("launcher validates exact target, executable digest and native header without executing untrusted bytes", t => {
  const root = mkdtempSync(join(tmpdir(), "alfred-setup-launcher-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "packages/setup-tui/dist"); mkdirSync(directory, { recursive: true });
  const path = join(directory, "alfred-setup-linux-amd64"), bytes = Buffer.alloc(64);
  Buffer.from([0x7f,0x45,0x4c,0x46,2,1]).copy(bytes); bytes.writeUInt16LE(62,18);
  const manifest = { schema: "alfred.setup.binaries/v1", binaries: { "linux-amd64": { file: "alfred-setup-linux-amd64", sha256: createHash("sha256").update(bytes).digest("hex") } } };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest)); writeFileSync(path, bytes, { mode: 0o755 });
  assert.equal(bundledSetupBinary(root, "linux", "x64"), path);
  assert.throws(() => bundledSetupBinary(root, "linux", "arm64"), /manifest/);
  assert.throws(() => bundledSetupBinary(root, "win32", "x64"), /support/);
  chmodSync(path, 0o644); assert.throws(() => bundledSetupBinary(root, "linux", "x64"), /integrity/);
  chmodSync(path, 0o755); writeFileSync(path, Buffer.from("wrong")); assert.throws(() => bundledSetupBinary(root, "linux", "x64"), /integrity/);
  unlinkSync(path); const other = join(root, "other"); writeFileSync(other, bytes, { mode: 0o755 }); symlinkSync(other, path);
  assert.throws(() => bundledSetupBinary(root, "linux", "x64"), /integrity/);
});
