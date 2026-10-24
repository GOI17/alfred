#!/usr/bin/env node
// Build with an already installed, locked toolchain; never install dependencies.
import { existsSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
export function buildWorkspace(dependencies = resolve(root, 'packages/workspace/node_modules')) {
  dependencies = realpathSync(dependencies);
  const workspace = resolve(root, 'packages/workspace');
  const modules = resolve(workspace, 'node_modules');
  let linked = false;
  if (!existsSync(modules)) { symlinkSync(dependencies, modules, 'dir'); linked = true; }
  else if (realpathSync(modules) !== dependencies) throw new Error('Workspace has different dependencies; refusing to replace them');
  try {
    for (const args of [ ['vite/bin/vite.js', 'build'], ['typescript/bin/tsc', '-p', 'tsconfig.server.json'] ]) {
      const result = spawnSync(process.execPath, [resolve(dependencies, args[0]), ...args.slice(1)], { cwd: workspace, stdio: 'inherit' });
      if (result.status !== 0) throw new Error(`Workspace build failed: ${args[0]}`);
    }
  } finally { if (linked) unlinkSync(modules); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 2 && (process.argv.length !== 4 || process.argv[2] !== '--dependencies')) throw new Error('Usage: build-workspace.mjs [--dependencies <node_modules>]');
    buildWorkspace(process.argv[3]);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
