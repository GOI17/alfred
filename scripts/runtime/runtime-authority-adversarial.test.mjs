import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { initializeRuntime, runtimeStatus, runManagedRequest } from './service.mjs';

const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
const digest = value => createHash('sha256').update(value).digest('hex');
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alfred-qa-217-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'a');
  const other = path.join(root, 'b');
  const home = path.join(root, 'home');
  for (const dir of [cwd, other, path.join(home, '.alfred/runtime')]) fs.mkdirSync(dir, { recursive: true });
  const source = path.join(root, 'instructions.txt');
  fs.writeFileSync(source, 'approved text');
  const manifest = path.join(root, 'manifest.json');
  write(manifest, { version: 1, instructions: [], options: [] });
  const option = { id: 'external', source, contract: 'read-text-v1', action: 'load-instructions', scope: 'typescript', digest: digest('approved text') };
  const catalog = path.join(home, '.alfred/runtime/options.json');
  write(catalog, { version: 1, options: [option] });
  initializeRuntime({ cwd, instructions: manifest });
  const run = (overrides = {}) => runManagedRequest({ cwd, home, action: option.action, scope: option.scope, option_id: option.id, consent: async () => undefined, ...overrides });
  const consent = choice => async (_request, _option, binding) => ({ choice, binding });
  return { root, cwd, other, home, source, manifest, option, catalog, run, consent };
}

test('QA fs: copied complete project state cannot transfer an Always grant', async t => {
  const f = fixture(t);
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  fs.cpSync(path.join(f.cwd, '.alfred'), path.join(f.other, '.alfred'), { recursive: true });
  assert.throws(() => runtimeStatus({ cwd: f.other }), /binding mismatch/);
  await assert.rejects(f.run({ cwd: f.other }), /binding mismatch/);
  assert.equal(runtimeStatus({ cwd: f.cwd }).grant_count, 1);
});

test('QA fs: independent workspaces share installation but not grants; alias preserves identity', async t => {
  const f = fixture(t);
  initializeRuntime({ cwd: f.other, instructions: f.manifest });
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  assert.equal((await f.run({ cwd: f.other })).status, 'denied');
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.cwd, alias);
  const replay = await f.run({ cwd: alias });
  assert.equal(replay.status, 'completed');
  assert.equal(replay.result.content, 'approved text');
  assert.equal(runtimeStatus({ cwd: alias }).workspace_id, f.cwd);
});

test('QA fs: retargeting workspace alias during consent prevents execution', async t => {
  const f = fixture(t);
  initializeRuntime({ cwd: f.other, instructions: f.manifest });
  const alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.cwd, alias);
  const result = await f.run({ cwd: alias, consent: async (_r, _o, binding) => {
    fs.unlinkSync(alias);
    fs.symlinkSync(f.other, alias);
    return { choice: 'once', binding };
  } });
  assert.equal(result.status, 'failed');
  assert.equal(result.result, undefined);
});

test('QA fs: symlinked grant file never imports authority from another workspace', async t => {
  const f = fixture(t);
  initializeRuntime({ cwd: f.other, instructions: f.manifest });
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  const otherGrants = path.join(f.other, '.alfred/runtime/grants.json');
  fs.unlinkSync(otherGrants);
  fs.symlinkSync(path.join(f.cwd, '.alfred/runtime/grants.json'), otherGrants);
  assert.equal((await f.run({ cwd: f.other })).status, 'failed');
  assert.equal(runtimeStatus({ cwd: f.cwd }).grant_count, 1);
});

test('QA fs: new Alfred denial overrides persisted grant without reading malformed globals', async t => {
  const f = fixture(t);
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  write(f.manifest, { version: 1, instructions: [{ id: 'deny', action: f.option.action, scope: f.option.scope, disposition: 'deny' }], options: [] });
  fs.writeFileSync(f.catalog, '{malformed');
  assert.equal((await f.run()).reason, 'alfred_denied');
});

test('QA fs: changed content with updated catalog cannot reuse old grant', async t => {
  const f = fixture(t);
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  fs.writeFileSync(f.source, 'changed text');
  write(f.catalog, { version: 1, options: [{ ...f.option, digest: digest('changed text') }] });
  assert.equal((await f.run()).status, 'denied');
  const approved = await f.run({ consent: f.consent('once') });
  assert.equal(approved.result.content, 'changed text');
});

