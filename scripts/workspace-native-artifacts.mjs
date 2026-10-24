import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function assertNative(bytes, target) {
  const [platform, arch] = target.split('-');
  const valid = platform === 'darwin'
    ? bytes.length >= 32 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === (arch === 'arm64' ? 0x100000c : 0x1000007)
    : platform === 'linux' && bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) && bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(18) === (arch === 'arm64' ? 183 : 62);
  if (!['darwin-arm64','darwin-x64','linux-arm64','linux-x64'].includes(target) || !valid) throw new Error(`Invalid Workspace PTY binary: ${target}`);
}
export function nativeDependencyIdentity(lockBytes) {
  const lock = JSON.parse(lockBytes);
  const packages = ['node-pty', 'node-addon-api'].map(name => {
    const p = lock.packages[`node_modules/${name}`];
    if (!p?.integrity || !p.resolved?.startsWith('https://registry.npmjs.org/')) throw new Error(`Missing native dependency lock: ${name}`);
    return [name, { version: p.version, integrity: p.integrity }];
  });
  return { dependencies_lock_sha256: digest(lockBytes), dependencies: Object.fromEntries(packages) };
}
export function readNativeArtifacts(directory, lockBytes, sourceRevision) {
  if (!directory) throw new Error('Workspace requires --workspace-native with verified Linux PTY builds');
  const targets = ['linux-arm64', 'linux-x64'];
  if (lstatSync(directory).isSymbolicLink() || JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(targets)) throw new Error('Expected exactly the two Linux Workspace PTY artifacts');
  const expected = nativeDependencyIdentity(lockBytes);
  const builderSha = digest(readFileSync(new URL('./build-workspace-native.mjs', import.meta.url)));
  return targets.map(target => {
    const dir = join(directory, target);
    if (lstatSync(dir).isSymbolicLink() || JSON.stringify(readdirSync(dir).sort()) !== JSON.stringify(['manifest.json','pty.node'])) throw new Error(`Unexpected native artifact files: ${target}`);
    for (const name of ['manifest.json','pty.node']) if (!lstatSync(join(dir,name)).isFile() || lstatSync(join(dir,name)).isSymbolicLink()) throw new Error(`Invalid native artifact input: ${target}/${name}`);
    const bytes = readFileSync(join(dir, 'pty.node'));
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json')));
    if (manifest.schema !== 'alfred.workspace.native/v1' || manifest.target !== target || manifest.builder_sha256 !== builderSha || manifest.source_revision !== sourceRevision || manifest.sha256 !== digest(bytes) || manifest.dependencies_lock_sha256 !== expected.dependencies_lock_sha256 || JSON.stringify(manifest.dependencies) !== JSON.stringify(expected.dependencies) || manifest.smoke !== 'pty-spawn-output-exit') throw new Error(`Workspace native provenance mismatch: ${target}`);
    assertNative(bytes, target);
    return { target, bytes, manifest };
  });
}
