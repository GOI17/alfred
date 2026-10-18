import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orchestrateTask } from '../src/index.js';

const kernel = { routingPolicy: JSON.parse(readFileSync(new URL('../../../.ai/agents/routing-policy.json', import.meta.url), 'utf8')) };
const quickFacts = { question_count: 1, answer_known: true, requires_analysis: false, requires_code: false, requires_actions: false, requires_external_state: false, requires_tools: false };
const decide = changes => orchestrateTask({ kernel, input: 'review', ...changes });
const item = (id, scope) => ({ id, independent: true, depends_on: [], write_scopes: [scope] });

test('QA decisions: short analysis-heavy question still delegates and requires isolation', () => {
  const result = decide({ input: 'Risk?', requestFacts: { ...quickFacts, requires_analysis: true } });
  assert.equal(result.status, 'delegation_required');
  assert.equal(result.target_agent, 'reviewer');
  assert.equal(result.worktree.action, 'create_required');
  assert.equal(result.tool_decision.task_tools, 'not_needed');
  assert.equal(result.tool_decision.orchestration_tools, 'required');
});

test('QA decisions: tiny edits cannot use legacy small-task direct handling', () => {
  const result = decide({ input: 'typo', requestFacts: { ...quickFacts, requires_code: true } });
  assert.equal(result.delegation, true);
  assert.equal(result.target_agent, 'developer');
  assert.equal(result.worktree.action, 'create_required');
});

test('QA decisions: explicit quick-answer exception has no tools, worktree or cleanup', () => {
  const result = decide({ requestFacts: quickFacts });
  assert.equal(result.status, 'direct_answer');
  assert.equal(result.delegation_required, false);
  assert.equal(result.tool_decision.task_tools, 'not_needed');
  assert.equal(result.tool_decision.orchestration_tools, 'none');
  assert.equal(result.tool_decision.optional_tools_allowed, false);
  assert.equal(result.tool_decision.provider_request_authorized, false);
  assert.equal(result.worktree.action, 'none');
  assert.equal(result.cleanup.ask_at_completion, false);
  assert.equal(result.host_lifecycle_executed, false);
});

test('QA decisions: every missing quick-answer fact prevents the exception', async t => {
  for (const key of Object.keys(quickFacts)) {
    await t.test(key, () => {
      const facts = { ...quickFacts };
      delete facts[key];
      const result = decide({ requestFacts: facts });
      assert.equal(result.quick_answer, false);
      assert.equal(result.delegation_required, true);
      assert.equal(result.worktree.action, 'create_required');
    });
  }
});

test('QA decisions: unknown classification blocks for a specialist proposal, never direct fallback', () => {
  const result = decide({ input: 'Unclassified request', requestFacts: null });
  assert.equal(result.status, 'blocked');
  assert.equal(result.delegation_required, true);
  assert.equal(result.target_agent, null);
  assert.equal(result.temporary_agent_proposal.human_approval_required, true);
  assert.equal(result.tool_decision.task_tools, 'undetermined');
  assert.equal(result.tool_decision.optional_tools_allowed, false);
});

test('QA decisions: parallel requires explicit independence and disjoint known scopes', async t => {
  assert.equal(decide({ workItems: [item('a', 'left/file'), item('b', 'right/file')] }).execution_plan.mode, 'parallel');
  for (const scopes of [['src', 'src/file'], ['src/file', 'SRC/file'], ['.', 'src/file'], ['src/*', 'elsewhere']]) {
    await t.test(scopes.join(' + '), () => {
      assert.equal(decide({ workItems: [item('a', scopes[0]), item('b', scopes[1])] }).execution_plan.mode, 'sequential');
    });
  }
  for (const field of ['independent', 'depends_on', 'write_scopes']) {
    const unknown = item('b', 'right/file');
    delete unknown[field];
    assert.equal(decide({ workItems: [item('a', 'left/file'), unknown] }).execution_plan.mode, 'sequential');
  }
});

