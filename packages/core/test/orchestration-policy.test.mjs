import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { orchestrateTask, classifyTask } from "../src/index.js";
import { runPiAgentSystemSpike } from "../../pi-adapter/src/runtime.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const kernel = { routingPolicy: JSON.parse(fs.readFileSync(path.join(root, ".ai/agents/routing-policy.json"))) };
const quick = { question_count: 1, answer_known: true, requires_analysis: false,
  requires_code: false, requires_actions: false, requires_external_state: false, requires_tools: false };
const task = extra => orchestrateTask({ kernel, input: "Implement a change", ...extra });

test("a known single plain question bypasses delegation, tools and worktree lifecycle", () => {
  const decision = task({ input: "What is this project's name?", requestFacts: quick });
  assert.equal(decision.status, "direct_answer");
  assert.equal(decision.target_agent, "orchestrator");
  assert.equal(decision.delegation_required, false);
  assert.equal(decision.tool_decision.task_tools, "not_needed");
  assert.equal(decision.tool_decision.orchestration_tools, "none");
  assert.equal(decision.tool_decision.provider_request_authorized, false);
  assert.equal(decision.worktree.action, "none");
  assert.equal(decision.cleanup.ask_at_completion, false);
});

test("each missing or conflicting quick-answer fact closes the exception", () => {
  for (const key of Object.keys(quick)) {
    const facts = { ...quick }; delete facts[key];
    assert.equal(task({ requestFacts: facts }).delegation_required, true, key);
  }
  for (const patch of [{ question_count: 2 }, { answer_known: false }, ...Object.keys(quick).filter(key => key.startsWith("requires_")).map(key => ({ [key]: true }))]) {
    assert.equal(task({ requestFacts: { ...quick, ...patch } }).delegation_required, true, JSON.stringify(patch));
  }
  assert.equal(task({ requestFacts: null }).delegation_required, true);
});

test("tiny edits are delegated and ambiguous tasks cannot fall back to direct execution", () => {
  for (const input of ["Fix a typo in one file", "rename this file", "formatting", "Implement one-line change"]) {
    const decision = task({ input });
    assert.equal(decision.target_agent, "developer", input);
    assert.equal(decision.delegation, true);
    assert.equal(decision.worktree.action, "create_required");
  }
  const unknown = task({ input: "Unrecognized specialized task" });
  assert.equal(unknown.status, "blocked");
  assert.equal(unknown.delegation_required, true);
  assert.equal(unknown.target_agent, null);
  assert.equal(unknown.temporary_agent_proposal.human_approval_required, true);
});

test("analysis without business tools still delegates and establishes a task worktree", () => {
  const decision = task({ input: "Review the reasoning supplied above", requestFacts: { ...quick, requires_analysis: true } });
  assert.equal(decision.target_agent, "reviewer");
  assert.equal(decision.tool_decision.task_tools, "not_needed");
  assert.equal(decision.tool_decision.orchestration_tools, "required");
  assert.equal(decision.worktree.action, "create_required");
  assert.equal(decision.host_lifecycle_executed, false);
});

test("external verification and actions require necessary tools but never imply provider permission", () => {
  for (const key of ["requires_external_state", "requires_actions", "requires_code", "requires_tools"]) {
    const decision = task({ requestFacts: { ...quick, [key]: true } });
    assert.equal(decision.tool_decision.task_tools, "required");
    assert.equal(decision.tool_decision.optional_tools_allowed, false);
    assert.equal(decision.tool_decision.provider_request_authorized, false);
  }
  assert.equal(task().tool_decision.task_tools, "undetermined");
});

test("verified same-task worktree is reused; unrelated/unverified worktree is never adopted", () => {
  const context = { task_id: "217", continuation_of: "217", repository_root: "/repo", worktree_path: "/task/217", branch: "issue-217", worktree: { task_id: "217", verified: true, path: "/task/217", repository_root: "/repo", branch: "issue-217" } };
  assert.equal(task({ taskContext: context }).worktree.action, "reuse_verified");
  for (const patch of [{ task_id: "other" }, { continuation_of: "other" }, { worktree: { ...context.worktree, verified: false } }, { worktree: { ...context.worktree, task_id: "other" } }]) {
    const result = task({ taskContext: { ...context, ...patch } });
    assert.notEqual(result.worktree.action, "reuse_verified");
    assert.equal(result.worktree.preserve_existing, true);
  }
});

