import test from 'node:test';
import assert from 'node:assert/strict';
import { runRuntimeRequest, runtimeGrant } from '../src/runtime-authority.js';

function fixture() {
  const request = { request_id: 'qa-217', workspace_id: '/projects/a', action: 'run', scope: 'lint' };
  const option = { id: 'lint', source: '/shared/lint', fingerprint: 'digest-a', action: 'run', scope: 'lint', args: ['safe'] };
  const calls = { discovery: 0, executions: [], saved: [], events: [] };
  const ports = {
    workspaceValid: async () => true,
    lookupInstruction: async () => ({ status: 'absent' }),
    discoverOptions: async () => { calls.discovery++; return [option]; },
    selectOption: async () => option.id,
    evaluatePolicy: async () => true,
    prepareOption: async (_request, value) => ({ ...value, args: [...value.args] }),
    loadGrants: async () => [],
    consent: async (_request, _option, binding) => ({ choice: 'once', binding }),
    saveGrant: async (_request, grant) => { calls.saved.push(grant); },
    execute: async (_request, value) => { calls.executions.push(structuredClone(value)); return { exit_code: 0 }; },
    trace: async event => { calls.events.push(event); }
  };
  return { request, option, calls, ports };
}

test('QA: lookup errors and non-absence values never enable global discovery', async t => {
  for (const state of [undefined, null, {}, { status: 'denied' }, { status: 'failed' }, { status: 'matched', disposition: 'deny' }, { status: 'matched', disposition: 'unknown' }, 'throw']) {
    await t.test(JSON.stringify(state) ?? 'undefined', async () => {
      const f = fixture();
      f.ports.lookupInstruction = async () => { if (state === 'throw') throw new Error('EACCES'); return state; };
      const result = await runRuntimeRequest(f.request, f.ports);
      assert.ok(['failed', 'denied'].includes(result.status));
      assert.equal(f.calls.discovery, 0);
      assert.equal(f.calls.executions.length, 0);
    });
  }
});

test('QA: copied or widened grants cannot replace noninteractive consent', async t => {
  for (const change of [{ workspace_id: '/projects/b' }, { option_id: 'other' }, { source: '/other/lint' }, { fingerprint: 'digest-b' }, { action: 'write' }, { scope: '*' }]) {
    await t.test(JSON.stringify(change), async () => {
      const f = fixture();
      f.ports.loadGrants = async () => [{ ...runtimeGrant(f.request, f.option), ...change }];
      f.ports.consent = async () => undefined;
      const result = await runRuntimeRequest(f.request, f.ports);
      assert.equal(result.status, 'denied');
      assert.equal(f.calls.executions.length, 0);
    });
  }
});

test('QA: replayed consent with wrong request or content is rejected', async t => {
  for (const change of [{ request_id: 'old-request' }, { fingerprint: 'old-content' }, { workspace_id: '/projects/b' }, { scope: '*' }]) {
    await t.test(JSON.stringify(change), async () => {
      const f = fixture();
      f.ports.consent = async (_r, _o, binding) => ({ choice: 'once', binding: { ...binding, ...change } });
      assert.equal((await runRuntimeRequest(f.request, f.ports)).reason, 'invalid_consent');
      assert.equal(f.calls.executions.length, 0);
    });
  }
});

test('QA: new Alfred instructions invalidate an already stored external grant', async () => {
  const f = fixture();
  let lookups = 0;
  f.ports.loadGrants = async () => [runtimeGrant(f.request, f.option)];
  f.ports.lookupInstruction = async () => ++lookups === 1 ? { status: 'absent' } : { status: 'matched', disposition: 'deny' };
  assert.equal((await runRuntimeRequest(f.request, f.ports)).reason, 'revalidation_failed');
  assert.equal(f.calls.executions.length, 0);
});

test('QA: consent-time changes to workspace, policy or content fail closed', async t => {
  for (const mutation of ['workspace', 'policy', 'content']) {
    await t.test(mutation, async () => {
      const f = fixture();
      f.ports.consent = async (_r, _o, binding) => {
        if (mutation === 'workspace') f.ports.workspaceValid = async () => false;
        if (mutation === 'policy') f.ports.evaluatePolicy = async () => false;
        if (mutation === 'content') f.option.fingerprint = 'digest-b';
        return { choice: 'once', binding };
      };
      assert.equal((await runRuntimeRequest(f.request, f.ports)).reason, 'revalidation_failed');
      assert.equal(f.calls.executions.length, 0);
    });
  }
});