test('QA decisions: dependencies force sequential prerequisite order despite disjoint scopes', () => {
  const result = decide({ workItems: [{ ...item('dependent', 'right/file'), depends_on: ['prerequisite'] }, item('prerequisite', 'left/file')] });
  assert.equal(result.execution_plan.mode, 'sequential');
  assert.deepEqual(result.execution_plan.order, ['prerequisite', 'dependent']);
});

test('QA decisions: cyclic and dangling dependencies block delegation', () => {
  for (const workItems of [
    [{ ...item('a', 'a'), depends_on: ['b'] }, { ...item('b', 'b'), depends_on: ['a'] }],
    [{ ...item('a', 'a'), depends_on: ['missing'] }]
  ]) {
    const result = decide({ workItems });
    assert.equal(result.status, 'blocked');
    assert.equal(result.execution_plan.mode, 'blocked');
    assert.equal(result.delegation, false);
  }
});

test('QA decisions: continuation and delegated specialists preserve verified same-task worktree', () => {
  const taskContext = { task_id: '217', continuation_of: '217', repository_root: '/repo', worktree_path: '/task/217', branch: 'issue-217',
    worktree: { task_id: '217', verified: true, path: '/task/217', repository_root: '/repo', branch: 'issue-217' } };
  for (const input of ['review', 'typo', 'regression']) {
    const result = decide({ input, taskContext });
    assert.equal(result.worktree.action, 'reuse_verified');
    assert.equal(result.worktree.path, '/task/217');
    assert.equal(result.host_lifecycle_executed, false);
  }
});

test('QA decisions: unrelated or unverified worktree never satisfies task isolation', () => {
  for (const context of [
    { task_id: 'new', worktree: { task_id: 'old', verified: true, path: '/task/old' } },
    { task_id: 'new', continuation_of: 'old', worktree: { task_id: 'new', verified: true, path: '/task/new' } }
  ]) {
    const result = decide({ taskContext: context });
    assert.equal(result.worktree.action, 'create_required');
    assert.equal(result.worktree.preserve_existing, true);
  }
});

test('QA decisions: same-task ownership without matching Git evidence requires verification', () => {
  const taskContext = { task_id: '217', repository_root: '/repo', worktree_path: '/task/217', branch: 'issue-217',
    worktree: { task_id: '217', verified: true, path: '/task/217', repository_root: '/repo', branch: 'issue-217' } };
  for (const change of [{ verified: false }, { repository_root: '/unrelated' }, { branch: 'main' }, { path: '/other' }]) {
    const result = decide({ taskContext: { ...taskContext, worktree: { ...taskContext.worktree, ...change } } });
    assert.equal(result.worktree.action, 'reuse_requires_verification');
    assert.equal(result.worktree.preserve_existing, true);
  }
  for (const key of ['repository_root', 'worktree_path', 'branch']) {
    const context = { ...taskContext };
    delete context[key];
    assert.equal(decide({ taskContext: context }).worktree.action, 'reuse_requires_verification');
  }
});

test('QA decisions: declared work or invalid decomposition revokes quick-answer facts', () => {
  const substantive = decide({ requestFacts: quickFacts, workItems: [item('a', 'src')] });
  assert.equal(substantive.quick_answer, false);
  assert.equal(substantive.delegation_required, true);
  assert.equal(substantive.worktree.action, 'create_required');
  for (const workItems of [null, {}, [{ ...item('a', 'src'), depends_on: ['missing'] }]]) {
    const result = decide({ requestFacts: quickFacts, workItems });
    assert.equal(result.status, 'blocked');
    assert.equal(result.quick_answer, false);
    assert.equal(result.execution_plan.mode, 'blocked');
  }
});

test('QA decisions: completed work is not cleanup authorization', () => {
  for (const completion of [undefined, true]) {
    const result = decide({ taskContext: { task_id: '217', completed: completion } });
    assert.equal(result.cleanup.ask_at_completion, true);
    assert.equal(result.cleanup.automatic_removal, false);
    assert.equal(result.cleanup.removal_requires_explicit_user_choice, true);
    assert.equal(result.cleanup.preserve_branches_remotes_and_changes, true);
  }
});