test('QA fs: replacing approved source with a symlink during consent fails closed', async t => {
  const f = fixture(t);
  const replacement = path.join(f.root, 'replacement.txt');
  fs.writeFileSync(replacement, 'approved text');
  const result = await f.run({ consent: async (_r, _o, binding) => {
    fs.unlinkSync(f.source);
    fs.symlinkSync(replacement, f.source);
    return { choice: 'once', binding };
  } });
  assert.equal(result.status, 'failed');
  assert.equal(result.result, undefined);
});

test('QA fs: missing required manifest is failure, not permission to use global grant', async t => {
  const f = fixture(t);
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  fs.unlinkSync(f.manifest);
  const result = await f.run();
  assert.equal(result.status, 'failed');
  assert.equal(result.result, undefined);
});

test('QA fs: source is opened only after consent and execution authorization', async t => {
  const f = fixture(t);
  const realOpen = fs.openSync;
  const order = [];
  t.mock.method(fs, 'openSync', function (file, ...args) {
    if (file === f.source) order.push('source_open');
    return realOpen.call(fs, file, ...args);
  });
  assert.equal((await f.run()).status, 'denied');
  assert.deepEqual(order, []);
  assert.equal((await f.run({ consent: f.consent('cancel') })).status, 'cancelled');
  assert.deepEqual(order, []);
  const approved = await f.run({
    consent: async (_r, _o, binding) => { order.push('consent'); return { choice: 'once', binding }; },
    trace: event => { if (event.event === 'execution_authorized') order.push('authorized'); }
  });
  assert.equal(approved.status, 'completed');
  assert.equal(approved.result.content, 'approved text');
  assert.deepEqual(order, ['consent', 'authorized', 'source_open']);
});

test('QA fs: changed bytes after consent cannot be returned under original digest', async t => {
  const f = fixture(t);
  const result = await f.run({ consent: async (_r, _o, binding) => {
    fs.writeFileSync(f.source, 'unapproved replacement');
    return { choice: 'once', binding };
  } });
  assert.equal(result.status, 'failed');
  assert.equal(result.result, undefined);
  assert.equal(runtimeStatus({ cwd: f.cwd }).grant_count, 0);
});

test('QA fs: subdirectory inherits project identity but newly initialized nested project does not', async t => {
  const f = fixture(t);
  const nested = path.join(f.cwd, 'nested');
  fs.mkdirSync(nested);
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  assert.equal((await f.run({ cwd: nested })).status, 'completed');
  assert.equal(runtimeStatus({ cwd: nested }).workspace_id, f.cwd);
  initializeRuntime({ cwd: nested, instructions: f.manifest });
  assert.equal(runtimeStatus({ cwd: nested }).workspace_id, nested);
  assert.equal((await f.run({ cwd: nested })).status, 'denied');
});

test('QA fs: returned UTF-8 snapshot preserves approved BOM and line endings', async t => {
  const f = fixture(t);
  const content = '\uFEFFapproved\r\ntext\n';
  fs.writeFileSync(f.source, content);
  write(f.catalog, { version: 1, options: [{ ...f.option, digest: digest(content) }] });
  const result = await f.run({ consent: f.consent('once') });
  assert.equal(result.status, 'completed');
  assert.equal(result.result.content, content);
});

test('QA fs: uninitialized nested Git repository cannot inherit parent runtime or grants', async t => {
  const f = fixture(t);
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  const nested = path.join(f.cwd, 'independent-repository');
  execFileSync('git', ['init', '--quiet', nested]);
  await assert.rejects(f.run({ cwd: nested }), /initializ|boundary|workspace/i);
  assert.throws(() => runtimeStatus({ cwd: nested }), /initializ|boundary|workspace/i);
  assert.equal(runtimeStatus({ cwd: f.cwd }).grant_count, 1);
});

test('QA fs: uninitialized linked Git worktree below another project cannot inherit its grants', async t => {
  const f = fixture(t);
  assert.equal((await f.run({ consent: f.consent('always') })).status, 'completed');
  const repository = path.join(f.root, 'independent-origin');
  execFileSync('git', ['init', '--quiet', repository]);
  execFileSync('git', ['-C', repository, '-c', 'user.name=QA', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'isolated QA fixture']);
  const nested = path.join(f.cwd, 'independent-worktree');
  execFileSync('git', ['-C', repository, 'worktree', 'add', '--quiet', '--detach', nested]);
  assert.ok(fs.statSync(path.join(nested, '.git')).isFile());
  await assert.rejects(f.run({ cwd: nested }), /initializ|boundary|workspace/i);
  assert.throws(() => runtimeStatus({ cwd: nested }), /initializ|boundary|workspace/i);
  assert.equal(runtimeStatus({ cwd: f.cwd }).grant_count, 1);
});
