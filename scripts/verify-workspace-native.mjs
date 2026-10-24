#!/usr/bin/env node
// Real PTY smoke, also shipped for Homebrew's installed-package test.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function verifyWorkspaceNative(dependencies, env = process.env) {
  const require = createRequire(resolve(dependencies, 'node-pty/package.json'));
  const { spawn } = require('node-pty');
  const marker = 'alfred-packaged-pty-ok';
  const terminal = spawn('/bin/sh', ['-c', `printf '${marker}'; exit 0`], {
    name: 'xterm', cols: 80, rows: 24, cwd: env.HOME,
    env: { PATH: '/usr/bin:/bin', HOME: env.HOME, TERM: 'xterm', LANG: 'C' },
  });
  let output = '';
  terminal.onData(chunk => { output += chunk; });
  try {
    const result = await new Promise((done, reject) => {
      const timeout = setTimeout(() => { terminal.kill(); reject(new Error('Packaged PTY timed out')); }, 10000);
      terminal.onExit(event => { clearTimeout(timeout); done(event); });
    });
    assert.equal(result.exitCode, 0, 'Packaged PTY shell failed');
    assert.ok(output.includes(marker), `Packaged PTY did not produce output: ${output}`);
  } finally { try { terminal.kill(); } catch {} }
  return { status: 'pass', platform: process.platform, arch: process.arch, terminal: 'node-pty', provider_calls: 0 };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(await verifyWorkspaceNative(process.argv[2] || fileURLToPath(new URL('../node_modules', import.meta.url))))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
