#!/usr/bin/env node
// CI-only native build from the reviewed dependency closure and local Node headers.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { assertNative, digest, nativeDependencyIdentity } from './workspace-native-artifacts.mjs';
import { verifyWorkspaceNative } from './verify-workspace-native.mjs';
import { writeAssetAtomic } from './build-runtime.mjs';
const options = {};
for (let i=2;i<process.argv.length;i+=2) {
  if (!['--dependencies','--output','--source-revision','--node-headers'].includes(process.argv[i]) || !process.argv[i+1]) throw new Error('Expected --dependencies --output --source-revision [--node-headers]');
  options[process.argv[i].slice(2)] = process.argv[i+1];
}
const target = `${process.platform}-${process.arch}`;
if (!['linux-x64','linux-arm64'].includes(target)) throw new Error('Workspace native CI builder requires native Linux x64 or arm64');
if (!/^[a-f0-9]{40}$/.test(options['source-revision'] || '')) throw new Error('An exact source revision is required');
const dependencies = realpathSync(resolve(options.dependencies));
const source = resolve(import.meta.dirname, '..');
if (dependencies.startsWith(`${source}/`)) throw new Error('Build dependencies must be staged outside the checkout');
const lockBytes = readFileSync(join(dirname(dependencies), 'package-lock.json'));
if (!lockBytes.equals(readFileSync(join(source, 'packaging/runtime/package-lock.json')))) throw new Error('Native build lock differs from reviewed lock');
const identity = nativeDependencyIdentity(lockBytes);
const headers = realpathSync(resolve(options['node-headers'] || dirname(dirname(process.execPath))));
if (!existsSync(join(headers, 'include/node/node_api.h'))) throw new Error('Local Node headers are required; downloads are forbidden');
const addon = join(dependencies, 'node-pty');
const command = spawnSync(process.execPath, [join(dependencies,'node-gyp/bin/node-gyp.js'), 'rebuild', '--directory', addon, `--nodedir=${headers}`], {
  stdio: 'inherit', env: { ...process.env, npm_config_offline: 'true', npm_config_nodedir: headers, npm_config_build_from_source: 'true' },
});
if (command.status !== 0) throw new Error('Workspace PTY native build failed');
const home = mkdtempSync(join(tmpdir(), 'alfred-native-smoke-'));
try { await verifyWorkspaceNative(dependencies, { HOME: home }); }
finally { rmSync(home, { recursive: true, force: true }); }
const bytes = readFileSync(join(addon,'build/Release/pty.node'));
assertNative(bytes, target);
const output = resolve(options.output, target);
mkdirSync(output, { recursive: true });
writeAssetAtomic(join(output, 'pty.node'), bytes);
writeAssetAtomic(join(output, 'manifest.json'), Buffer.from(JSON.stringify({
  schema: 'alfred.workspace.native/v1', target, source_revision: options['source-revision'], ...identity,
  sha256: digest(bytes), node: process.version, napi: process.versions.napi,
  glibc: process.report.getReport().header.glibcVersionRuntime,
  builder_sha256: digest(readFileSync(import.meta.filename)), smoke: 'pty-spawn-output-exit',
}, null, 2)+'\n'));
console.log(JSON.stringify({status:'pass',target,output,provider_calls:0}));