const independent = (id, scope) => ({ id, depends_on: [], independent: true, write_scopes: [scope] });
test("parallel execution requires explicit independent disjoint known scopes", () => {
  const plan = task({ workItems: [independent("a", "src/a"), independent("b", "src/b")] }).execution_plan;
  assert.equal(plan.mode, "parallel");
  assert.deepEqual(plan.order, ["a", "b"]);
  for (const scope of ["src/a", "src", "src/A", ".", "src/*", "src/./a", "src/../a"]) {
    assert.equal(task({ workItems: [independent("a", "src/a"), independent("b", scope)] }).execution_plan.mode, "sequential", scope);
  }
  assert.equal(task({ workItems: [independent("a", "src/a"), { id: "b" }] }).execution_plan.mode, "sequential");
});

test("dependencies are ordered before dependants, invalid graphs block delegation", () => {
  const result = task({ workItems: [{ ...independent("b", "src/b"), depends_on: ["a"] }, independent("a", "src/a")] });
  assert.equal(result.execution_plan.mode, "sequential");
  assert.deepEqual(result.execution_plan.order, ["a", "b"]);
  for (const workItems of [[{ id: "a", depends_on: ["missing"] }], [{ id: "a" }, { id: "a" }], [{ id: "a", depends_on: ["b"] }, { id: "b", depends_on: ["a"] }]]) {
    const decision = task({ workItems });
    assert.equal(decision.status, "blocked");
    assert.equal(decision.delegation, false);
    assert.equal(decision.target_agent, null);
  }
});

test("cleanup always asks on task completion and never grants automatic deletion", () => {
  const decision = task();
  assert.deepEqual(decision.cleanup, { ask_at_completion: true, automatic_removal: false,
    removal_requires_explicit_user_choice: true, preserve_branches_remotes_and_changes: true });
  assert.equal(decision.authority, "alfred_within_platform_security");
  for (const event of ["task_classified", "delegation_decision", "tool_necessity_decided", "worktree_obligation_decided", "execution_plan_decided", "cleanup_choice_required"]) {
    assert.ok(decision.trace_events.some(value => value.event === event));
  }
});

test("legacy Pi evaluation exercises a real quick question while retaining its three-scenario metrics", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "alfred-orchestration-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const result = runPiAgentSystemSpike({ root, traceOutputPath: path.join(dir, "trace.json") });
  assert.equal(result.decisions.length, 3);
  const [answer, qa, unknown] = result.decisions;
  assert.equal(answer.task_classification.complexity, "quick-answer");
  assert.equal(answer.delegation, false);
  assert.equal(qa.delegation, true);
  assert.equal(unknown.status, "blocked");
  assert.ok(unknown.temporary_agent_proposal);
  assert.equal(classifyTask({ routingPolicy: kernel.routingPolicy, input: "Fix a typo in one file" }).complexity, "specialized");
});


test("declared work revokes quick exemption and invalid work graphs block", () => {
  const workItems = [{ id: "code", depends_on: ["code"], write_scopes: ["src"], independent: true }];
  const invalid = task({ requestFacts: quick, workItems });
  assert.equal(invalid.quick_answer, false);
  assert.equal(invalid.task_classification.complexity, "specialized");
  assert.equal(invalid.execution_plan.mode, "blocked");
  assert.equal(invalid.status, "blocked");
  const substantive = task({ requestFacts: quick, workItems: [independent("code", "src")] });
  assert.equal(substantive.delegation_required, true);
  assert.equal(substantive.tool_decision.task_tools, "required");
  assert.notEqual(substantive.worktree.action, "none");
});

test("same-task claim alone cannot claim verified reuse without expected Git identity", () => {
  const context = { task_id: "217", worktree: { task_id: "217", verified: true, path: "/unrelated" } };
  assert.equal(task({ taskContext: context }).worktree.action, "reuse_requires_verification");
  for (const patch of [{ repository_root: "/repo", worktree_path: "/task/217", branch: "issue-217" },
    { repository_root: "/other", worktree_path: "/unrelated", branch: "issue-217" }]) {
    assert.notEqual(task({ taskContext: { ...context, ...patch } }).worktree.action, "reuse_verified");
  }
});
