import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const revoke = html.slice(html.indexOf('async function revokeKey('), html.indexOf('\nfunction showError('));

function setup() {
  let onClose;
  const calls = [];
  const dialog = {
    open: false,
    returnValue: '',
    addEventListener(event, callback) { assert.equal(event, 'close'); onClose = callback; },
    showModal() { this.open = true; },
    close(value = 'cancel') { this.returnValue = value; this.open = false; onClose(); },
  };
  const context = {
    SESSION_VERSION: 1, API_KEY: 'test',
    document: { getElementById: () => dialog },
    api: async (...args) => calls.push(args), loadKeys() {},
    showError(error) { throw error; },
  };
  runInNewContext(revoke + '\nthis.revokeKey = revokeKey;', context);
  return { context, dialog, calls };
}

test('revocation waits for explicit confirmation', async () => {
  const { context, dialog, calls } = setup();
  const pending = context.revokeKey('key-1');
  assert.equal(dialog.open, true);
  assert.equal(calls.length, 0);
  dialog.close('confirm');
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/console/api/keys/key-1');
  assert.equal(calls[0][1].method, 'DELETE');
});

test('cancel or Escape never revokes', async () => {
  const { context, dialog, calls } = setup();
  const pending = context.revokeKey('key-1');
  dialog.close();
  await pending;
  assert.equal(calls.length, 0);
});

test('session changes invalidate confirmation', async () => {
  const { context, dialog, calls } = setup();
  const pending = context.revokeKey('key-1');
  context.SESSION_VERSION++;
  dialog.close('confirm');
  await pending;
  assert.equal(calls.length, 0);
});

test('duplicate clicks cannot open another revocation', async () => {
  const { context, dialog, calls } = setup();
  const pending = context.revokeKey('key-1');
  await context.revokeKey('key-2');
  dialog.close('confirm');
  await pending;
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/console/api/keys/key-1');
});

test('UI sources do not call browser-native prompts', () => {
  const renderer = new URL('../../workspace/src/renderer/src/', import.meta.url);
  for (const file of readdirSync(renderer, { recursive: true }).filter(file => /\.[jt]sx?$/.test(file))) {
    assert.doesNotMatch(readFileSync(new URL(file, renderer), 'utf8'), /\b(?:window|globalThis)\s*\.\s*(?:confirm|prompt|alert)\s*\(/, file);
  }
  assert.doesNotMatch(html, /\b(?:confirm|prompt|alert)\s*\(/);
});