test('QA: failed Always persistence cannot silently become Once', async () => {
  const f = fixture();
  f.ports.consent = async (_r, _o, binding) => ({ choice: 'always', binding });
  f.ports.saveGrant = async () => { throw new Error('disk full'); };
  assert.equal((await runRuntimeRequest(f.request, f.ports)).status, 'failed');
  assert.equal(f.calls.executions.length, 0);
});

test('QA: Alfred change during grant persistence prevents execution', async () => {
  const f = fixture();
  f.ports.consent = async (_r, _o, binding) => ({ choice: 'always', binding });
  f.ports.saveGrant = async () => { f.ports.lookupInstruction = async () => ({ status: 'matched', disposition: 'deny' }); };
  assert.equal((await runRuntimeRequest(f.request, f.ports)).reason, 'revalidation_failed');
  assert.equal(f.calls.executions.length, 0);
});

test('QA: managed execution failure is terminal and does not discover alternatives', async () => {
  const f = fixture();
  f.ports.lookupInstruction = async () => ({ status: 'matched', disposition: 'execute', option: f.option, token: 'v1' });
  let executions = 0;
  f.ports.execute = async () => { executions++; throw new Error('capability unavailable'); };
  assert.equal((await runRuntimeRequest(f.request, f.ports)).status, 'failed');
  assert.equal(executions, 1);
  assert.equal(f.calls.discovery, 0);
  assert.ok(!f.calls.events.some(event => event.event === 'execution_completed'));
});

test('QA: Once is not persisted or reused by a subsequent unattended request', async () => {
  const f = fixture();
  assert.equal((await runRuntimeRequest(f.request, f.ports)).status, 'completed');
  assert.equal(f.calls.saved.length, 0);
  f.ports.consent = async () => undefined;
  assert.equal((await runRuntimeRequest({ ...f.request, request_id: 'second' }, f.ports)).status, 'denied');
  assert.equal(f.calls.executions.length, 1);
  assert.ok(f.calls.events.every(event => ['qa-217', 'second'].includes(event.request_id)));
});

test('QA: consent callback cannot mutate the validated execution snapshot', async () => {
  const f = fixture();
  f.ports.consent = async (_r, presented, binding) => {
    try { presented.args[0] = 'unapproved'; } catch { /* Frozen snapshots may reject mutation. */ }
    return { choice: 'once', binding };
  };
  const result = await runRuntimeRequest(f.request, f.ports);
  assert.ok(result.status !== 'completed' || f.calls.executions[0].args[0] === 'safe', 'execution consumed arguments altered after preparation without renewed consent');
});

test('QA: policy denial precedes stored grants and consent', async () => {
  const f = fixture();
  f.ports.evaluatePolicy = async () => false;
  f.ports.loadGrants = async () => { assert.fail('denied request read grants'); };
  f.ports.consent = async () => { assert.fail('denied request offered consent'); };
  assert.equal((await runRuntimeRequest(f.request, f.ports)).reason, 'policy_denied');
  assert.equal(f.calls.executions.length, 0);
});

test('QA: cancel neither saves grants nor attempts another option', async () => {
  const f = fixture();
  f.ports.consent = async () => ({ choice: 'cancel' });
  assert.equal((await runRuntimeRequest(f.request, f.ports)).status, 'cancelled');
  assert.equal(f.calls.discovery, 1);
  assert.equal(f.calls.saved.length, 0);
  assert.equal(f.calls.executions.length, 0);
});

test('QA: unreadable or corrupt grant storage cannot become approval', async t => {
  for (const value of [null, {}, 'throw']) {
    await t.test(JSON.stringify(value), async () => {
      const f = fixture();
      f.ports.loadGrants = async () => { if (value === 'throw') throw new Error('EACCES'); return value; };
      assert.equal((await runRuntimeRequest(f.request, f.ports)).status, 'failed');
      assert.equal(f.calls.executions.length, 0);
      assert.equal(f.calls.saved.length, 0);
    });
  }
});
